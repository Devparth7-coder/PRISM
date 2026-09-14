/**
 * MAINTAINABILITY REVIEWER — duplication, complexity, leaky abstractions,
 * architecture violations. Deliberately conservative: nitpicks are suppressed
 * unless a repository rule elevates them.
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function localHeuristics(input: AgentInput): FindingInput[] {
  const out: FindingInput[] = [];

  // Cross-file duplication of 4+ line added blocks (copy/paste).
  const blocks: { file: string; line: number; text: string; norm: string }[] = [];
  for (const f of input.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(f.path)) continue;
    const added: { line: number; text: string }[] = [];
    for (const h of f.hunks) for (const l of h.lines) if (l.type === "add" && l.newNo !== null && l.text.trim().length > 12) added.push({ line: l.newNo, text: l.text });
    for (let i = 0; i + 3 < added.length; i++) {
      const chunk = added.slice(i, i + 4).map((a) => normalize(a.text)).join("\n");
      if (chunk.split("\n").every((t) => /[{}\])];,\s]*$/.test(t) === false || t.length > 18)) {
        blocks.push({ file: f.path, line: added[i]!.line, text: chunk, norm: chunk.toLowerCase() });
      }
    }
  }
  const seen = new Map<string, (typeof blocks)[number]>();
  for (const b of blocks) {
    const prior = seen.get(b.norm);
    if (prior && prior.file !== b.file) {
      out.push({
        severity: "LOW",
        category: "MAINTAINABILITY",
        title: "Repeated 4+ line block across files — extract a shared helper",
        description: "The same multi-line logic appears in multiple changed files. Duplicated logic drifts: a fix applied to one copy is frequently missed in the other.",
        file: b.file,
        lineStart: b.line,
        lineEnd: b.line + 3,
        confidence: 0.7,
        detector: "DETERMINISTIC",
        agent: "maintainability_reviewer",
        evidence: [
          { kind: "changed_line", label: "Duplicated block", detail: b.text.slice(0, 400), file: b.file, line: b.line },
          { kind: "changed_line", label: "Earlier occurrence", detail: prior.text.slice(0, 400), file: prior.file, line: prior.line },
        ],
        recommendation: "Extract the shared behavior into one named helper and call it from both sites.",
      });
    } else if (!prior) {
      seen.set(b.norm, b);
    }
  }

  // 'any' escapes — LOW by default; repository custom rules can escalate.
  const anyRule = input.rules.find((r) => /\bany\b/.test(r.pattern) && r.enabled);
  for (const f of input.changedFiles) {
    if (!/\.tsx?$/.test(f.path)) continue;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        if (/:\s*any\b|as\s+any\b|Record<string,\s*any>/.test(l.text)) {
          out.push({
            severity: anyRule ? "MEDIUM" : "INFO",
            category: "MAINTAINABILITY",
            title: "Type safety escaped with 'any'",
            description: "Using any disables the type checker for that value, allowing exactly the class of contract bugs PRISM otherwise catches at compile time.",
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.9,
            detector: "DETERMINISTIC",
            agent: "maintainability_reviewer",
            evidence: [
              { kind: "changed_line", label: "any usage", detail: l.text.trim(), file: f.path, line: l.newNo },
              ...(anyRule ? [{ kind: "convention" as const, label: "Repository rule", detail: anyRule.description }] : []),
            ],
            recommendation: "Model the shape with an interface/type or use unknown + narrowing.",
          });
        }
      }
    }
  }
  return out;
}

export const maintainabilityAgent: AgentDef = {
  key: "maintainability_reviewer",
  name: "Maintainability Reviewer",
  category: "quality",
  stage: 33,
  async run(input, provider) {
    const local = localHeuristics(input);
    const llm = await llmAnalyze(
      provider,
      "maintainability_reviewer",
      "Focus ONLY: duplicated logic, poor/leaky abstractions, architecture violations against the observed layering (routes -> services -> data), hard-to-test structure. Do NOT report naming/style nits or generic praise. At most 3 findings.",
      input,
      { categories: ["MAINTAINABILITY"], maxFindings: 3 },
    );
    if (llm.localOnly) {
      return { ...emptyOutcome("Maintainability pass complete: duplication and type-escape heuristics ran locally.", true), findings: local, toolCalls: ["duplication-scan", "any-escape-scan"] };
    }
    return { ...llm, findings: [...local, ...llm.findings] };
  },
};
