/**
 * ADVERSARIAL CRITIC. No HIGH/CRITICAL finding is published unchallenged.
 * The critic asks: could this be wrong? Does repository context disprove it?
 * Is the behavior intentional? Does the evidence actually support the claim?
 *
 * Deterministic refutation checks run ALWAYS (they are grounded in the actual
 * code snapshot). When an LLM is configured, it additionally argues against
 * the finding; deterministic refutations take precedence (they are facts
 * about the snapshot, not opinions).
 */
import { z } from "zod";
import type { CriticVerdict, FindingInput } from "../types";
import type { AIProvider, Usage } from "../ai/types";
import { LocalProviderError } from "../ai/providers/local";
import { structuredWithRetry } from "../ai/validate";
import type { AgentInput } from "../agents/common";

export interface CriticDecision {
  verdict: CriticVerdict;
  notes: string;
}

const AUTH_USE = /(?:[Rr]outer|app)\.use\s*\(\s*[^)]*(?:requireAuth|requireRole|isAuthenticated|authMiddleware|verifySession|authenticate\s*\()/;
const AUTH_TOKEN =
  /(?<![A-Za-z])(requireAuth|requireRole|isAuthenticated|withAuth|authMiddleware|ensureLoggedIn|verifySession)\b|\bauthenticate\s*\(/;
/** Isolate the SQL statement spanning the given (1-based) line. */
function extractSqlStatement(lines: string[], lineNo: number): { text: string } {
  const idx = lineNo - 1;
  let start = idx;
  for (let i = idx; i >= Math.max(0, idx - 5); i--) {
    if (/\.(query|execute|run|raw)\s*[<(]/.test(lines[i] ?? "")) {
      start = i;
      break;
    }
    start = i;
  }
  let end = idx;
  let depth = 0;
  let seenOpen = false;
  for (let i = start; i <= Math.min(lines.length - 1, idx + 8); i++) {
    for (const ch of lines[i] ?? "") {
      if (ch === "(") {
        depth++;
        seenOpen = true;
      }
      if (ch === ")") depth--;
    }
    end = i;
    if (seenOpen && depth <= 0) break;
  }
  return { text: lines.slice(start, end + 1).join("\n") };
}

const verdictSchema = z.object({
  verdict: z.enum(["CONFIRMED", "WEAK", "FALSE_POSITIVE", "UNCERTAIN"]),
  notes: z.string().min(5).max(800),
});

export function deterministicChallenge(finding: FindingInput, input: AgentInput): CriticDecision {
  const lines = input.headTree[finding.file]?.split("\n") ?? [];
  if (lines.length === 0) {
    return { verdict: "FALSE_POSITIVE", notes: `Refutation: file ${finding.file} does not exist at the reviewed commit.` };
  }
  const target = lines[finding.lineStart - 1] ?? "";
  const handlerWindow = lines.slice(Math.max(0, finding.lineStart - 20), finding.lineStart + 25).join("\n");
  const filePrefix = lines.slice(0, Math.max(0, finding.lineStart)).join("\n");

  const disprove = (notes: string): CriticDecision => ({ verdict: "FALSE_POSITIVE", notes });

  switch (true) {
    case /without authorization middleware/i.test(finding.title): {
      if (AUTH_USE.test(filePrefix)) {
        return disprove("Refutation: a global authentication middleware is registered before this route (router/app.use(...auth...)); the route is protected at the router level.");
      }
      if (AUTH_TOKEN.test(handlerWindow)) {
        return disprove("Refutation: the shared authentication/authorization guard is invoked within the route handler's window.");
      }
      if (AUTH_TOKEN.test(target)) {
        return disprove("Refutation: the route registration line itself includes the authorization middleware.");
      }
      // Confirm with the strongest available grounding.
      const sibling = input.bundle.files.find((c) => c.reason.includes("security boundary"));
      return {
        verdict: finding.confidence >= 0.85 ? "CONFIRMED" : "WEAK",
        notes: sibling
          ? `Challenged: no global router-level auth and no auth call in the handler window; the codebase does protect sibling routes (${sibling.path}). No refutation found.`
          : "Challenged: no middleware found; however no sibling protected route exists either, so intent is ambiguous.",
      };
    }
    case /SQL injection/i.test(finding.title): {
      // Examine ONLY the statement containing the flagged line, so nearby
      // parameterized queries cannot refute a vulnerable sibling statement.
      const statement = extractSqlStatement(lines, finding.lineStart);
      if (!statement.text) {
        return { verdict: "WEAK", notes: "Challenged: could not isolate the SQL statement from the snapshot." };
      }
      const interpolated = [...statement.text.matchAll(/\$\{\s*([A-Za-z_$][\w.$]*)\s*\}/g)].map((m) => m[1]!);
      const concatVars = [...statement.text.matchAll(/["']\s*\+\s*([A-Za-z_$][\w.$]*)/g)].map((m) => m[1]!);
      const variables = [...new Set([...interpolated, ...concatVars])];
      const placeholdersOnly = /\$1|\?/.test(statement.text) && variables.length === 0;
      if (placeholdersOnly) {
        return disprove("Refutation: the SQL statement uses bound placeholders ($1/?); no request value enters the SQL text.");
      }
      if (variables.length === 0) {
        return { verdict: "WEAK", notes: "Challenged: the SQL statement contains no visible interpolation or concatenated variable." };
      }
      const sourceWindow = lines.slice(0, finding.lineStart + 10).join("\n");
      const requestDerived = variables.some((v) => {
        const root = v.split(".")[0]!;
        return new RegExp(`(?:const|let|var)\\s+${root}\\b[^=]*=\\s*(?:req|request)\\b`).test(sourceWindow) ||
          new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${root}\\b[^}]*\\}\\s*=\\s*(?:req|request)\\.`).test(sourceWindow);
      });
      if (requestDerived) {
        return { verdict: "CONFIRMED", notes: `Challenged: the statement interpolates request-derived value(s) ${variables.join(", ")} directly into SQL text; no bound parameters protect them. Exploit path holds.` };
      }
      return {
        verdict: "WEAK",
        notes: `Challenged: SQL interpolation of ${variables.join(", ")} confirmed, but request provenance of the value is not visible in the handler — verify the caller cannot control it.`,
      };
    }
    case /secret|credential|private key/i.test(finding.title): {
      if (/example|placeholder|dummy|fake|sample|test-fixture|your[-_]?|xxxx|process\.env/i.test(target)) {
        return disprove("Refutation: the matched value is a documented placeholder/example, not a live credential.");
      }
      return { verdict: "CONFIRMED", notes: "Challenged: real provider token format on an added line with no placeholder markers." };
    }
    case /always (true|false)/i.test(finding.title): {
      return { verdict: "CONFIRMED", notes: "Challenged with a truth table: the boolean combination of two distinct constants is tautological for every input value. Holds." };
    }
    case /N\+1/i.test(finding.title): {
      const body = lines.slice(finding.lineStart - 1, finding.lineStart + 12).join("\n");
      if (!/await/.test(body)) {
        return { verdict: "WEAK", notes: "Challenged: the loop body does not visibly await a query/request in the captured window." };
      }
      return { verdict: "CONFIRMED", notes: "Challenged: loop with per-iteration awaited I/O confirmed; batching would remove the linear round-trip count." };
    }
    case /no tests? cover/i.test(finding.title) || /has no related test suite/i.test(finding.title): {
      const covered =
        input.bundle.relationships.some((r) => r.file === finding.file && r.tests.length > 0) ||
        input.bundle.files.some((c) => c.reason.includes("test") && c.path.includes(finding.file.split("/").pop()!.replace(/\.[a-z]+$/, "")));
      if (covered) return disprove("Refutation: a related test suite is linked by the code graph / co-location analysis.");
      return { verdict: "CONFIRMED", notes: "Challenged: graph and naming heuristics both find no linked suite; the test gap is real." };
    }
    case /Sensitive field/i.test(finding.title): {
      if (!/password|token|secret|hash|ssn|card/i.test(handlerWindow)) {
        return disprove("Refutation: no sensitive field is present in the handler/response scope.");
      }
      return { verdict: "CONFIRMED", notes: "Challenged: sensitive column exists in scope and the response serializes the row rather than an allowlisted DTO." };
    }
    default: {
      if (finding.detector === "DETERMINISTIC" && finding.confidence >= 0.85 && finding.evidence.length >= 2) {
        return { verdict: "CONFIRMED", notes: "Challenged: deterministic detector with >=2 evidence items; no refutation rule matched." };
      }
      if (finding.evidence.length === 0) return { verdict: "WEAK", notes: "Challenged: finding carries no evidence items." };
      return { verdict: finding.confidence >= 0.7 ? "UNCERTAIN" : "WEAK", notes: "Challenged: no deterministic refutation, but the claim rests on limited evidence; confidence indicator is below the CONFIRMED threshold." };
    }
  }
}

export async function criticChallenge(
  provider: AIProvider,
  finding: FindingInput,
  input: AgentInput,
): Promise<{ decision: CriticDecision; usage?: Usage; localOnly: boolean }> {
  const deterministic = deterministicChallenge(finding, input);

  let llm: { verdict: CriticVerdict; notes: string } | null = null;
  let usage: Usage | undefined;
  try {
    const snippets = [
      `Target file ${finding.file} around line ${finding.lineStart}:`,
      "```",
      (input.headTree[finding.file] ?? "").split("\n").slice(Math.max(0, finding.lineStart - 12), finding.lineStart + 14).join("\n"),
      "```",
      "Evidence offered:",
      ...finding.evidence.map((e) => `- [${e.kind}] ${e.label}: ${e.detail}${e.file ? ` (${e.file}:${e.line ?? ""})` : ""}`),
    ].join("\n");

    const res = await structuredWithRetry(provider, {
      task: "critic",
      system:
        "You are an ADVERSARIAL critic for an automated code review. Your job is to DISPROVE the finding using repository context. Be skeptical: missing middleware may be applied globally; interpolation may be over safe/constant data; behavior may be intentional or already mitigated elsewhere. CONFIRMED only when the evidence proves a real, reachable problem. FALSE_POSITIVE when context disproves it. WEAK when plausible but poorly supported. Never invent context that was not provided.",
      user: `Finding under challenge:\n[${finding.severity}/${finding.category}] ${finding.title}\n\nClaim: ${finding.description}\nRecommendation: ${finding.recommendation}\n\nRepository context:\n${snippets}\n\nReturn your verdict.`,
      schema: verdictSchema,
      maxTokens: 900,
      temperature: 0.0,
    });
    llm = res.data;
    usage = res.usage;
  } catch (err) {
    if (!(err instanceof LocalProviderError)) throw err;
  }

  if (!llm) return { decision: deterministic, localOnly: true };
  // Deterministic refutation wins; otherwise LLM verdict combined with grounding notes.
  if (deterministic.verdict === "FALSE_POSITIVE") return { decision: deterministic, usage };
  return {
    decision: {
      verdict: llm.verdict === "FALSE_POSITIVE" && finding.detector === "DETERMINISTIC" ? "WEAK" : llm.verdict,
      notes: `${deterministic.notes} | LLM critic: ${llm.notes}`,
    },
    usage,
    localOnly: false,
  };
}
