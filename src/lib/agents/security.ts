/**
 * SECURITY REVIEWER — broken access control, injection, secret exposure,
 * sensitive data leakage. Local heuristics are deterministic and evidence
 * backed; when an LLM is configured it additionally performs bounded review.
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";

const SENSITIVE_FIELDS = /password_?hash|passwordHash|passwd|secret_?hash|token_?hash|apiKey|api_key|salt|ssn|credit_?card/i;

function localHeuristics(input: AgentInput): FindingInput[] {
  const out: FindingInput[] = [];
  for (const f of input.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(f.path)) continue;
    const head = input.headTree[f.path]?.split("\n") ?? [];
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;

        // Sensitive fields serialized out through a response.
        if (
          (SENSITIVE_FIELDS.test(l.text) && /select \*|return\s|res\.|json\(|\.\.\.\w+row|\.\.\.\w+\)/i.test(l.text)) ||
          (/\.\.\.\w+/.test(l.text) && /res\.json|return\s+res/.test(head.slice(l.newNo - 1, l.newNo + 3).join(" ")))
        ) {
          const window = head.slice(Math.max(0, l.newNo - 12), l.newNo + 4).join("\n");
          if (!SENSITIVE_FIELDS.test(window)) continue;
          out.push({
            severity: "HIGH",
            category: "SECURITY",
            title: "Sensitive field may be serialized into the API response",
            description:
              "The response spreads the full data row (or explicitly includes a credential field). Password hashes/tokens must never leave the service boundary, even hashed — they enable offline cracking and account takeover from a read-only API.",
            file: f.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.8,
            detector: "DETERMINISTIC",
            agent: "security_reviewer",
            evidence: [
              { kind: "changed_line", label: "Added serialization", detail: l.text.trim().slice(0, 200), file: f.path, line: l.newNo },
              { kind: "related_code", label: "Sensitive field present in the same scope", detail: head.filter((t) => SENSITIVE_FIELDS.test(t)).slice(0, 2).map((t) => t.trim()).join("\n"), file: f.path },
              { kind: "convention", label: "Data-exposure principle", detail: "Map rows to explicit response DTOs allowlisting safe fields." },
            ],
            impact: "Credential material disclosure to API consumers; privilege escalation via offline hash cracking.",
            recommendation: "Return an explicit DTO that allowlists safe fields (id, name, role) and strips password_hash / tokens before serialization.",
          });
        }
      }
    }
  }
  return out;
}

export const securityAgent: AgentDef = {
  key: "security_reviewer",
  name: "Security Reviewer",
  category: "security",
  stage: 30,
  async run(input, provider) {
    const local = localHeuristics(input);
    const llm = await llmAnalyze(
      provider,
      "security_reviewer",
      "Focus ONLY: broken access control / authn & authz flaws, injection (SQL/command/XSS/SSRF/path traversal), insecure deserialization, secrets, insecure crypto, unsafe data exposure and privilege escalation. Never claim an issue you cannot anchor to shown code. Authentication middleware conventions are visible in the related context.",
      input,
      { categories: ["SECURITY"], maxFindings: 5 },
    );
    if (llm.localOnly) {
      return { ...emptyOutcome("Security pass complete: ran deterministic security rules and local heuristics (no LLM configured).", true), findings: local, toolCalls: ["rules-engine", "secret-scanner", "security.heuristics"] };
    }
    return { ...llm, findings: [...local.map((f) => ({ ...f, detector: "HYBRID" as const })), ...llm.findings], toolCalls: [...llm.toolCalls, "security.heuristics"] };
  },
};
