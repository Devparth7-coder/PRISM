/**
 * Deterministic static rules engine (Semgrep-style). Every rule operates on
 * real AST-lite facts (added lines + symbols + the code graph), attaches
 * evidence, and labels its output DETERMINISTIC. These findings are the
 * high-precision backbone; AI agents extend — never replace — them.
 */
import type { ChangedFile, CodeGraph, EvidenceItem, FindingInput } from "../types";
import { addedLineNumbers } from "../code/diff";

export interface RuleContext {
  changedFiles: ChangedFile[];
  baseTree: Record<string, string>;
  headTree: Record<string, string>;
  graph: CodeGraph;
  /** Glob->description custom repository rules (structured, human-authored). */
  customRules: { pattern: string; description: string; pathGlob?: string }[];
  maxComplexity: number | null;
}

interface Match {
  file: ChangedFile;
  line: number;
  text: string;
}

const addedMatches = (file: ChangedFile, re: RegExp): Match[] => {
  const out: Match[] = [];
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.type !== "add" || l.newNo === null) continue;
      re.lastIndex = 0;
      if (re.test(l.text)) out.push({ file, line: l.newNo, text: l.text });
    }
  }
  return out;
};

const F = (
  partial: Omit<FindingInput, "detector" | "agent" | "confidence" | "evidence"> &
    Partial<Pick<FindingInput, "confidence">> & { evidence: EvidenceItem[] },
  agent: string,
): FindingInput => ({ ...partial, confidence: partial.confidence ?? 0.9, detector: "DETERMINISTIC", agent });

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

function ruleSqlInjection(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  const re = /(?:query|execute|run|raw|getRepository)\s*[<(][^)]*?[`'"]?\s*(?:SELECT|INSERT|UPDATE|DELETE)/i;
  // Taint = template interpolation, request data, or string concatenation with
  // an IDENTIFIER. A trailing quote + " +" that continues onto another quoted
  // SQL fragment (multi-line SQL literal) is NOT taint.
  const tainted =
    /\$\{\s*[^}]*\}|req\.(query|params|body)|request\.|["']\s*\+\s*[A-Za-z_$][\w.$]*|[A-Za-z_$][\w.$]*\s*\+\s*["']/;
  for (const file of ctx.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(file.path)) continue;
    const headLines = ctx.headTree[file.path]?.split("\n") ?? [];
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        // A query() call may open on the preceding line(s); join up to two
        // earlier added/context lines so multi-line SQL is still detected.
        const prev1 = l.newNo >= 2 ? headLines[l.newNo - 2] ?? "" : "";
        const prev2 = l.newNo >= 3 ? headLines[l.newNo - 3] ?? "" : "";
        const joined = `${prev2}\n${prev1}\n${l.text}`;
        re.lastIndex = 0;
        tainted.lastIndex = 0;
        if (re.test(joined) && tainted.test(l.text)) {
          out.push(
            F({
              severity: "CRITICAL",
              category: "SECURITY",
              title: "SQL query built from interpolated input (SQL injection)",
              description:
                "A SQL statement is concatenated/interpolated with untrusted input. An attacker controlling that value can alter the query's structure — bypassing filters, reading or modifying arbitrary rows.",
              file: file.path,
              lineStart: l.newNo,
              lineEnd: l.newNo,
              evidence: [
                { kind: "changed_line", label: "Interpolated query on added line", detail: l.text.trim(), file: file.path, line: l.newNo },
                { kind: "static_tool", label: "Detector", detail: "rules-engine/sql-injection: SQL keyword + taint marker (template interpolation / string concat / req.*)" },
                ...parameterizedExample(file.path),
              ],
              impact: "Authentication/authorization bypass, data exfiltration or modification at the database privilege level.",
              recommendation:
                "Use parameterized queries / bound parameters (e.g. db.query('... WHERE id = ?', [id])) or the ORM's criteria API. Never concatenate request data into SQL.",
              suggestedPatch: {
                current: l.text.trim(),
                proposed: l.text
                  .replace(/`([^`]*?)\$\{([^}]+)\}([^`]*?)`/g, (_m, a, v, b) => `'${a}?' + b + "', [${v.trim()}]"`)
                  .trim(),
                explanation: "Replaces interpolation with a positional placeholder and passes the value as a bound parameter.",
              },
            }, "sql_injection_rule"),
          );
        }
      }
    }
  }
  return out;
}

function parameterizedExample(file: string): EvidenceItem[] {
  if (!/\.(ts|js)$/.test(file)) return [];
  return [{ kind: "convention", label: "Safe pattern", detail: "db.query(sqlText, [param1, param2]) — the driver escapes values as data, never as SQL syntax." }];
}

// Word-boundary guarded so identifiers like `AuthenticatedRequest` (a type)
// are not mistaken for the `authenticate(...)` guard.
const AUTH_MIDDLEWARE =
  /(?<![A-Za-z])(requireAuth|requireRole|isAuthenticated|withAuth|authMiddleware|ensureLoggedIn|verifySession)\b|\bauthenticate\s*\(/;
const ROUTE_RE = /(?:[Rr]outer|app)\.(get|post|put|patch|delete)\s*\(\s*[`'"]([^`'"]+)[`'"]\s*,?\s*(.*)$/;

function ruleMissingAuth(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  // Does this codebase protect routes with middleware at all? (avoids flagging
  // intentionally public APIs).
  const allRouteFiles = Object.entries(ctx.headTree).filter(([p]) => /route|api|controller|server/i.test(p));
  const codebaseUsesAuth = allRouteFiles.some(([, c]) => AUTH_MIDDLEWARE.test(c));
  const isLikelyPublic = (p: string, routePath: string) =>
    /(health|login|signup|register|public|webhook|\/docs|status)/i.test(p) || /(health|login|signup|register|public|webhook|docs|status)/i.test(routePath);

  for (const file of ctx.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(file.path)) continue;
    const added = addedLineNumbers(file);
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        const m = ROUTE_RE.exec(l.text);
        if (!m) continue;
        const verb = m[1]!;
        const routePath = m[2]!;
        const rest = m[3] ?? "";
        if (isLikelyPublic(file.path, routePath)) continue;
        // Multi-line route registration: inspect following lines too.
        const head = ctx.headTree[file.path]?.split("\n") ?? [];
        const windowText = head.slice(l.newNo - 1, l.newNo + 6).join("\n");
        if (AUTH_MIDDLEWARE.test(rest) || AUTH_MIDDLEWARE.test(windowText)) continue;
        if (!codebaseUsesAuth) continue;
        // Evidence: a sibling protected route.
        const sibling = allRouteFiles
          .flatMap(([, content]) => content.split("\n"))
          .find((line) => AUTH_MIDDLEWARE.test(line) && /([Rr]outer|app)\.(get|post|put|patch|delete)/.test(line));
        out.push(
          F({
            severity: "HIGH",
            category: "SECURITY",
            title: `Endpoint ${verb.toUpperCase()} ${routePath} is registered without authorization middleware`,
            description:
              "The new route handler is reachable without the authentication/authorization middleware applied to surrounding API routes. Any caller — including unauthenticated ones — can invoke it.",
            file: file.path,
            lineStart: l.newNo,
            lineEnd: Math.min(l.newNo + 2, head.length),
            confidence: 0.9,
            evidence: [
              { kind: "changed_line", label: "Newly added unprotected route", detail: l.text.trim(), file: file.path, line: l.newNo },
              ...(sibling
                ? [{ kind: "related_code" as const, label: "Sibling routes enforce auth middleware", detail: sibling.trim() }]
                : []),
              { kind: "static_tool", label: "Detector", detail: "rules-engine/missing-route-auth: route registration with no auth middleware in a codebase that uses one" },
            ],
            impact: "Broken access control: unauthenticated callers can reach an endpoint expected to be private.",
            recommendation:
              "Apply the shared authentication/authorization middleware before the handler (and require the specific role for sensitive operations, e.g. requireRole('admin')).",
            suggestedPatch: {
              current: l.text.trim(),
              proposed: l.text.replace(RegExp(`(router|app)\\.${verb}\\(([\\s\\S]*?),`), `$1.${verb}($2, requireAuth,`).trim(),
              explanation: "Inserts the repository's authentication middleware before the route handler.",
            },
          }, "missing_auth_rule"),
        );
        void added;
      }
    }
  }
  return out;
}

function ruleNPlusOne(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  const loopStart = /for\s*\(|\.forEach\s*\(|\.map\s*\(|\bwhile\s*\(/;
  const queryCall = /(await\s+)?(db|database|pool|knex|prisma|client|models?|repo|store)\b[^;]*(query|find|select|get|fetch|all|one|execute|list)/i;
  const httpCall = /await\s+(fetch|axios|http\.|client\.)/;
  for (const file of ctx.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(file.path)) continue;
    const lines = ctx.headTree[file.path]?.split("\n") ?? [];
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        if (!loopStart.test(l.text)) continue;
        const body: string[] = [];
        // heuristic body window
        for (let i = l.newNo; i < Math.min(lines.length, l.newNo + 12); i++) body.push(lines[i] ?? "");
        const awaited = body.filter((b) => /await\s+/.test(b));
        const querying = body.filter((b) => queryCall.test(b) || httpCall.test(b));
        if (awaited.length > 0 && querying.length > 0) {
          out.push(
            F({
              severity: "MEDIUM",
              category: "PERFORMANCE",
              title: "Query/request executed inside a loop (N+1 pattern)",
              description:
                "A database query or remote call is awaited per iteration. For N items this issues N round-trips instead of one batched query, so latency grows linearly with collection size.",
              file: file.path,
              lineStart: l.newNo,
              lineEnd: l.newNo,
              confidence: 0.82,
              evidence: [
                { kind: "changed_line", label: "Loop begins on an added line", detail: l.text.trim(), file: file.path, line: l.newNo },
                { kind: "changed_line", label: "Awaited query/request inside loop", detail: querying[0]!.trim(), file: file.path },
                { kind: "static_tool", label: "Detector", detail: "rules-engine/n-plus-one: loop construct + await + query verb in the same block" },
              ],
              impact: "Linear (or worse) latency; connection pool exhaustion under load; avoidable database load.",
              recommendation:
                "Collect the IDs/keys and issue a single batched query (WHERE id IN (...)) / DataLoader, then join results back in memory.",
            }, "n_plus_one_rule"),
          );
        }
      }
    }
  }
  return out;
}

const SIMPLE_RULES: {
  id: string;
  test: RegExp;
  severity: FindingInput["severity"];
  category: string;
  title: string;
  description: string;
  recommendation: string;
  include: RegExp;
  confidence?: number;
  impact?: string;
}[] = [
  {
    id: "eval",
    test: /\beval\s*\(|new Function\s*\(/,
    severity: "HIGH",
    category: "SECURITY",
    title: "Dynamic code evaluation (eval / new Function)",
    description: "Evaluating a string as code with attacker-controlled data leads to remote code execution; even with trusted inputs it defeats static analysis and CSP.",
    recommendation: "Replace eval with an explicit dispatch table / JSON parsing / the language construct actually needed.",
    include: /\.(ts|js|tsx|jsx)$/,
    impact: "Potential remote code execution in the application process.",
  },
  {
    id: "child-process-injection",
    test: /exec(?:Sync)?\s*\(\s*[`'"][^`'"]*\$\{|exec(?:Sync)?\([^,]*\+/,
    severity: "HIGH",
    category: "SECURITY",
    title: "Shell command built with interpolation",
    description: "exec/execSync with an interpolated command string allows shell metacharacter injection from any tainted value. Use execFile with an argument array.",
    recommendation: "Use execFile/spawn with separate arguments and no shell; validate inputs against an allowlist.",
    include: /\.(ts|js)$/,
    impact: "OS command injection as the application user.",
  },
  {
    id: "xss",
    test: /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\(/,
    severity: "HIGH",
    category: "SECURITY",
    title: "Unsanitized HTML sink",
    description: "Assigning untrusted content to an HTML sink enables cross-site scripting. React's dangerouslySetInnerHTML and direct innerHTML both bypass automatic escaping.",
    recommendation: "Render text content normally, or sanitize with a vetted sanitizer (DOMPurify) and document the trust boundary.",
    include: /\.(tsx?|jsx?|html)$/,
    impact: "Stored/reflected XSS, session theft, account takeover.",
  },
  {
    id: "path-traversal",
    test: /(?:readFile|writeFile|sendFile|createReadStream|path\.join)\s*\([^)]*(req\.(params|query|body)|request\.|input)/,
    severity: "HIGH",
    category: "SECURITY",
    title: "Filesystem path derived from request input",
    description: "Using request data to construct a filesystem path without containment checks enables ../ traversal outside the intended directory.",
    recommendation: "path.resolve a base directory and verify the result starts with it; prefer mapping IDs to known paths.",
    include: /\.(ts|js)$/,
    impact: "Arbitrary file read/write on the server (path traversal).",
  },
  {
    id: "ssrf",
    test: /(?:fetch|axios|got|request)\s*\(\s*(?:req\.|request\.|url\s*=\s*req)/,
    severity: "HIGH",
    category: "SECURITY",
    title: "Outbound request to user-controlled URL (SSRF)",
    description: "Fetching a user-supplied URL without validation lets attackers target internal services, cloud metadata endpoints or localhost.",
    recommendation: "Allowlist hosts/schemes, reject private/link-local IP ranges after DNS resolution, and block redirects to them.",
    include: /\.(ts|js)$/,
    impact: "Server-side request forgery against internal infrastructure.",
  },
  {
    id: "weak-hash",
    test: /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/,
    severity: "MEDIUM",
    category: "SECURITY",
    title: "Weak hash algorithm for security-sensitive data",
    description: "MD5/SHA-1 are collision-broken and unsuitable for password or token integrity. For passwords use bcrypt/scrypt/argon2; for integrity use SHA-256+.",
    recommendation: "Use argon2id/bcrypt/scrypt for passwords; SHA-256 or stronger for integrity.",
    include: /\.(ts|js|py)$/,
    impact: "Password cracking and collision attacks become practical.",
  },
  {
    id: "random-token",
    test: /(?:token|secret|password|apikey|apiKey)\w*\s*=\s*(?:Math\.random|String\.fromCharCode.*random)/,
    severity: "MEDIUM",
    category: "SECURITY",
    title: "Security token generated from Math.random()",
    description: "Math.random is not cryptographically secure; tokens and passwords derived from it are predictable.",
    recommendation: "Use crypto.randomBytes / crypto.webcrypto.getRandomValues / secrets.token_urlsafe.",
    include: /\.(ts|js)$/,
    impact: "Predictable tokens enable session/credential forgery.",
  },
  {
    id: "jwt-no-alg",
    test: /jwt\.verify\s*\([^)]*\)(?!\s*;?\s*$)/,
    severity: "LOW",
    category: "SECURITY",
    title: "jwt.verify without explicit algorithms allowlist",
    description: "Verify calls should pin accepted algorithms to prevent algorithm-confusion attacks (e.g. 'none' / HS/RS confusion).",
    recommendation: "jwt.verify(token, key, { algorithms: ['RS256'] }).",
    include: /\.(ts|js)$/,
    confidence: 0.6,
  },
  {
    id: "cors-wildcard",
    test: /Access-Control-Allow-Origin["']?\s*[,=:]\s*["']\*["']|origin:\s*["']\*["']/,
    severity: "MEDIUM",
    category: "SECURITY",
    title: "Wildcard CORS policy",
    description: "Allowing any origin — particularly combined with credentials — lets arbitrary sites invoke authenticated API routes from a victim's browser.",
    recommendation: "Reflect only allowlisted origins; never combine origin '*' with credentials.",
    include: /\.(ts|js)$/,
  },
];

function ruleSimplePatterns(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  for (const rule of SIMPLE_RULES) {
    for (const file of ctx.changedFiles) {
      if (!rule.include.test(file.path)) continue;
      for (const m of addedMatches(file, new RegExp(rule.test.source, rule.test.flags.includes("g") ? rule.test.flags : rule.test.flags + "g"))) {
        out.push(
          F({
            severity: rule.severity,
            category: rule.category,
            title: rule.title,
            description: rule.description,
            file: file.path,
            lineStart: m.line,
            lineEnd: m.line,
            confidence: rule.confidence ?? 0.88,
            evidence: [
              { kind: "changed_line", label: "Matched on an added line", detail: m.text.trim(), file: file.path, line: m.line },
              { kind: "static_tool", label: "Detector", detail: `rules-engine/${rule.id}` },
            ],
            impact: rule.impact,
            recommendation: rule.recommendation,
          }, rule.id),
        );
      }
    }
  }
  return out;
}

function ruleMissingAwait(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  for (const file of ctx.changedFiles) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) continue;
    const lines = ctx.headTree[file.path]?.split("\n") ?? [];
    const asyncFns = new Set<string>();
    for (const m of (ctx.headTree[file.path] ?? "").matchAll(/(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async)/g)) {
      asyncFns.add(m[1] ?? m[2] ?? "");
    }
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        const m = /^\s*(?:const|let|var)?\s*\w*\s*=?\s*(\w+)\s*\(/.exec(l.text);
        if (!m) continue;
        if (/\bawait\b|return\s/.test(l.text)) continue;
        if (!asyncFns.has(m[1]!)) continue;
        // If the result is later awaited it's fine; only flag when the body moves on.
        const window = lines.slice(l.newNo - 1, l.newNo + 4).join(" ");
        if (new RegExp(`await\\s+${m[1]}`).test(window)) continue;
        out.push(
          F({
            severity: "MEDIUM",
            category: "CORRECTNESS",
            title: `Async function ${m[1]}() called without await`,
            description: "The called function is async; without await the code proceeds before it settles — a promise is mistaken for its resolved value, errors are swallowed, and ordering races appear.",
            file: file.path,
            lineStart: l.newNo,
            lineEnd: l.newNo,
            confidence: 0.7,
            evidence: [
              { kind: "changed_line", label: "Call site", detail: l.text.trim(), file: file.path, line: l.newNo },
              { kind: "related_code", label: "Callee is declared async", detail: `async function ${m[1]}(...)` },
              { kind: "static_tool", label: "Detector", detail: "rules-engine/missing-await" },
            ],
            impact: "Race conditions, unhandled rejections, and stale/undefined data used downstream.",
            recommendation: "await the call (and propagate async through the caller), or explicitly document the fire-and-forget intent with void and error handling.",
          }, "missing_await_rule"),
        );
      }
    }
  }
  return out;
}

function ruleNullAfterFind(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  for (const file of ctx.changedFiles) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) continue;
    const lines = ctx.headTree[file.path]?.split("\n") ?? [];
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        const m = /(?:const|let)\s+(\w+)\s*=\s*[\w$.]+\.find\s*\(/.exec(l.text);
        if (!m) continue;
        const name = m[1]!;
        const following = lines.slice(l.newNo, l.newNo + 6);
        const guarded = following.some((x) => new RegExp(`if\\s*\\(\\s*!?\\s*${name}\\b|${name}\\s*===?\\s*null|${name}\\s*!==?\\s*(null|undefined)`).test(x));
        const dereferenced = following.some((x) => new RegExp(`\\b${name}\\.\\w+`).test(x));
        if (dereferenced && !guarded) {
          out.push(
            F({
              severity: "MEDIUM",
              category: "CORRECTNESS",
              title: `Result of .find() (${name}) is dereferenced without a null check`,
              description: "Array.find() returns undefined when nothing matches. The added code dereferences the result in the following lines, which throws a TypeError for a missing record.",
              file: file.path,
              lineStart: l.newNo,
              lineEnd: l.newNo + following.findIndex((x) => new RegExp(`\\b${name}\\.\\w+`).test(x)) + 1,
              confidence: 0.75,
              evidence: [
                { kind: "changed_line", label: ".find() call", detail: l.text.trim(), file: file.path, line: l.newNo },
                { kind: "changed_line", label: "Dereference without guard", detail: following.find((x) => new RegExp(`\\b${name}\\.\\w+`).test(x))?.trim() ?? "", file: file.path },
                { kind: "static_tool", label: "Detector", detail: "rules-engine/null-after-find: find() followed by property access with no guard in the block" },
              ],
              impact: "Runtime TypeError (500) for legitimate not-found input; often exploitable for request-level denial of service.",
              recommendation: `Check the result (if (!${name}) return respondNotFound(...)) before dereferencing; return a 404/400 at the boundary.`,
            }, "null_find_rule"),
          );
        }
      }
    }
  }
  return out;
}

function ruleComplexity(ctx: RuleContext): FindingInput[] {
  if (ctx.maxComplexity === null) return [];
  const out: FindingInput[] = [];
  for (const file of ctx.changedFiles) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) continue;
    const lines = ctx.headTree[file.path]?.split("\n") ?? [];
    const added = addedLineNumbers(file);
    const blocks: { name: string; start: number; end: number }[] = [];
    const src = ctx.headTree[file.path] ?? "";
    for (const m of src.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g)) {
      const name = m[1] ?? m[2] ?? "anonymous";
      const start = src.slice(0, m.index).split("\n").length;
      let depth = 0;
      let end = start;
      for (let i = start - 1; i < lines.length; i++) {
        for (const ch of lines[i] ?? "") {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        if (depth === 0 && i > start) {
          end = i + 1;
          break;
        }
      }
      blocks.push({ name, start, end });
    }
    for (const b of blocks) {
      if (![...added].some((n) => n >= b.start && n <= b.end)) continue;
      const body = lines.slice(b.start - 1, b.end).join("\n");
      const branches = (body.match(/\b(if|else if|for|while|case|catch|\?\?|&&|\?\s)/g) ?? []).length;
      if (branches > ctx.maxComplexity) {
        out.push(
          F({
            severity: "LOW",
            category: "MAINTAINABILITY",
            title: `Cyclomatic complexity of ${b.name}() exceeds policy (${branches} > ${ctx.maxComplexity})`,
            description: "High branch density makes the function hard to test exhaustively and concentrates defect risk.",
            file: file.path,
            lineStart: b.start,
            lineEnd: b.start,
            confidence: 0.85,
            evidence: [
              { kind: "changed_line", label: "Function changed in this PR", detail: b.name, file: file.path, line: b.start },
              { kind: "static_tool", label: "Branch count", detail: `${branches} branching constructs; policy ceiling ${ctx.maxComplexity}` },
            ],
            recommendation: "Extract cohesive helpers, use early returns, and consider a lookup/strategy table for branch-heavy dispatch.",
          }, "complexity_rule"),
        );
      }
    }
  }
  return out;
}

function ruleTestGap(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  const isTest = (p: string) => /(^|\/)tests?\/|\.(test|spec)\.[a-z]+$|_test\.go$|test_/.test(p);
  const testFiles = Object.keys(ctx.headTree).filter(isTest);
  const changedSource = ctx.changedFiles.filter((f) => f.status !== "removed" && /\.(ts|tsx|js|jsx|py|go)$/.test(f.path) && !isTest(f.path));
  for (const f of changedSource) {
    const stem = f.path.split("/").pop()!.replace(/\.[a-z]+$/, "");
    const covered =
      testFiles.some((t) => t.includes(stem)) ||
      ctx.graph.edges.some((e) => e.type === "TESTS" && e.to === f.path);
    if (covered) continue;
    const isNewLogic = f.hunks.some((h) => h.lines.some((l) => l.type === "add" && /(function|=>|router\.|app\.|def )/.test(l.text)));
    if (!isNewLogic) continue;
    const lastAdd = f.hunks.flatMap((h) => h.lines).filter((l) => l.type === "add").pop();
    out.push(
      F({
        severity: f.path.includes("route") || /api\//.test(f.path) ? "MEDIUM" : "LOW",
        category: "TESTS",
        title: `Changed logic in ${f.path} has no related test suite`,
        description:
          "The PR adds or modifies executable logic, but no test file references this module and the code graph shows no TESTS edge. Regressions here ship without a safety net.",
        file: f.path,
        lineStart: lastAdd?.newNo ?? 1,
        lineEnd: lastAdd?.newNo ?? 1,
        confidence: 0.8,
        evidence: [
          { kind: "changed_line", label: "New/changed executable code", detail: lastAdd?.text.trim().slice(0, 160) ?? "", file: f.path, line: lastAdd?.newNo ?? undefined },
          { kind: "test", label: "Test coverage", detail: testFiles.length ? `Found ${testFiles.length} test files; none target ${stem}` : "Repository contains no detected test files for this module" },
          { kind: "static_tool", label: "Detector", detail: "rules-engine/test-gap: changed source with no co-located or graph-linked tests" },
        ],
        impact: "Behavioral and security regressions reach main without a failing test.",
        recommendation: `Add ${stem}.test.ts covering the happy path, authorization failure, and at least one malformed/null input case.`,
      }, "test_gap_rule"),
    );
  }
  return out;
}

function ruleCustom(ctx: RuleContext): FindingInput[] {
  const out: FindingInput[] = [];
  for (const rule of ctx.customRules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      continue;
    }
    for (const file of ctx.changedFiles) {
      if (rule.pathGlob && !globMatch(rule.pathGlob, file.path)) continue;
      for (const h of file.hunks) {
        for (const l of h.lines) {
          if (l.type !== "add" || l.newNo === null) continue;
          re.lastIndex = 0;
          if (re.test(l.text)) {
            out.push(
              F({
                severity: "MEDIUM",
                category: "MAINTAINABILITY",
                title: `Repository rule: ${rule.description}`,
                description: `This line matches a rule configured for this repository: ${rule.description}.`,
                file: file.path,
                lineStart: l.newNo,
                lineEnd: l.newNo,
                confidence: 1,
                evidence: [
                  { kind: "changed_line", label: "Added line", detail: l.text.trim(), file: file.path, line: l.newNo },
                  { kind: "convention", label: "Repository rule", detail: `/${rule.pattern}/ ${rule.pathGlob ? `on ${rule.pathGlob}` : ""}` },
                ],
                recommendation: "Refactor the code to satisfy the repository rule, or have an administrator adjust the rule if it is obsolete.",
              }, "custom_rule"),
            );
          }
        }
      }
    }
  }
  return out;
}

function globMatch(glob: string, path: string): boolean {
  const re = new RegExp(
    "^" +
      glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§")
        .replace(/\*/g, "[^/]*")
        .replace(/§/g, ".*") +
      "$",
  );
  return re.test(path);
}

export function runRulesEngine(ctx: RuleContext): FindingInput[] {
  // Test-gap analysis is owned by the specialized Test Reviewer agent (it
  // produces concrete scenarios), not the static rules engine.
  const suites = [
    ruleSqlInjection,
    ruleMissingAuth,
    ruleNPlusOne,
    ruleSimplePatterns,
    ruleMissingAwait,
    ruleNullAfterFind,
    ruleComplexity,
    ruleCustom,
  ];
  const findings = suites.flatMap((s) => {
    try {
      return s(ctx);
    } catch (err) {
      // A broken rule must never abort the review; record and continue.
      console.warn("rule suite failed", s.name, err);
      return [];
    }
  });
  return dedupe(findings);
}

export function dedupe(findings: FindingInput[]): FindingInput[] {
  const seen = new Map<string, FindingInput>();
  for (const f of findings) {
    const key = `${f.category}|${f.file}|${f.lineStart}|${f.title}`.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, f);
    } else {
      // merge: keep highest severity/confidence, union evidence
      existing.evidence = [...existing.evidence, ...f.evidence].slice(0, 8);
      if (sevRank(f.severity) > sevRank(existing.severity)) existing.severity = f.severity;
      existing.confidence = Math.max(existing.confidence, f.confidence);
    }
  }
  return [...seen.values()];
}

const sevRank = (s: string) => ({ INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })[s] ?? 0;
