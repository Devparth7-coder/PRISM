/**
 * TEST REVIEWER — changed-behavior coverage, regression cases, concrete
 * scenarios. Recommendations are derived from the actual changed routes and
 * functions in the diff (and later materialized as generated tests).
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";

const isTest = (p: string) => /(^|\/)tests?\/|\.(test|spec)\.[a-z]+$|_test\.go$|test_/.test(p);

interface ChangedBehavior {
  file: string;
  line: number;
  kind: "route" | "function";
  name: string;
  mutating: boolean;
  authSurface: boolean;
}

function collectBehaviors(input: AgentInput): ChangedBehavior[] {
  const behaviors: ChangedBehavior[] = [];
  for (const f of input.changedFiles) {
    if (!/\.(ts|tsx|js|jsx|py)$/.test(f.path) || isTest(f.path)) continue;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        const route = /(?:[Rr]outer|app)\.(get|post|put|patch|delete)\s*\(\s*[`'"]([^`'"]+)/.exec(l.text);
        if (route) {
          behaviors.push({
            file: f.path,
            line: l.newNo,
            kind: "route",
            name: `${route[1]!.toUpperCase()} ${route[2]}`,
            mutating: ["post", "put", "patch", "delete"].includes(route[1]!),
            authSurface: /member|admin|org|user|account|auth/i.test(route[2]!),
          });
        }
        const fn = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(/.exec(l.text);
        if (fn) behaviors.push({ file: f.path, line: l.newNo, kind: "function", name: fn[1] ?? fn[2] ?? "handler", mutating: /create|update|delete|remove|add|set/i.test(fn[1] ?? fn[2] ?? ""), authSurface: /member|role|auth|permission/i.test(fn[1] ?? fn[2] ?? "") });
      }
    }
  }
  const key = (b: ChangedBehavior) => `${b.file}:${b.name}`;
  const seen = new Set<string>();
  return behaviors.filter((b) => (seen.has(key(b)) ? false : (seen.add(key(b)), true)));
}

function scenariosFor(b: ChangedBehavior): string[] {
  const scenarios = new Set<string>();
  if (b.kind === "route") {
    scenarios.add("unauthenticated request is rejected with 401");
    scenarios.add("authenticated but unauthorized role is rejected with 403");
    scenarios.add("malformed / missing required body fields return 400 with a clear error");
    if (b.mutating) {
      scenarios.add("duplicate submission (same payload twice) does not create duplicates");
      scenarios.add("not-found target id returns 404 rather than 500");
    }
    if (b.authSurface) scenarios.add("privilege escalation: a member cannot assign the owner/admin role");
    scenarios.add("happy path returns the documented status code and response shape");
  } else {
    scenarios.add("null / undefined input");
    scenarios.add("empty collection / boundary value");
    if (b.mutating) scenarios.add("idempotent retry / duplicate input");
    scenarios.add("invalid input raises a handled error, not an exception");
  }
  return [...scenarios];
}

function localHeuristics(input: AgentInput): FindingInput[] {
  const out: FindingInput[] = [];
  const testFiles = Object.keys(input.headTree).filter(isTest);
  const behaviors = collectBehaviors(input);
  for (const b of behaviors) {
    const stem = b.file.split("/").pop()!.replace(/\.[a-z]+$/, "");
    const covered = testFiles.some((t) => t.includes(stem)) || input.bundle.relationships.some((r) => r.file === b.file && r.tests.length > 0);
    if (covered) continue;
    const scenarios = scenariosFor(b);
    out.push({
      severity: b.authSurface && b.mutating ? "MEDIUM" : "LOW",
      category: "TESTS",
      title: `No tests cover ${b.kind === "route" ? "new endpoint" : "changed function"} ${b.name}`,
      description: `The PR introduces/changes ${b.name} in ${b.file} with no co-located or graph-linked test suite. The scenarios below encode the regression cases PRISM expects; without them access-control and validation fixes can silently regress.`,
      file: b.file,
      lineStart: b.line,
      lineEnd: b.line,
      confidence: 0.82,
      detector: "DETERMINISTIC",
      agent: "test_reviewer",
      evidence: [
        { kind: "changed_line", label: "Changed behavior", detail: b.name, file: b.file, line: b.line },
        { kind: "test", label: "Coverage check", detail: testFiles.length ? `Test files found: ${testFiles.slice(0, 4).join(", ")} — none target ${stem}` : "No test files detected for this module" },
        { kind: "graph", label: "Code graph TESTS edges", detail: `0 test suites link to ${b.file}` },
      ],
      impact: "Authorization bypasses, validation gaps and regressions reach main without a failing test to catch them.",
      recommendation: `Add a ${stem}.test.ts suite covering:\n- ${scenarios.join("\n- ")}\n\nUse the "Generate tests" action in PRISM to scaffold these cases from this finding.`,
    });
  }
  return out;
}

export const testAgent: AgentDef = {
  key: "test_reviewer",
  name: "Test Reviewer",
  category: "quality",
  stage: 34,
  async run(input, provider) {
    const local = localHeuristics(input);
    const llm = await llmAnalyze(
      provider,
      "test_reviewer",
      "Focus ONLY: changed behavior lacking test coverage, missing regression/edge cases. Name concrete test scenarios (auth failure, null input, duplicate submission, timeout, empty/boundary data). Do not request tests for pure refactors with no behavior change.",
      input,
      { categories: ["TESTS"], maxFindings: 4 },
    );
    if (llm.localOnly) {
      return {
        ...emptyOutcome(`Test gap analysis complete: ${local.length} changed behavior(s) lack linked test suites; concrete regression scenarios attached.`, true),
        findings: local,
        toolCalls: ["behavior-scan", "test-coverage-graph"],
      };
    }
    return { ...llm, findings: [...local, ...llm.findings] };
  },
};
