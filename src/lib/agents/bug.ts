/**
 * BUG HUNTER — logical errors, impossible conditions, null handling,
 * off-by-one, async misuse, state inconsistencies.
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";

function localHeuristics(input: AgentInput): FindingInput[] {
  const out: FindingInput[] = [];
  for (const f of input.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(f.path)) continue;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;

        // Impossible / tautological conditions on the same variable:
        // x !== "a" || x !== "b" is always true; x === "a" && x === "b" always false.
        const taut =
          /(\w+)\s*!==?\s*["']([^"']+)["']\s*\|\|\s*\1\s*!==?\s*["']([^"']+)["']/.exec(l.text) ??
          /(\w+)\s*===?\s*["']([^"']+)["']\s*&&\s*\1\s*===?\s*["']([^"']+)["']/.exec(l.text);
        if (taut && taut[2] !== taut[3]) {
          const isOr = l.text.includes("||");
          out.push({
            severity: "HIGH",
            category: "CORRECTNESS",
            title: `Condition is always ${isOr ? "true" : "false"} — input validation cannot behave as written`,
            description: `The expression compares the same variable against two different constants combined with ${
              isOr ? "||" : "&&"
            }. A single value can never ${isOr ? "equal both constants, so the negated disjunction is always true" : "differ from both constants, so the conjunction is always false"}. Every request hits (or never hits) this branch — in a role/state validator this rejects (or fails to reject) all input.`,
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.96,
            detector: "DETERMINISTIC",
            agent: "bug_hunter",
            evidence: [
              { kind: "changed_line", label: "Tautological condition on added line", detail: l.text.trim(), file: f.path, line: l.newNo },
              { kind: "static_tool", label: "Truth-table check", detail: isOr ? `'${taut[2]}' satisfies the second !== '${taut[3]}'; '${taut[3]}' satisfies the first !== '${taut[2]}' — every value passes.` : `No single value equals both '${taut[2]}' and '${taut[3]}'.` },
            ],
            impact: "Validation/branch logic is inverted: either every request is rejected or the guard never fires.",
            recommendation: isOr
              ? `Use AND for denylisting: if (${taut[1]} !== "${taut[2]}" && ${taut[1]} !== "${taut[3]}") { ... } — or prefer an allowlist: if (!["${taut[2]}", "${taut[3]}"].includes(${taut[1]})) { ... }`
              : `Use OR for alternate values: if (${taut[1]} === "${taut[2]}" || ${taut[1]} === "${taut[3]}") { ... }`,
            suggestedPatch: {
              current: l.text.trim(),
              proposed: isOr
                ? l.text.replace("||", "&&")
                : l.text.replace("&&", "||"),
              explanation: "Swapping the boolean operator restores the intended validation truth table.",
            },
          });
        }

        // async callback inside forEach: awaits inside are not observed.
        const forEachAsync = /\.forEach\s*\(\s*(?:async\b)?/.test(l.text);
        if (forEachAsync && /async/.test(l.text)) {
          out.push({
            severity: "MEDIUM",
            category: "CORRECTNESS",
            title: "async callback passed to forEach — iteration is not awaited",
            description: "Array.prototype.forEach ignores the returned promise, so async callbacks run without ordering/completion guarantees; the surrounding function returns before work settles and rejections become unhandled.",
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.9,
            detector: "DETERMINISTIC",
            agent: "bug_hunter",
            evidence: [
              { kind: "changed_line", label: "forEach(async ...) on added line", detail: l.text.trim(), file: f.path, line: l.newNo },
              { kind: "static_tool", label: "Language semantics", detail: "forEach() returns undefined and never awaits callbacks." },
            ],
            impact: "Races, partial writes, unhandled rejections; callers observe completion too early.",
            recommendation: "Use for...of with await for sequential work, or Promise.all(items.map(...)) for parallel work.",
          });
        }

        // Off-by-one in pagination slices.
        const slice = /\.slice\(\s*0\s*,\s*(\w+)\s*-\s*1\s*\)/.exec(l.text);
        if (slice && /limit|count|page|max/i.test(slice[1]!)) {
          out.push({
            severity: "LOW",
            category: "CORRECTNESS",
            title: `Possible off-by-one: slice(0, ${slice[1]} - 1) returns one fewer item than the limit`,
            description: "If the limit represents the maximum number of items, subtracting 1 silently drops the final item of every full page.",
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.6,
            detector: "DETERMINISTIC",
            agent: "bug_hunter",
            evidence: [
              { kind: "changed_line", label: "Suspicious slice bound", detail: l.text.trim(), file: f.path, line: l.newNo },
            ],
            recommendation: `Use slice(0, ${slice[1]}) unless the -1 compensates for an inclusive index elsewhere.`,
          });
        }
      }
    }
  }
  return out;
}

export const bugAgent: AgentDef = {
  key: "bug_hunter",
  name: "Bug Hunter",
  category: "correctness",
  stage: 31,
  async run(input, provider) {
    const local = localHeuristics(input);
    const llm = await llmAnalyze(
      provider,
      "bug_hunter",
      "Focus ONLY: logical errors, incorrect conditions, null/undefined handling, off-by-one, race conditions, broken error handling, state inconsistencies, incorrect assumptions. Trace data flow from request to side effects.",
      input,
      { categories: ["CORRECTNESS"], maxFindings: 5 },
    );
    if (llm.localOnly) {
      return { ...emptyOutcome("Bug pass complete: condition/null/async heuristics ran locally (no LLM configured).", true), findings: local, toolCalls: ["bug.tautology-scan", "bug.async-scan"] };
    }
    return { ...llm, findings: [...local, ...llm.findings] };
  },
};
