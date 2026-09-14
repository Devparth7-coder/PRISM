/**
 * PR Understanding Engine. Before reviewing code, PRISM derives a concise,
 * PUBLIC decision summary: intent, scope, components, risk areas, expected
 * behavior and side effects. Only these summaries are stored/shown — private
 * chain-of-thought is never persisted or displayed.
 */
import { z } from "zod";
import type { ChangedFile } from "../types";
import type { AIProvider, Usage } from "../ai/types";
import { LocalProviderError } from "../ai/providers/local";
import { structuredWithRetry } from "../ai/validate";

export interface PrIntent {
  intent: string;
  scope: ("feature" | "bugfix" | "refactor" | "dependency" | "config" | "test" | "docs" | "security")[];
  affectedComponents: string[];
  riskAreas: { area: string; level: "HIGH" | "MEDIUM" | "LOW"; reason: string }[];
  expectedBehavior: string[];
  potentialSideEffects: string[];
}

const intentSchema = z.object({
  intent: z.string().min(10).max(400),
  scope: z.array(z.enum(["feature", "bugfix", "refactor", "dependency", "config", "test", "docs", "security"])),
  affectedComponents: z.array(z.string()).max(12),
  riskAreas: z
    .array(
      z.object({
        area: z.string(),
        level: z.enum(["HIGH", "MEDIUM", "LOW"]),
        reason: z.string().max(300),
      }),
    )
    .max(8),
  expectedBehavior: z.array(z.string()).max(8),
  potentialSideEffects: z.array(z.string()).max(8),
});

const RISK_HINTS: { re: RegExp; area: string; level: "HIGH" | "MEDIUM" | "LOW"; reason: string }[] = [
  { re: /auth|session|login|oauth|jwt|password|credential/i, area: "authentication boundary", level: "HIGH", reason: "changes touch authentication/session code" },
  { re: /authori[sz]|permission|role|rbac|admin|guard|middleware/i, area: "authorization logic", level: "HIGH", reason: "access-control decisions are modified" },
  { re: /payment|billing|stripe|charge|refund|subscription/i, area: "payments", level: "HIGH", reason: "money movement paths are modified" },
  { re: /migrat|schema|model|entity|sql/i, area: "data model / persistence", level: "MEDIUM", reason: "persistence schema or queries change" },
  { re: /middleware|interceptor|plugin/i, area: "request pipeline", level: "MEDIUM", reason: "shared request handling changes affect every route" },
  { re: /config|env|secret|deploy|docker|ci\//i, area: "configuration / deployment", level: "MEDIUM", reason: "configuration changes can alter runtime behavior broadly" },
  { re: /package\.json|lock|requirement|go\.mod/i, area: "dependency supply chain", level: "MEDIUM", reason: "dependency footprint changes" },
  { re: /test|spec/i, area: "test coverage", level: "LOW", reason: "test files are modified" },
];

export function deriveIntentLocal(title: string, body: string, files: ChangedFile[]): PrIntent {
  const paths = files.map((f) => f.path);
  const components = [...new Set(paths.map((p) => p.split("/").slice(0, -1).join("/").replace(/^src\//, "") || p.split("/").pop()!))].slice(0, 8);
  const haystack = `${title}\n${body}\n${paths.join("\n")}`;
  const scope = new Set<PrIntent["scope"][number]>();
  if (/fix|bug|error|crash/i.test(title)) scope.add("bugfix");
  if (/refactor|cleanup|rename|move/i.test(title)) scope.add("refactor");
  if (paths.some((p) => /package\.json|lock|requirements|go\.mod/.test(p))) scope.add("dependency");
  if (paths.every((p) => /test|spec/i.test(p))) scope.add("test");
  if (paths.some((p) => /config|workflow|docker|\.env/i.test(p))) scope.add("config");
  if (paths.some((p) => /\.md$/i.test(p))) scope.add("docs");
  if (/auth|security|vuln|cve|inject/i.test(haystack)) scope.add("security");
  if (scope.size === 0) scope.add("feature");

  const riskAreas: PrIntent["riskAreas"] = [];
  for (const h of RISK_HINTS) {
    if (h.re.test(haystack) && !riskAreas.some((r) => r.area === h.area)) riskAreas.push({ area: h.area, level: h.level, reason: h.reason });
  }
  if (files.reduce((s, f) => s + f.additions + f.deletions, 0) > 800) {
    riskAreas.push({ area: "change size", level: "MEDIUM", reason: "large diff increases regression surface" });
  }

  const verbs = /\b(add|introduce|support|enable|create|implement)\b/i.test(title) ? "adds new behavior" : "modifies existing behavior";
  return {
    intent: `${title} — the change ${verbs} across ${files.length} file(s).`,
    scope: [...scope],
    affectedComponents: components,
    riskAreas,
    expectedBehavior: ["(Deterministic summary) Behavior described by the PR title/description and the changed handlers; verify against added test cases."],
    potentialSideEffects: riskAreas.map((r) => `Watch for regressions at the ${r.area}.`),
  };
}

export async function deriveIntent(
  provider: AIProvider,
  title: string,
  body: string,
  files: ChangedFile[],
): Promise<{ intent: PrIntent; usage?: Usage; localOnly: boolean }> {
  try {
    const fileList = files.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`).join("\n");
    const { data, usage } = await structuredWithRetry(provider, {
      task: "intent",
      system:
        "You produce a concise, public engineering summary of a pull request. Do not include private reasoning. Ground every claim in the provided files. Prefer precision over speculation.",
      user: `Title: ${title}\n\nDescription:\n${(body ?? "").slice(0, 3000)}\n\nChanged files:\n${fileList}\n\nReturn the structured summary.`,
      schema: intentSchema,
      maxTokens: 1600,
      temperature: 0.05,
    });
    return { intent: data, usage, localOnly: false };
  } catch (err) {
    if (err instanceof LocalProviderError) {
      return { intent: deriveIntentLocal(title, body, files), localOnly: true };
    }
    // Model failure must not abort the review — deterministic fallback.
    return { intent: deriveIntentLocal(title, body, files), localOnly: true };
  }
}
