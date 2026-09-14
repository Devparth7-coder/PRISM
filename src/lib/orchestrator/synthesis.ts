/**
 * Review Synthesizer: merges multi-agent findings (same issue reported by
 * Security + Bug Hunter becomes ONE hybrid finding with combined evidence),
 * applies critic verdicts, computes fixed/new/persistent regressions against
 * the previous commit's review, derives the policy-driven recommendation, and
 * renders the PR summary comment + inline GitHub review payload.
 */
import type {
  ChangedFile,
  CriticVerdict,
  Finding,
  FindingInput,
  Recommendation,
  Severity,
} from "../types";
import type { PolicyRow, SeverityMap } from "../db/repo/governance";
import { DEFAULT_SEVERITY_MAP } from "../db/repo/governance";
import type { RiskResult } from "../types";

const SEV_RANK: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

export interface MergedFinding extends FindingInput {
  mergedFrom: string[];
  criticVerdict?: CriticVerdict;
  criticNotes?: string;
  regression?: "NEW" | "PERSISTENT" | "FIXED";
}

/** Stable across re-reviews even if a line number shifts a little. */
export function stableFingerprint(f: { category: string; file: string; title: string }): string {
  const tokens = f.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/(?:the|and|for|with|that|this|may|can|line)/.test(t))
    .slice(0, 7)
    .sort()
    .join(".");
  return `${f.category}|${f.file}|${tokens}`;
}

const titleTokens = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

function sameIssue(a: FindingInput, b: FindingInput): boolean {
  if (a.category !== b.category) return false;
  if (a.file !== b.file) {
    // Security + correctness agents may co-report an access issue on the same route.
    const sameRoute = /authorization|auth|endpoint/i.test(a.title) && /authorization|auth|endpoint/i.test(b.title);
    if (!sameRoute) return false;
  }
  const lineClose = Math.abs(a.lineStart - b.lineStart) <= 6;
  const ta = titleTokens(a.title);
  const tb = titleTokens(b.title);
  let overlap = 0;
  ta.forEach((t) => tb.has(t) && overlap++);
  const titleMatch = overlap >= Math.min(2, Math.min(ta.size, tb.size));
  return lineClose || titleMatch;
}

function routeOf(title: string): { route: string; method: string } | null {
  const route = /((?:\/[\w:{}.-]+){2,})/.exec(title)?.[1];
  const method = /endpoint\s+(GET|POST|PUT|PATCH|DELETE)\b/i.exec(title)?.[1]?.toUpperCase();
  return route ? { route, method: method ?? "?" } : null;
}

/** Stable grouping key so, e.g., Security + Bug reports on the SAME route
 * merge, but findings on GET vs POST routes stay distinct. */
function mergeKey(f: FindingInput): string {
  const r = routeOf(f.title);
  if (r) return `${f.category}|${f.file}|route|${r.method}|${r.route}`;
  const tokens = [...titleTokens(f.title)].sort().slice(0, 5).join(".");
  return `${f.category}|${f.file}|line|${Math.floor(f.lineStart / 5)}|${tokens}`;
}

export function mergeFindings(inputs: FindingInput[]): MergedFinding[] {
  const byKey = new Map<string, MergedFinding>();
  const merged: MergedFinding[] = [];
  for (const f of inputs) {
    const key = mergeKey(f);
    // Route-identified findings merge ONLY on exact route+method; generic
    // findings additionally use fuzzy title/line matching.
    const partner = routeOf(f.title) ? byKey.get(key) : (byKey.get(key) ?? merged.find((m) => sameIssue(m, f)));
    if (!partner) {
      const created: MergedFinding = { ...f, mergedFrom: [f.agent] };
      byKey.set(key, created);
      merged.push(created);
      continue;
    }
    // Union evidence (dedup by label+detail).
    const evidenceKey = (e: { label: string; detail: string }) => `${e.label}|${e.detail.slice(0, 80)}`;
    const seen = new Set(partner.evidence.map(evidenceKey));
    for (const e of f.evidence) {
      const k = evidenceKey(e);
      if (!seen.has(k)) {
        partner.evidence.push(e);
        seen.add(k);
      }
    }
    partner.mergedFrom.push(f.agent);
    if (SEV_RANK[f.severity] > SEV_RANK[partner.severity]) {
      partner.severity = f.severity;
      partner.title = f.title;
      partner.description = f.description;
      partner.impact = f.impact ?? partner.impact;
      partner.recommendation = f.recommendation ?? partner.recommendation;
      partner.suggestedPatch = f.suggestedPatch ?? partner.suggestedPatch;
      partner.lineStart = f.lineStart;
      partner.lineEnd = f.lineEnd;
      partner.file = f.file;
      partner.confidence = Math.max(partner.confidence, f.confidence);
    }
    partner.confidence = Math.max(partner.confidence, f.confidence);
    const detectors = new Set([partner.detector, f.detector]);
    partner.detector = detectors.size > 1 ? "HYBRID" : partner.detector;
    // The most specific (deterministic) agent identity wins for attribution.
    partner.agent = partner.detector === "HYBRID" ? [...new Set([partner.agent, f.agent])].join("+") : partner.agent;
  }
  return merged;
}

// ------------------------------------------------------------ regression ----

export function compareRegression(
  current: MergedFinding[],
  previous: Finding[],
): { current: Map<string, "NEW" | "PERSISTENT">; fixed: Finding[] } {
  const prevByFp = new Map(previous.map((f) => [f.fingerprint, f]));
  const result = new Map<string, "NEW" | "PERSISTENT">();
  const currentFps = new Set<string>();
  for (const f of current) {
    const fp = stableFingerprint(f);
    currentFps.add(fp);
    result.set(fp, prevByFp.has(fp) ? "PERSISTENT" : "NEW");
  }
  const fixed = previous.filter(
    (f) => f.status === "OPEN" && !currentFps.has(f.fingerprint),
  );
  return { current: result, fixed };
}

// -------------------------------------------------------- recommendation ----

export function decideRecommendation(input: {
  findings: MergedFinding[];
  policy: PolicyRow;
  mode: string;
  hasUntestedAuthBehavior: boolean;
}): { recommendation: Recommendation; reasons: string[] } {
  const map = ((): SeverityMap => {
    try {
      return { ...DEFAULT_SEVERITY_MAP, ...(JSON.parse(input.policy.severity_map_json) as Partial<SeverityMap>) };
    } catch {
      return DEFAULT_SEVERITY_MAP;
    }
  })();
  const reasons: string[] = [];
  const active = input.findings.filter((f) => f.criticVerdict !== "FALSE_POSITIVE" && f.criticVerdict !== "WEAK");
  const weak = input.findings.filter((f) => f.criticVerdict === "WEAK");
  const highest = active.map((f) => f.severity).sort((a, b) => SEV_RANK[b] - SEV_RANK[a])[0];

  const bySev = (s: Severity) => active.filter((f) => f.severity === s);
  if (highest === "CRITICAL" && map.CRITICAL === "BLOCK") {
    reasons.push(`Policy maps ${bySev("CRITICAL").length} CRITICAL finding(s) to BLOCK`);
    return { recommendation: "BLOCK", reasons };
  }
  if (highest === "CRITICAL" || (highest === "HIGH" && ["BLOCK", "REQUEST_CHANGES"].includes(map.HIGH))) {
    const c = bySev("CRITICAL").length;
    const h = bySev("HIGH").length;
    if (c) reasons.push(`${c} CRITICAL finding(s) require resolution`);
    if (h) reasons.push(`${h} HIGH finding(s) require changes per policy`);
    if (!c && !h) reasons.push("HIGH-severity finding threshold reached");
    return { recommendation: "REQUEST_CHANGES", reasons };
  }
  if (highest === "HIGH" || (highest === "MEDIUM" && map.MEDIUM === "REQUEST_CHANGES")) {
    reasons.push(`${bySev("HIGH").length} HIGH / ${bySev("MEDIUM").length} MEDIUM finding(s) exceed the approval threshold`);
    return { recommendation: "REQUEST_CHANGES", reasons };
  }
  if (input.policy.require_tests && input.hasUntestedAuthBehavior) {
    reasons.push("Policy requires tests for changed authentication/authorization behavior");
    return { recommendation: "APPROVE_WITH_WARNINGS", reasons };
  }
  const medium = bySev("MEDIUM").length;
  if (medium > 0 || weak.length > 0) {
    reasons.push(`${medium} MEDIUM finding(s) and ${weak.length} weakly-supported observation(s) to review`);
    return { recommendation: "APPROVE_WITH_WARNINGS", reasons };
  }
  if (input.findings.some((f) => f.severity === "LOW")) {
    reasons.push("Only LOW/INFO findings remain");
    return { recommendation: "APPROVE_WITH_WARNINGS", reasons };
  }
  reasons.push("No findings above policy thresholds");
  return { recommendation: "APPROVE", reasons };
}

// -------------------------------------------------------------- rendering ---

const SEV_EMOJI: Record<Severity, string> = { CRITICAL: "🟫", HIGH: "🔴", MEDIUM: "🟠", LOW: "🔵", INFO: "⚪️" };

export function buildSummaryMd(input: {
  isDemo: boolean;
  prNumber: number;
  recommendation: Recommendation;
  findings: MergedFinding[];
  risk: RiskResult;
  staticTools: { tool: string; status: string; summary: string }[];
  testGaps: number;
  dashboardUrl: string;
  topConcerns: string[];
}): string {
  const count = (s: Severity) => input.findings.filter((f) => f.severity === s && f.criticVerdict !== "FALSE_POSITIVE").length;
  const recEmoji = { BLOCK: "⛔️", REQUEST_CHANGES: "⚠️", APPROVE_WITH_WARNINGS: "🟡", APPROVE: "✅" }[input.recommendation];
  const lines = [
    `## 🔷 PRISM Review — PR #${input.prNumber}`,
    input.isDemo ? `> **DEMO MODE** — generated against the bundled demonstration repository, not a live GitHub repository.` : "",
    "",
    `**Recommendation: ${recEmoji} ${input.recommendation.replace(/_/g, " ")}**`,
    "",
    `**Risk: ${input.risk.score}/100 (${input.risk.level})**`,
    "",
    "### Findings",
    `${SEV_EMOJI.CRITICAL} Critical: ${count("CRITICAL")}　${SEV_EMOJI.HIGH} High: ${count("HIGH")}　${SEV_EMOJI.MEDIUM} Medium: ${count("MEDIUM")}　${SEV_EMOJI.LOW} Low: ${count("LOW")}`,
    "",
    ...(input.topConcerns.length
      ? ["### Primary concerns", ...input.topConcerns.slice(0, 5).map((c, i) => `${i + 1}. ${c}`), ""]
      : []),
    input.testGaps ? `### Tests\n⚠️ ${input.testGaps} changed behavior(s) missing regression tests — see the dashboard for generated test scenarios.` : "### Tests\n✅ Changed behavior has linked test coverage.",
    "",
    "### Static analysis",
    ...input.staticTools.map((t) => {
      const icon = t.status === "success" ? "✓" : t.status === "skipped" ? "○" : t.status === "error" ? "✗" : "…";
      return `${icon} ${t.tool} — ${t.summary}`;
    }),
    "",
    "### Risk explanation",
    ...input.risk.reasons.slice(0, 6).map((r) => `- ${r}`),
    "",
    `Full evidence chains, code graph and critic decisions: [PRISM Dashboard](${input.dashboardUrl})`,
    "",
    "<sub>Findings are evidence-backed and adversarially verified. Confidence values indicate detector/model certainty, not scientific proof. React with 👎 on an inline comment or dismiss in the dashboard to teach PRISM repository conventions.</sub>",
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

export interface GithubComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export function buildGithubPayload(input: {
  recommendation: Recommendation;
  findings: MergedFinding[];
  summaryMd: string;
  files: ChangedFile[];
}): { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body: string; comments: GithubComment[] } {
  const event =
    input.recommendation === "BLOCK" || input.recommendation === "REQUEST_CHANGES"
      ? "REQUEST_CHANGES"
      : input.recommendation === "APPROVE"
        ? "APPROVE"
        : "COMMENT";

  const added = new Map<string, Set<number>>();
  for (const f of input.files) {
    const set = new Set<number>();
    for (const h of f.hunks) for (const l of h.lines) if (l.type === "add" && l.newNo !== null) set.add(l.newNo);
    added.set(f.path, set);
  }

  const comments: GithubComment[] = [];
  for (const f of input.findings) {
    if (SEV_RANK[f.severity] < SEV_RANK.MEDIUM) continue;
    if (f.criticVerdict === "FALSE_POSITIVE" || f.criticVerdict === "WEAK") continue;
    const anchors = added.get(f.file);
    if (!anchors || !anchors.has(f.lineStart)) continue;
    const badge = SEV_EMOJI[f.severity];
    const detectorBadge = f.detector === "DETERMINISTIC" ? "deterministic" : f.detector === "HYBRID" ? "deterministic + AI" : "AI-detected";
    const evidence = f.evidence
      .slice(0, 4)
      .map((e) => `- ${e.label}: ${e.file ? `\`${e.file}${e.line ? `:${e.line}` : ""}\` — ` : ""}${e.detail.slice(0, 200)}`)
      .join("\n");
    comments.push({
      path: f.file,
      line: f.lineStart,
      side: "RIGHT",
      body: [
        `${badge} **${f.severity} — ${f.title}**`,
        "",
        f.description.slice(0, 600),
        "",
        evidence ? `**Evidence**\n${evidence}` : "",
        "",
        `**Recommendation**\n${f.recommendation.slice(0, 500)}`,
        ...(f.suggestedPatch
          ? ["", "```suggestion", f.suggestedPatch.proposed.trim().slice(0, 600), "```", `<sub>${f.suggestedPatch.explanation.slice(0, 200)}</sub>`]
          : []),
        "",
        `<sub>${badge === SEV_EMOJI.CRITICAL || badge === SEV_EMOJI.HIGH ? "Critic-verified · " : ""}${detectorBadge} · confidence ${f.confidence.toFixed(2)} · PRISM</sub>`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return { event, body: input.summaryMd, comments: comments.slice(0, 20) };
}
