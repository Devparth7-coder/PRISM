/**
 * Contextual Copilot — answers are GROUNDED in stored review data. The local
 * answer engine computes from findings/evidence/risk/analytics directly; when
 * an LLM is configured it is given ONLY the retrieved facts and instructed not
 * to invent beyond them. No chain-of-thought is exposed, only decisions and
 * evidence.
 */
import { db } from "../db/client";
import { reviewDetail, getFinding, type ReviewDetail } from "../services/read-models";
import { findingsByCategory } from "../db/repo/analytics";
import { selectProvider } from "../ai/router";
import { LocalProviderError } from "../ai/providers/local";

export interface CopilotCitation {
  kind: "finding" | "review" | "run" | "repo";
  id: string;
  label: string;
}
export interface CopilotAnswer {
  answer: string;
  citations: CopilotCitation[];
  suggestions: string[];
}

const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 } as const;

function rankedFindings(detail: ReviewDetail) {
  return detail.findings
    .filter((f) => f.status === "OPEN")
    .sort(
      (a, b) =>
        SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.confidence - a.confidence,
    );
}

export async function answerCopilot(input: {
  question: string;
  userId: string;
  reviewId?: string;
  repoId?: string;
  findingId?: string;
}): Promise<CopilotAnswer> {
  const q = input.question.toLowerCase().trim();
  const detail = input.reviewId ? reviewDetail(input.reviewId, input.userId) : undefined;
  const finding = input.findingId ? getFinding(input.findingId) : undefined;
  const citations: CopilotCitation[] = [];

  const citeFinding = (f: { id: string; title: string; severity: string }): CopilotCitation => {
    const c = { kind: "finding" as const, id: f.id, label: `${f.severity} — ${f.title}` };
    citations.push(c);
    return c;
  };

  let answer = "";
  let suggestions: string[] = [];

  // ---------------------------------------------------------- finding Qs
  if (finding && /false positive|wrong|incorrect|dismiss|challenge|is this real/.test(q)) {
    citeFinding(finding);
    answer = [
      `**${finding.severity} — ${finding.title}** (${finding.file}:${finding.lineStart})`,
      "",
      `Critic verdict: **${finding.criticVerdict ?? "not adversarially challenged at this severity"}**. Detector: ${finding.detector}, confidence ${finding.confidence.toFixed(2)}.`,
      "",
      "**Evidence chain**",
      ...finding.evidence.map((e, i) => `${i + 1}. ${e.label} — ${e.detail}${e.file ? ` (\`${e.file}${e.line ? `:${e.line}` : ""}\`)` : ""}`),
      "",
      finding.criticNotes ? `**Critic reasoning:** ${finding.criticNotes}` : "",
      "",
      "If the behavior is intentional or accepted here, dismiss the finding with a reason — PRISM stores it as repository knowledge that shapes future reviews (no model training occurs).",
    ]
      .filter(Boolean)
      .join("\n");
    suggestions = ["Show me the suggested fix", "What would tests for this look like?", "Is this pattern used elsewhere?"];
    return maybeLlm(input, answer, citations, suggestions);
  }

  // ---------------------------------------------------------- review Qs
  if (detail) {
    const top = rankedFindings(detail);

    if (/why.*risk|risk.*(high|score|level)|how.*risk/.test(q)) {
      answer = [
        `PR #${detail.pr.number} scored **${detail.risk?.score ?? "?"}/100 (${detail.risk?.level ?? "n/a"})** — recommendation **${detail.review.recommendation?.replace(/_/g, " ") ?? "pending"}**.`,
        "",
        "**Drivers, by dimension:**",
        ...(detail.risk?.reasons ?? ["Risk has not been computed yet."]),
        "",
        `Breakdown — security ${detail.risk?.breakdown.security ?? 0}, correctness ${detail.risk?.breakdown.correctness ?? 0}, performance ${detail.risk?.breakdown.performance ?? 0}, tests ${detail.risk?.breakdown.testing ?? 0}, dependencies ${detail.risk?.breakdown.dependencies ?? 0}, scope ${detail.risk?.breakdown.scope ?? 0}.`,
      ].join("\n");
      citations.push({ kind: "review", id: detail.review.id, label: `Review of PR #${detail.pr.number}` });
      suggestions = ["Which finding should I fix first?", "Show me the strongest evidence", "What test cases are missing?"];
      return maybeLlm(input, answer, citations, suggestions);
    }

    if (/strongest evidence|best evidence|evidence for|why did prism flag/.test(q)) {
      const f = top[0];
      if (!f) {
        answer = "No open findings remain on this review — there is no evidence chain to show.";
      } else {
        citeFinding(f);
        answer = [
          `The strongest open finding is **${f.severity} — ${f.title}** at \`${f.file}:${f.lineStart}\` (${f.detector}, critic: ${f.criticVerdict ?? "n/a"}, confidence ${f.confidence.toFixed(2)}).`,
          "",
          "**Evidence chain**",
          ...f.evidence.map((e, i) => `${i + 1}. *${e.kind.replace(/_/g, " ")}* — ${e.label}: ${e.detail}${e.file ? ` (\`${e.file}${e.line ? `:${e.line}` : ""}\`)` : ""}`),
          "",
          `**Impact:** ${f.impact ?? "see finding description"}`,
          "",
          `**Recommendation:** ${f.recommendation}`,
        ].join("\n");
      }
      suggestions = ["Which finding should I fix first?", "Could this be a false positive?", "Generate tests"];
      return maybeLlm(input, answer, citations, suggestions);
    }

    if (/fix first|prioriti|what should i do|most important|start with/.test(q)) {
      answer = [
        "Fix order, by severity × critic confidence:",
        ...top.slice(0, 4).map((f, i) => {
          citeFinding(f);
          return `${i + 1}. **${f.severity}** — ${f.title} (\`${f.file}:${f.lineStart}\`, ${f.criticVerdict ?? "unverified"})`;
        }),
        "",
        top[0] ? `Start with \`${top[0].file}:${top[0].lineStart}\`: ${top[0].recommendation.slice(0, 300)}` : "No open findings.",
      ].join("\n");
      suggestions = ["Show me the strongest evidence", "Why is this PR high risk?", "Generate tests"];
      return maybeLlm(input, answer, citations, suggestions);
    }

    if (/test/.test(q)) {
      const tf = detail.findings.filter((f) => f.category === "TESTS");
      answer = tf.length
        ? [
            `${tf.length} test-gap finding(s):`,
            ...tf.map((f) => {
              citeFinding(f);
              return `- **${f.title}**\n  ${f.recommendation.slice(0, 500)}`;
            }),
            "",
            "Generated regression scaffolds are attached as artifacts on the Tests tab — review and apply them yourself; PRISM never applies code automatically.",
          ].join("\n")
        : "Changed behavior has linked test coverage in the code graph — no test-gap findings.";
      suggestions = ["Which finding should I fix first?", "Show me the strongest evidence"];
      return maybeLlm(input, answer, citations, suggestions);
    }

    if (/what.*(do|did|run|agent|mesh)|pipeline|summary of (the )?review/.test(q)) {
      const completed = detail.runs.filter((r) => r.status === "COMPLETED");
      answer = [
        `PRISM ran ${completed.length} stage(s)/agent(s) in ${((detail.review.duration_ms ?? 0) / 1000).toFixed(1)}s using ${detail.review.model ?? "unknown"}.`,
        "",
        ...completed.map((r) => `- ${r.display_name}: ${r.decision_summary ?? ""}`),
        "",
        `Result: **${detail.review.recommendation?.replace(/_/g, " ")}**, risk ${detail.review.risk_score}/100, ${detail.findings.length} finding(s).`,
      ].join("\n");
      citations.push({ kind: "review", id: detail.review.id, label: "Review run" });
      return maybeLlm(input, answer, citations, ["Why is this PR high risk?", "Which finding should I fix first?"]);
    }
  }

  // ---------------------------------------------------------- repo / analytics
  if (/recurring|trend|over time|most common|team care|pattern/.test(q)) {
    const byCat = findingsByCategory(input.userId);
    const topCats = byCat.slice(0, 4);
    if (!topCats.length) {
      answer = "Not enough reviewed PR data yet to report trends. Findings shown here are computed only from stored reviews.";
    } else {
      answer = [
        "Recurring issue categories across your reviewed PRs:",
        ...topCats.map((c, i) => `${i + 1}. **${c.category}** — ${c.c} finding(s)`),
        "",
        topCats[0]?.category === "SECURITY"
          ? "Security is the most recurring category — consider a repository rule or shared middleware to address the root cause once."
          : "Use Analytics for per-category and risk trends over time.",
      ].join("\n");
    }
    suggestions = ["Show analytics", "Which findings are still open?"];
    return maybeLlm(input, answer, citations, suggestions);
  }

  // ---------------------------------------------------------- fallback
  const counts = detail
    ? (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((s) => `${detail.findings.filter((f) => f.severity === s).length} ${s}`)
    : [];
  answer = detail
    ? `PR #${detail.pr.number}: **${detail.review.recommendation?.replace(/_/g, " ") ?? detail.review.status}**, risk ${detail.review.risk_score ?? "?"}/100, findings ${counts.join(", ")}. Ask about risk drivers, the strongest evidence, fix priority, test gaps, or an individual finding.`
    : "Open a review and ask about its risk, evidence, fix priority or tests — every answer is computed from stored PRISM data.";
  if (detail) citations.push({ kind: "review", id: detail.review.id, label: `Review of PR #${detail.pr.number}` });
  suggestions = ["Why is this PR this risk level?", "Which finding should I fix first?", "Show me the strongest evidence"];
  return maybeLlm(input, answer, citations, suggestions);
}

async function maybeLlm(
  input: { question: string },
  groundedAnswer: string,
  citations: CopilotCitation[],
  suggestions: string[],
): Promise<CopilotAnswer> {
  const { provider, isLocal } = selectProvider();
  if (isLocal) return { answer: groundedAnswer, citations, suggestions };
  try {
    const res = await provider.generate(
      [
        {
          role: "system",
          content:
            "You are PRISM Copilot. Answer ONLY from the grounded facts provided. Never invent findings, files, numbers or reviews. Use concise markdown. If facts are insufficient, say so, and never reveal private reasoning.",
        },
        { role: "user", content: `Question: ${input.question}\n\nGrounded facts:\n${groundedAnswer}\n\nCitations available: ${JSON.stringify(citations)}` },
      ],
      { maxTokens: 700, temperature: 0.1 },
    );
    return { answer: res.text?.trim() ? res.text : groundedAnswer, citations, suggestions };
  } catch (err) {
    if (err instanceof LocalProviderError) return { answer: groundedAnswer, citations, suggestions };
    return { answer: groundedAnswer, citations, suggestions };
  }
}
