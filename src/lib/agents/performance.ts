/**
 * PERFORMANCE REVIEWER — N+1 access, fetch-all-then-filter, wasted work,
 * algorithmic regressions. N+1 is also flagged deterministically in the rules
 * engine; this agent adds higher-level data-access heuristics.
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";

function localHeuristics(input: AgentInput): FindingInput[] {
  const out: FindingInput[] = [];
  for (const f of input.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(f.path)) continue;
    const head = input.headTree[f.path]?.split("\n") ?? [];
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;

        // Fetching an entire table/collection then filtering in app memory.
        const fetchAll = /(?:const|let|var)\s+(\w+)\s*=\s*await\s+[\w.$]+\b(getAll|findAll|allMembers|listAll|all)\s*\(/.exec(l.text);
        if (fetchAll) {
          const varName = fetchAll[1]!;
          const following = head.slice(l.newNo, l.newNo + 14).join("\n");
          if (new RegExp(`${varName}\\.filter\\(|${varName}\\.find\\(`).test(following)) {
            out.push({
              severity: "MEDIUM",
              category: "PERFORMANCE",
              title: "Full collection loaded from the database then filtered in application memory",
              description:
                "The handler loads every row into memory and filters it in-process rather than constraining the SQL query. As the table grows this transfers and allocates the full table on every request, defeating indexes and pagination.",
              file: f.path,
              lineStart: l.newNo,
              lineEnd: l.newNo,
              confidence: 0.82,
              detector: "DETERMINISTIC",
              agent: "performance_reviewer",
              evidence: [
                { kind: "changed_line", label: "Unbounded fetch", detail: l.text.trim(), file: f.path, line: l.newNo },
                { kind: "changed_line", label: "In-memory filter after fetch", detail: following.split("\n").find((x) => x.includes(".filter(") || x.includes(".find("))?.trim() ?? "", file: f.path },
                { kind: "static_tool", label: "Detector", detail: "performance/fetch-all-then-filter" },
              ],
              impact: "Memory and latency scale with total table size; indexes are bypassed; risk of timeouts/OOM under data growth.",
              recommendation: "Push the predicate into the query (WHERE ...), select only required columns, and add LIMIT/keyset pagination.",
            });
          }
        }
      }
    }
  }
  return out;
}

export const performanceAgent: AgentDef = {
  key: "performance_reviewer",
  name: "Performance Reviewer",
  category: "performance",
  stage: 32,
  async run(input, provider) {
    const local = localHeuristics(input);
    const llm = await llmAnalyze(
      provider,
      "performance_reviewer",
      "Focus ONLY: unnecessary queries, N+1, unbounded fetches, inefficient loops/algorithms, memory blow-ups, redundant network calls, missing pagination. Anchor each claim to shown code with a concrete growth scenario.",
      input,
      { categories: ["PERFORMANCE"], maxFindings: 4 },
    );
    if (llm.localOnly) {
      return { ...emptyOutcome("Performance pass complete: query/loop heuristics ran locally (no LLM configured).", true), findings: local, toolCalls: ["performance.data-access-scan"] };
    }
    return { ...llm, findings: [...local, ...llm.findings] };
  },
};
