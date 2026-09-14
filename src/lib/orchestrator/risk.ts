/**
 * Explainable risk engine. Produces a 0-100 score across seven dimensions,
 * every nonzero value accompanied by a human-readable reason. Inputs are the
 * post-critic findings (false positives excluded) plus structural signals.
 */
import type {
  Finding,
  FindingInput,
  RiskBreakdown,
  RiskResult,
  Severity,
} from "../types";

type ScoredFinding = Pick<Finding, "severity" | "category" | "title" | "criticVerdict" | "confidence">;

const SEV: Record<Severity, number> = { CRITICAL: 95, HIGH: 78, MEDIUM: 45, LOW: 18, INFO: 4 };

function counts(findings: ScoredFinding[], category?: string) {
  const list = findings.filter(
    (f) =>
      (category ? f.category === category : true) &&
      f.criticVerdict !== "FALSE_POSITIVE",
  );
  const score = (sev: Severity) => list.filter((f) => f.severity === sev);
  return { list, critical: score("CRITICAL"), high: score("HIGH"), medium: score("MEDIUM"), low: score("LOW") };
}

function dimensionFromFindings(findings: ScoredFinding[], category: string): { score: number; reasons: string[] } {
  const c = counts(findings, category);
  let score = 0;
  const reasons: string[] = [];
  if (c.critical.length) {
    score = Math.max(score, 92);
    reasons.push(`${c.critical.length} critical ${category.toLowerCase()} finding(s), e.g. "${c.critical[0]!.title}"`);
  }
  if (c.high.length) {
    score = Math.max(score, 74 + Math.min(c.high.length - 1, 2) * 4);
    reasons.push(`${c.high.length} high ${category.toLowerCase()} finding(s), e.g. "${c.high[0]!.title}"`);
  }
  if (c.medium.length) {
    score = Math.max(score, 40 + Math.min(c.medium.length - 1, 4) * 4);
    reasons.push(`${c.medium.length} medium ${category.toLowerCase()} finding(s)`);
  }
  if (c.low.length) {
    score = Math.max(score, 12 + Math.min(c.low.length - 1, 4) * 2);
    if (!reasons.length) reasons.push(`${c.low.length} low ${category.toLowerCase()} finding(s)`);
  }
  return { score, reasons };
}

export function calculateRisk(input: {
  findings: (FindingInput | Finding)[];
  additions: number;
  deletions: number;
  changedFiles: number;
  hotspots: string[];
  hasTests: boolean;
  filesWithTests: number;
  changedLogicFiles: number;
}): RiskResult {
  const findings = input.findings as ScoredFinding[];
  const reasons: string[] = [];

  const security = dimensionFromFindings(findings, "SECURITY");
  const correctness = dimensionFromFindings(findings, "CORRECTNESS");
  const performance = dimensionFromFindings(findings, "PERFORMANCE");
  const maintainability = dimensionFromFindings(findings, "MAINTAINABILITY");
  const tests = dimensionFromFindings(findings, "TESTS");
  const dependencies = dimensionFromFindings(findings, "DEPENDENCIES");
  const contract = dimensionFromFindings(findings, "API_CONTRACT");

  // Scope: diff size + architectural hotspots.
  let scope = 0;
  const churn = input.additions + input.deletions;
  if (churn > 1500) scope = Math.max(scope, 60);
  else if (churn > 600) scope = Math.max(scope, 42);
  else if (churn > 200) scope = Math.max(scope, 24);
  if (input.changedFiles > 20) scope = Math.min(85, scope + 15);
  const highHotspots = input.hotspots.filter((h) => /authentic|authorization|payment|crypto/i.test(h));
  if (highHotspots.length) {
    scope = Math.min(90, scope + 20 + highHotspots.length * 6);
    reasons.push(`Changes touch ${highHotspots.join(", ")} where defects have outsized impact`);
  }
  if (churn > 600) reasons.push(`Large change surface: ${churn} lines across ${input.changedFiles} files`);

  // Test dimension also reflects structural test gaps.
  if (input.changedLogicFiles > 0 && input.filesWithTests === 0) {
    tests.score = Math.max(tests.score, input.hotspots.some((h) => /auth/i.test(h)) ? 62 : 40);
    if (!tests.reasons.length) tests.reasons.push(`${input.changedLogicFiles} changed logic file(s) with no linked test suite`);
  }

  // Contract risk feeds correctness.
  correctness.score = Math.max(correctness.score, Math.round(contract.score * 0.7));

  const breakdown: RiskBreakdown = {
    security: security.score,
    correctness: correctness.score,
    performance: performance.score,
    maintainability: maintainability.score,
    testing: tests.score,
    scope,
    dependencies: dependencies.score,
  };

  const weights: Record<keyof RiskBreakdown, number> = {
    security: 0.26,
    correctness: 0.22,
    performance: 0.1,
    maintainability: 0.07,
    testing: 0.12,
    scope: 0.11,
    dependencies: 0.12,
  };
  let score = 0;
  for (const k of Object.keys(weights) as (keyof RiskBreakdown)[]) score += breakdown[k] * weights[k]!;
  score = Math.round(score);

  const allReasons = [
    ...security.reasons.map((r) => `Security: ${r}`),
    ...correctness.reasons.map((r) => `Correctness: ${r}`),
    ...performance.reasons.map((r) => `Performance: ${r}`),
    ...dependencies.reasons.map((r) => `Dependencies: ${r}`),
    ...tests.reasons.map((r) => `Tests: ${r}`),
    ...maintainability.reasons.map((r) => `Maintainability: ${r}`),
    ...reasons,
  ];

  const level: RiskResult["level"] = score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return { score, level, breakdown, reasons: allReasons.slice(0, 10) };
}
