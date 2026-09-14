/**
 * API / CONTRACT REVIEWER — input validation, response shape consistency,
 * pagination bounds, backward compatibility for changed handlers.
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";

const VALIDATION_HINTS = /zod|\.parse\(|\.safeParse|joi|yup|validator|schema\.validate|assert|is[A-Z]\w+|requireParams|validateBody|superstruct|io-ts/;

function localHeuristics(input: AgentInput): FindingInput[] {
  const out: FindingInput[] = [];
  for (const f of input.changedFiles) {
    if (!/\.(ts|tsx|js)$/.test(f.path)) continue;
    const head = input.headTree[f.path]?.split("\n") ?? [];
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        const route = /(?:[Rr]outer|app)\.(post|put|patch)\s*\(\s*[`'"]([^`'"]+)/.exec(l.text);
        if (!route) continue;
        const windowText = head.slice(l.newNo - 1, l.newNo + 14).join("\n");
        const destructuresInput = /req\.body|request\.body/.test(windowText);
        if (destructuresInput && !VALIDATION_HINTS.test(windowText)) {
          out.push({
            severity: "MEDIUM",
            category: "API_CONTRACT",
            title: `Mutating endpoint ${route[1]!.toUpperCase()} ${route[2]} reads request body without validation`,
            description:
              "The handler consumes req.body without a schema/validation step. Undocumented fields, wrong types and missing required fields reach the data layer, producing 500s, bad persisted state and a contract that callers cannot rely on.",
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.78,
            detector: "DETERMINISTIC",
            agent: "api_contract_reviewer",
            evidence: [
              { kind: "changed_line", label: "New mutating route", detail: l.text.trim(), file: f.path, line: l.newNo },
              { kind: "changed_line", label: "req.body used in handler window", detail: windowText.split("\n").find((x) => /req\.body/.test(x))?.trim() ?? "req.body referenced", file: f.path },
              { kind: "static_tool", label: "Validation markers scan", detail: "no zod/joi/yup/.parse()/validate/assert found within the handler window" },
            ],
            impact: "Unvalidated input: type confusion, mass assignment, inconsistent error responses, and downstream injection risk.",
            recommendation: "Define a request schema (e.g. zod) and parse req.body at the boundary; reject with 400 and field-level messages on failure.",
          });
        }
        const isCollectionGet = /(?:[Rr]outer|app)\.get\s*\(/.test(l.text) && /list|members|users|all|collection/i.test(route[2]!);
        if (isCollectionGet && !/limit|page|take|cursor|per_page/i.test(windowText)) {
          out.push({
            severity: "LOW",
            category: "API_CONTRACT",
            title: `Collection endpoint ${route[2]} has no pagination bound`,
            description: "The list route imposes no limit/cursor, so response size grows with the entire collection — both a contract stability and performance issue.",
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.7,
            detector: "DETERMINISTIC",
            agent: "api_contract_reviewer",
            evidence: [
              { kind: "changed_line", label: "Collection route", detail: l.text.trim(), file: f.path, line: l.newNo },
              { kind: "static_tool", label: "Pagination scan", detail: "no limit/page/take/cursor/per_page token in handler window" },
            ],
            recommendation: "Accept cursor/offset + limit with a server-side ceiling and document the envelope { data, nextCursor }.",
          });
        }
      }
    }
  }
  return out;
}

export const apiContractAgent: AgentDef = {
  key: "api_contract_reviewer",
  name: "API / Contract Reviewer",
  category: "contract",
  stage: 35,
  async run(input, provider) {
    const local = localHeuristics(input);
    const llm = await llmAnalyze(
      provider,
      "api_contract_reviewer",
      "Focus ONLY: request/response contract issues — unvalidated input, breaking response-shape changes, missing status codes, backward compatibility, pagination and idempotency for mutating routes.",
      input,
      { categories: ["API_CONTRACT"], maxFindings: 3 },
    );
    if (llm.localOnly) {
      return { ...emptyOutcome("Contract pass complete: validation and pagination heuristics ran locally.", true), findings: local, toolCalls: ["validation-scan", "pagination-scan"] };
    }
    return { ...llm, findings: [...local, ...llm.findings] };
  },
};
