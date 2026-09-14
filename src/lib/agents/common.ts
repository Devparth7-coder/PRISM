/**
 * Shared agent runtime: input bundle, strict output schema, LLM bridge and
 * local heuristic helpers. Agent output is ALWAYS validated against a Zod
 * schema — malformed model output is rejected and retried, never persisted.
 */
import { z } from "zod";
import type {
  AgentKey,
  ChangedFile,
  FindingInput,
  ReviewMode,
} from "../types";
import type { ContextBundle } from "../code/context";
import type { AIProvider, Usage } from "../ai/types";
import { LocalProviderError } from "../ai/providers/local";
import type { MemoryRow, RuleRow } from "../db/repo/governance";
import type { RepositoryRow, PullRequestRow } from "../db/repo/repositories";

export interface AgentInput {
  pr: PullRequestRow;
  repository: RepositoryRow;
  changedFiles: ChangedFile[];
  baseTree: Record<string, string>;
  headTree: Record<string, string>;
  bundle: ContextBundle;
  deterministic: FindingInput[];
  memory: MemoryRow[];
  rules: RuleRow[];
  mode: ReviewMode;
}

export const evidenceSchema = z.object({
  kind: z.enum(["changed_line", "related_code", "caller", "callee", "test", "config", "static_tool", "dependency", "convention", "graph"]),
  label: z.string().max(200),
  detail: z.string().max(1200),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

export const findingSchema = z.object({
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  category: z.enum(["SECURITY", "CORRECTNESS", "PERFORMANCE", "MAINTAINABILITY", "TESTS", "API_CONTRACT", "DEPENDENCIES"]),
  title: z.string().min(8).max(200),
  description: z.string().min(20).max(2000),
  file: z.string(),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  confidence: z.number().min(0.1).max(0.99),
  evidence: z.array(evidenceSchema).min(1).max(8),
  impact: z.string().max(800).optional(),
  recommendation: z.string().min(10).max(1200),
  suggestedPatch: z
    .object({ current: z.string(), proposed: z.string(), explanation: z.string() })
    .optional(),
});

export const agentOutputSchema = z.object({
  decisionSummary: z.string().min(10).max(1200),
  findings: z.array(findingSchema).max(12),
});

export interface AgentDef {
  key: AgentKey;
  name: string;
  category: string;
  stage: number;
  run(input: AgentInput, provider: AIProvider): Promise<AgentOutcome>;
}

export interface AgentOutcome {
  decisionSummary: string;
  findings: FindingInput[];
  toolCalls: string[];
  usage?: Usage;
  localOnly: boolean;
}

export const emptyOutcome = (decisionSummary: string, localOnly: boolean): AgentOutcome => ({
  decisionSummary,
  findings: [],
  toolCalls: [],
  localOnly,
});

/** Render a compact unified diff for prompts (bounded). */
export function renderDiff(file: ChangedFile, maxLines = 220): string {
  const lines: string[] = [];
  for (const h of file.hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      if (l.type === "hunk") continue;
      const no = l.type === "add" ? l.newNo : l.oldNo;
      const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
      lines.push(`${String(no ?? "").padStart(4)} ${sign} ${l.text}`);
    }
    if (lines.length > maxLines) {
      lines.push("… (diff truncated for token budget)");
      break;
    }
  }
  return lines.join("\n");
}

export function lineWindow(headTree: Record<string, string>, file: string, line: number, radius = 8): string {
  const content = headTree[file];
  if (!content) return "";
  const lines = content.split("\n");
  return lines
    .slice(Math.max(0, line - radius - 1), line + radius)
    .map((t, i) => `${String(line - radius + i).padStart(4)} | ${t}`)
    .join("\n");
}

/**
 * Invoke an LLM agent under its mission. Returns localOnly=true with no
 * findings when no model is configured — the agent's heuristic path is the
 * caller's responsibility and runs regardless.
 */
export async function llmAnalyze(
  provider: AIProvider,
  agent: AgentKey,
  mission: string,
  input: AgentInput,
  opts: { extraContext?: string; categories: FindingInput["category"][]; maxFindings?: number } = { categories: [] },
): Promise<AgentOutcome> {
  const diffs = input.changedFiles
    .filter((f) => /\.(ts|tsx|js|jsx|py|go|java|rb|php|cs|sql|ya?ml|json)$/.test(f.path))
    .map((f) => `### File: ${f.path} (${f.status}, +${f.additions}/-${f.deletions})\n\`\`\`diff\n${renderDiff(f)}\n\`\`\``)
    .join("\n\n")
    .slice(0, 28_000);

  const related = input.bundle.files
    .filter((f) => f.reason !== "changed in PR")
    .slice(0, 10)
    .map((f) => `### Related file: ${f.path} (${f.reason})\n\`\`\`\n${f.content.slice(0, 1800)}\n\`\`\``)
    .join("\n\n")
    .slice(0, 24_000);

  const memoryText = input.memory.length
    ? input.memory.map((m) => `- [${m.kind}] ${m.content}`).join("\n")
    : "(none recorded)";
  const rulesText = input.rules.length
    ? input.rules.filter((r) => r.enabled).map((r) => `- ${r.description} (/${r.pattern}/ ${r.path_glob ?? ""})`).join("\n")
    : "(none beyond defaults)";
  const detText = input.deterministic.length
    ? input.deterministic.map((d) => `- [${d.severity}] ${d.title} (${d.file}:${d.lineStart})`).join("\n")
    : "(none)";

  const system = [
    "You are a specialized senior code-review agent inside PRISM.",
    "You review a SPECIFIC pull request at a SPECIFIC commit with repository context provided.",
    "RULES:",
    "- Report only high-confidence, real, actionable findings. Signal over quantity. A maximum of " +
      `${opts.maxFindings ?? 6} findings.`,
    "- Every finding MUST cite evidence that actually exists in the provided diff/context (real file paths and line numbers).",
    "- Do not invent files, functions, tests, dependencies or framework behavior.",
    "- Do not report style nitpicks. Do not repeat the deterministic findings listed by the orchestrator unless you have NEW evidence.",
    "- Missing tests for genuinely new behavior are valid findings.",
    "- Use neutral, precise language. No speculation hedging like 'might be okay'. If evidence is insufficient, do not report.",
    mission,
  ].join("\n");

  const user = [
    `Repository: ${input.repository.full_name}`,
    `PR #${input.pr.number}: ${input.pr.title}`,
    `Description: ${(input.pr.body ?? "").slice(0, 1500)}`,
    `Review focus categories: ${opts.categories.join(", ")}`,
    "",
    "## Deterministic findings already raised (do not duplicate)",
    detText,
    "",
    "## Repository memory & conventions",
    memoryText,
    "",
    "## Repository-specific rules",
    rulesText,
    "",
    "## Diff",
    diffs,
    "",
    "## Related repository context",
    related,
    opts.extraContext ? `\n## Additional context\n${opts.extraContext}` : "",
    "",
    "Return JSON: {\"decisionSummary\": string (2-4 sentences, what you checked and concluded), \"findings\": [...]}",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { data, usage } = await provider.structuredOutput({
      system,
      user,
      schema: agentOutputSchema,
      task: `agent:${agent}`,
      maxTokens: 4000,
      temperature: 0.1,
    });
    const findings: FindingInput[] = data.findings.map((f) => ({ ...f, detector: "AI-DETECTED", agent }));
    return {
      decisionSummary: data.decisionSummary,
      findings,
      toolCalls: ["llm.structuredOutput", "context-bundle.read", "diff.read"],
      usage,
      localOnly: false,
    };
  } catch (err) {
    if (err instanceof LocalProviderError) {
      return emptyOutcome("No LLM credentials configured; ran local deterministic heuristics only.", true);
    }
    throw err;
  }
}

export function addedLineSet(files: ChangedFile[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const f of files) {
    const set = new Set<number>();
    for (const h of f.hunks) for (const l of h.lines) if (l.type === "add" && l.newNo !== null) set.add(l.newNo);
    map.set(f.path, set);
  }
  return map;
}
