/**
 * Review Orchestrator — the pipeline:
 *
 * INGESTED → CONTEXT → STATIC ANALYSIS → SPECIALIZED AGENTS (parallel)
 * → CRITIC (adversarial) → EVIDENCE VERIFICATION → RISK → SYNTHESIS
 * → PUBLISH.
 *
 * Deterministic analysis always runs and is failure-independent from LLM
 * calls: a model outage degrades agents to heuristics but never blocks the
 * review. Each stage emits AgentRun/AgentEvent rows that power the live
 * timeline (SSE), run observability and the audit trail.
 */
import type {
  AgentKey,
  ChangedFile,
  FindingInput,
  ReviewMode,
  ToolResult,
  Usage,
} from "../types";
import { db, id } from "../db/client";
import {
  getBlobs,
  getChangedFiles,
  getLatestSnapshot,
  getPullRequest,
  getRepositoryById,
} from "../db/repo/repositories";
import {
  completeRun,
  completeReview,
  createReview,
  failReview,
  getReview,
  latestCompletedReviewForPr,
  listFindingsForReview,
  markPublished,
  recordTool,
  saveArtifact,
  setReviewStatus,
  startRun,
  addEvent,
  insertFinding,
} from "../db/repo/reviews";
import { scanSecrets } from "../analysis/secret-scan";
import { runRulesEngine } from "../analysis/rules-engine";
import { runExternalTools } from "../analysis/external-tools";
import { buildContext } from "../code/context";
import { selectProvider } from "../ai/router";
import { LOCAL_PROVIDER_ID } from "../ai/types";
import { deriveIntent } from "../agents/intent";
import { securityAgent } from "../agents/security";
import { bugAgent } from "../agents/bug";
import { performanceAgent } from "../agents/performance";
import { maintainabilityAgent } from "../agents/maintainability";
import { testAgent } from "../agents/tests";
import { apiContractAgent } from "../agents/api-contract";
import { dependencyAgent } from "../agents/dependency";
import type { AgentDef, AgentInput, AgentOutcome } from "../agents/common";
import { criticChallenge } from "./critic";
import { verifyAll } from "./evidence";
import { calculateRisk } from "./risk";
import {
  buildGithubPayload,
  buildSummaryMd,
  compareRegression,
  decideRecommendation,
  mergeFindings,
  stableFingerprint,
  type MergedFinding,
} from "./synthesis";
import { getPolicyForRepo, listMemory, listRules, savePublication, addMemory } from "../db/repo/governance";
import { generateRouteTest } from "../agents/test-gen";
import { submitReview } from "../github/app";
import { config } from "../config";
import { log, withCorrelation, newCorrelationId } from "../logger";

export const AGENT_CATALOG: { key: AgentKey; name: string; description: string; category: string; stage: number }[] = [
  { key: "context", name: "Context Engine", description: "Builds the bounded repository-context bundle and code relationship graph.", category: "pipeline", stage: 10 },
  { key: "static", name: "Static Analysis", description: "Secret scan, dependency advisories, Semgrep-style rule engine, available external tools.", category: "pipeline", stage: 20 },
  { key: "bug_hunter", name: "Bug Hunter", description: "Logical errors, impossible conditions, null handling, races, async misuse.", category: "correctness", stage: 31 },
  { key: "security_reviewer", name: "Security Reviewer", description: "Access control, injection, secrets, crypto, sensitive data exposure.", category: "security", stage: 30 },
  { key: "performance_reviewer", name: "Performance Reviewer", description: "N+1 access, unbounded fetches, algorithmic and rendering regressions.", category: "performance", stage: 32 },
  { key: "maintainability_reviewer", name: "Maintainability Reviewer", description: "Duplication, complexity, architecture violations — no nitpicks.", category: "quality", stage: 33 },
  { key: "test_reviewer", name: "Test Reviewer", description: "Coverage of changed behavior, regression and edge-case scenarios.", category: "quality", stage: 34 },
  { key: "api_contract_reviewer", name: "API / Contract Reviewer", description: "Input validation, response contracts, pagination, compatibility.", category: "contract", stage: 35 },
  { key: "dependency_reviewer", name: "Dependency Reviewer", description: "Advisory matching (deterministic) and dependency risk review.", category: "supply-chain", stage: 36 },
  { key: "critic", name: "Adversarial Critic", description: "Challenges every HIGH/CRITICAL finding; searches for refuting context.", category: "trust", stage: 50 },
  { key: "evidence", name: "Evidence Verifier", description: "Grounds every finding to real files, changed lines and cited evidence.", category: "trust", stage: 55 },
  { key: "risk", name: "Risk Engine", description: "Explainable 0–100 risk across seven dimensions.", category: "trust", stage: 60 },
  { key: "synthesizer", name: "Review Synthesizer", description: "Deduplicates, merges agents' findings, scores regression, renders the review.", category: "pipeline", stage: 70 },
];

export function ensureAgentCatalog(): void {
  const stmt = db().prepare("INSERT OR IGNORE INTO agents (key, name, description, category, stage, enabled) VALUES (?,?,?,?,?,1)");
  for (const a of AGENT_CATALOG) stmt.run(a.key, a.name, a.description, a.category, a.stage);
}

const SPECIALISTS: AgentDef[] = [
  securityAgent,
  bugAgent,
  performanceAgent,
  maintainabilityAgent,
  testAgent,
  apiContractAgent,
  dependencyAgent,
];

function selectAgents(mode: ReviewMode, files: ChangedFile[], pathReviewers: { glob: string; agents: string[] }[]): AgentDef[] {
  let keys: AgentKey[];
  switch (mode) {
    case "fast":
      keys = ["security_reviewer", "bug_hunter", "dependency_reviewer"];
      break;
    case "deep":
    case "standard":
      keys = SPECIALISTS.map((a) => a.key);
      break;
    case "security":
      keys = ["security_reviewer", "dependency_reviewer", "api_contract_reviewer"];
      break;
    case "test":
      keys = ["test_reviewer", "bug_hunter"];
      break;
  }
  for (const pr of pathReviewers) {
    const glob = new RegExp(
      "^" + pr.glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$",
    );
    if (files.some((f) => glob.test(f.path))) for (const a of pr.agents as AgentKey[]) if (!keys.includes(a)) keys.push(a);
  }
  return SPECIALISTS.filter((a) => keys.includes(a.key)).sort((a, b) => a.stage - b.stage);
}

export interface ReviewJobPayload {
  prId: string;
  snapshotId?: string;
  headSha?: string;
  mode?: ReviewMode;
}

/** Idempotent: the same PR commit is never reviewed twice concurrently. */
export async function startReview(payload: ReviewJobPayload): Promise<string> {
  const pr = getPullRequest(payload.prId);
  if (!pr) throw new Error("Pull request not found");
  const snapshotId = payload.snapshotId ?? getLatestSnapshot(pr.id, payload.headSha ?? pr.head_sha)?.id;
  if (!snapshotId) throw new Error("No snapshot for PR commit");

  const existing = db()
    .prepare("SELECT id, status FROM reviews WHERE pr_id=? AND snapshot_id=? AND status IN ('QUEUED','INGESTING','CONTEXT','STATIC_ANALYSIS','AGENTS','CRITIC','VERIFICATION','RISK','SYNTHESIS','PUBLISHING','COMPLETED')")
    .get(pr.id, snapshotId) as { id: string; status: string } | undefined;
  if (existing) return existing.id;

  const repo = getRepositoryById(pr.repository_id);
  return createReview({
    prId: pr.id,
    snapshotId,
    mode: payload.mode ?? (config.reviewMode as ReviewMode),
    headSha: pr.head_sha,
    isDemo: Boolean(repo?.is_demo),
  });
}

export async function runReview(payload: ReviewJobPayload): Promise<string> {
  const correlationId = newCorrelationId();
  return withCorrelation({ correlation_id: correlationId }, () => execute(payload));
}

async function execute(payload: ReviewJobPayload): Promise<string> {
  const startedAt = Date.now();
  const reviewId = await startReview(payload);
  const review = getReview(reviewId)!;
  if (review.status === "COMPLETED") return reviewId; // idempotent replay

  const pr = getPullRequest(review.pr_id)!;
  const repo = getRepositoryById(pr.repository_id)!;
  const files = getChangedFiles(review.snapshot_id);
  const baseTree = getBlobs(repo.id, pr.base_sha);
  const headTree = getBlobs(repo.id, pr.head_sha);
  const policy = getPolicyForRepo(repo.id);
  const rules = listRules(repo.id).filter((r) => r.enabled);
  const memory = listMemory(repo.id);
  const pathReviewers = JSON.parse(policy.path_reviewers_json) as { glob: string; agents: string[] }[];
  const mode = (review.mode as ReviewMode) ?? "standard";

  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  const providerChoice = selectProvider();
  const providerModel = providerChoice.isLocal ? LOCAL_PROVIDER_ID : provider.provider.model;

  const fail = async (friendly: string, err: unknown) => {
    log.error("review failed", { reviewId, error: err instanceof Error ? err.message : String(err) });
    failReview(reviewId, friendly);
    addEvent(reviewId, { stage: "FAILED", level: "error", message: friendly });
  };

  try {
    log.info("review started", { reviewId, pr: pr.number, repo: repo.full_name, mode });
    addEvent(reviewId, { stage: "INGESTING", level: "info", message: `PR #${pr.number} received at commit ${pr.head_sha.slice(0, 7)}` });
    setReviewStatus(reviewId, "INGESTING");

    // ------------------------------------------------------------ 1. context
    setReviewStatus(reviewId, "CONTEXT");
    const contextRun = startRun(reviewId, "context", "Context Engine");
    const tContext = Date.now();
    const budget = mode === "deep" ? 150_000 : mode === "fast" ? 50_000 : 90_000;
    const bundle = buildContext({ tree: headTree, changedFiles: files, budgetChars: budget });
    addEvent(reviewId, {
      stage: "CONTEXT",
      level: "success",
      runId: contextRun,
      message: `Context bundle built: ${bundle.files.length} files, ${(bundle.totalChars / 1024).toFixed(1)}k chars; ${bundle.relationships.length} graph relationships; hotspots: ${bundle.hotspots.join(", ") || "none"}`,
    });
    completeRun(contextRun, {
      status: "COMPLETED",
      decisionSummary: `Selected ${bundle.files.length} relevant files within a ${(budget / 1024).toFixed(0)}k-char budget; mapped ${bundle.changedSymbols.length} changed symbol(s), ${bundle.relationships.length} relationship group(s).`,
      findingsCount: 0,
      toolCalls: bundle.files.length,
      model: null,
    });
    db().prepare("UPDATE agent_runs SET duration_ms=? WHERE id=?").run(Date.now() - tContext, contextRun);

    // PR understanding (public summary only — no hidden reasoning persisted).
    const intentResult = await deriveIntent(providerChoice.provider, pr.title, pr.body ?? "", files);
    if (intentResult.usage) {
      totalIn += intentResult.usage.inputTokens;
      totalOut += intentResult.usage.outputTokens;
      totalCost += intentResult.usage.costUsd;
    }
    addEvent(reviewId, {
      stage: "CONTEXT",
      level: "info",
      message: `Intent: ${intentResult.intent.intent}`,
      data: intentResult.intent,
    });
    // Persist intent now (completeReview would overwrite; store via artifact).
    saveArtifact(reviewId, "intent", "intent.json", JSON.stringify(intentResult.intent, null, 2));

    // --------------------------------------------------- 2. static analysis
    setReviewStatus(reviewId, "STATIC_ANALYSIS");
    const staticRun = startRun(reviewId, "static", "Static Analysis");
    const staticFindings: FindingInput[] = [];

    const secretRunTools: ToolResult[] = [];
    const tSecrets = Date.now();
    const secrets = scanSecrets(files, headTree);
    staticFindings.push(...secrets);
    recordTool(staticRun, { tool: "secret-scanner", status: "success", summary: `${secrets.length} secret format match(es) on added lines`, durationMs: Date.now() - tSecrets });
    secretRunTools.push({ tool: "secret-scanner", status: "success", summary: `${secrets.length} match(es)`, durationMs: Date.now() - tSecrets });

    const tRules = Date.now();
    const ruleFindings = runRulesEngine({
      changedFiles: files,
      baseTree,
      headTree,
      graph: bundle.built.graph,
      customRules: rules.map((r) => ({ pattern: r.pattern, description: r.description, pathGlob: r.path_glob ?? undefined })),
      maxComplexity: policy.max_complexity,
    });
    staticFindings.push(...ruleFindings);
    recordTool(staticRun, { tool: "rules-engine", status: "success", summary: `${ruleFindings.length} deterministic rule finding(s)`, durationMs: Date.now() - tRules });
    secretRunTools.push({ tool: "rules-engine", status: "success", summary: `${ruleFindings.length} finding(s)`, durationMs: Date.now() - tRules });

    addEvent(reviewId, { stage: "STATIC_ANALYSIS", level: "success", runId: staticRun, message: `Rule engine: ${ruleFindings.length} finding(s); secret scanner: ${secrets.length}.` });

    // External tools run sandboxed; missing tools report SKIPPED honestly.
    let external: ToolResult[] = [];
    try {
      external = await runExternalTools(Object.fromEntries(bundle.files.filter((f) => f.reason === "changed in PR").map((f) => [f.path, f.content])));
      for (const t of external) recordTool(staticRun, t);
    } catch (err) {
      const t: ToolResult = { tool: "external", status: "error", summary: `External tool stage failed: ${err instanceof Error ? err.message : "unknown"}`, durationMs: 0 };
      external = [t];
      recordTool(staticRun, t);
    }

    completeRun(staticRun, {
      status: "COMPLETED",
      decisionSummary: `Deterministic pass complete: ${staticFindings.length} finding(s) before AI agents. Tools: ${external.map((t) => `${t.tool}=${t.status}`).join(", ")}.`,
      findingsCount: staticFindings.length,
      toolCalls: external.length + 2,
      model: null,
    });
    addEvent(reviewId, { stage: "STATIC_ANALYSIS", level: "info", message: `Static analysis complete — ${staticFindings.length} deterministic finding(s). External tools: ${external.map((t) => t.status).join(", ") || "none"}.` });

    // ------------------------------------------------------------- agents
    setReviewStatus(reviewId, "AGENTS");
    const agentDefs = selectAgents(mode, files, pathReviewers);
    const agentInput: AgentInput = {
      pr,
      repository: repo,
      changedFiles: files,
      baseTree,
      headTree,
      bundle,
      deterministic: staticFindings,
      memory,
      rules,
      mode,
    };

    const outcomes = new Map<AgentKey, AgentOutcome>();
    // Bounded concurrency (rate-limit hygiene for LLM providers).
    const queue = [...agentDefs];
    const CONCURRENCY = providerChoice.isLocal ? 4 : 2;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const def = queue.shift()!;
        const runId = startRun(reviewId, def.key, def.name);
        addEvent(reviewId, { stage: "AGENTS", level: "info", runId, message: `${def.name} started (${providerChoice.isLocal ? "local deterministic" : providerChoice.provider.label})` });
        try {
          const outcome = await def.run(agentInput, providerChoice.provider);
          if (outcome.usage) {
            totalIn += outcome.usage.inputTokens;
            totalOut += outcome.usage.outputTokens;
            totalCost += outcome.usage.costUsd;
          }
          outcomes.set(def.key, outcome);
          completeRun(runId, {
            status: "COMPLETED",
            decisionSummary: outcome.decisionSummary,
            findingsCount: outcome.findings.length,
            toolCalls: outcome.toolCalls.length,
            model: providerModel,
            tokensIn: outcome.usage?.inputTokens ?? 0,
            tokensOut: outcome.usage?.outputTokens ?? 0,
            costUsd: outcome.usage?.costUsd ?? 0,
          });
          addEvent(reviewId, {
            stage: "AGENTS",
            level: "success",
            runId,
            message: `${def.name} complete — ${outcome.findings.length} finding(s), ${outcome.toolCalls.length} tool call(s).`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          completeRun(runId, { status: "FAILED", decisionSummary: `Agent failed: ${message.slice(0, 300)}`, findingsCount: 0, toolCalls: 0, error: message.slice(0, 600), model: providerModel });
          addEvent(reviewId, { stage: "AGENTS", level: "warn", runId, message: `${def.name} failed — continuing with deterministic results: ${message.slice(0, 160)}` });
          // Agent failure must not kill the review; record empty outcome.
          outcomes.set(def.key, { decisionSummary: `failed: ${message}`, findings: [], toolCalls: [], localOnly: providerChoice.isLocal });
        }
      }
    });
    await Promise.all(workers);

    const allAgentFindings = [...outcomes.values()].flatMap((o) => o.findings);
    const merged: MergedFinding[] = mergeFindings([...staticFindings, ...allAgentFindings]);
    addEvent(reviewId, { stage: "AGENTS", level: "info", message: `Mesh produced ${allAgentFindings.length + staticFindings.length} raw findings; merged to ${merged.length} unique issue(s).` });

    // -------------------------------------------------------------- critic
    setReviewStatus(reviewId, "CRITIC");
    const criticRun = startRun(reviewId, "critic", "Adversarial Critic");
    const challenged = merged.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL");
    let confirmed = 0;
    let weak = 0;
    let falsePositives = 0;
    for (const f of challenged) {
      try {
        const { decision, usage } = await criticChallenge(providerChoice.provider, f, agentInput);
        f.criticVerdict = decision.verdict;
        f.criticNotes = decision.notes;
        if (usage) {
          totalIn += usage.inputTokens;
          totalOut += usage.outputTokens;
          totalCost += usage.costUsd;
        }
        if (decision.verdict === "CONFIRMED") confirmed++;
        if (decision.verdict === "WEAK") {
          weak++;
          f.confidence = Math.min(f.confidence, 0.7);
        }
        if (decision.verdict === "FALSE_POSITIVE") falsePositives++;
        addEvent(reviewId, {
          stage: "CRITIC",
          level: decision.verdict === "CONFIRMED" ? "success" : decision.verdict === "FALSE_POSITIVE" ? "warn" : "info",
          runId: criticRun,
          message: `${decision.verdict} — "${f.title}" (${f.file}:${f.lineStart})`,
        });
      } catch (err) {
        f.criticVerdict = "UNCERTAIN";
        f.criticNotes = `Critic unavailable: ${err instanceof Error ? err.message : "error"}`;
      }
    }
    completeRun(criticRun, {
      status: "COMPLETED",
      decisionSummary: `Challenged ${challenged.length} HIGH/CRITICAL finding(s): ${confirmed} confirmed, ${weak} weak, ${falsePositives} refuted as false positives.`,
      findingsCount: confirmed,
      toolCalls: challenged.length,
      model: providerModel,
    });
    addEvent(reviewId, { stage: "CRITIC", level: "info", runId: criticRun, message: `Critic complete: ${confirmed} confirmed, ${weak} weak, ${falsePositives} refuted.` });

    // ------------------------------------------------------- evidence verify
    setReviewStatus(reviewId, "VERIFICATION");
    const evidenceRun = startRun(reviewId, "evidence", "Evidence Verifier");
    const { kept, rejected } = verifyAll(merged, files, headTree);
    for (const r of rejected) {
      addEvent(reviewId, { stage: "VERIFICATION", level: "warn", runId: evidenceRun, message: `Rejected ungrounded finding: "${r.finding.title}" — ${r.notes.join("; ")}` });
    }
    completeRun(evidenceRun, {
      status: "COMPLETED",
      decisionSummary: `Verified ${kept.length} finding(s) against the snapshot; rejected ${rejected.length} ungrounded finding(s).`,
      findingsCount: kept.length,
      toolCalls: merged.length,
    });
    addEvent(reviewId, { stage: "VERIFICATION", level: "success", runId: evidenceRun, message: `Evidence verification: ${kept.length} grounded, ${rejected.length} rejected.` });

    // -------------------------------------------------------------- risk
    setReviewStatus(reviewId, "RISK");
    const riskRun = startRun(reviewId, "risk", "Risk Engine");
    const activeFindings = kept.filter((f) => f.criticVerdict !== "FALSE_POSITIVE");
    const refuted = kept.filter((f) => f.criticVerdict === "FALSE_POSITIVE");
    const changedLogic = files.filter((f) => /\.(ts|tsx|js|py|go)$/.test(f.path) && f.hunks.some((h) => h.lines.some((l) => l.type === "add" && /function|=>|router\.|def /.test(l.text))));
    const testFilesInBundle = bundle.files.filter((c) => /test|spec/i.test(c.path)).length;
    const risk = calculateRisk({
      findings: activeFindings,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      changedFiles: files.length,
      hotspots: bundle.hotspots,
      hasTests: testFilesInBundle > 0,
      filesWithTests: testFilesInBundle,
      changedLogicFiles: changedLogic.length,
    });
    completeRun(riskRun, {
      status: "COMPLETED",
      decisionSummary: `Risk ${risk.score}/100 (${risk.level}). Drivers: ${risk.reasons.slice(0, 3).join(" | ") || "none"}`,
      findingsCount: activeFindings.length,
      toolCalls: 7,
    });
    addEvent(reviewId, { stage: "RISK", level: "info", runId: riskRun, message: `Risk calculated: ${risk.score}/100 (${risk.level}).` });

    // ---------------------------------------------------------- synthesis
    setReviewStatus(reviewId, "SYNTHESIS");
    const synthRun = startRun(reviewId, "synthesizer", "Review Synthesizer");
    const previous = latestCompletedReviewForPr(pr.id, reviewId);
    const previousFindings = previous ? listFindingsForReview(previous.id) : [];
    const regression = compareRegression(kept, previousFindings);
    for (const f of kept) {
      const fp = stableFingerprint(f);
      f.regression = regression.current.get(fp);
    }
    for (const fixed of regression.fixed) {
      db().prepare("UPDATE findings SET status='FIXED', regression='FIXED' WHERE id=?").run(fixed.id);
      // Learn nothing automatically; the fixed transition is factual state.
    }

    const untestedAuth = activeFindings.some(
      (f) => f.category === "TESTS" && /member|role|auth|admin|org/i.test(f.file + f.title) && f.severity === "MEDIUM",
    );
    const decision = decideRecommendation({
      findings: activeFindings,
      policy,
      mode,
      hasUntestedAuthBehavior: untestedAuth && policy.require_tests === 1,
    });

    const topConcerns = activeFindings
      .filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH")
      .sort((a, b) => b.confidence - a.confidence)
      .map((f) => `${f.title} (\`${f.file}:${f.lineStart}\`, ${f.criticVerdict ?? "n/a"})`);

    const toolSummaries: ToolResult[] = secretRunTools.concat(external);
    const testGaps = activeFindings.filter((f) => f.category === "TESTS").length;
    const dashboardUrl = `${config.baseUrl}/reviews/${reviewId}`;
    const summaryMd = buildSummaryMd({
      isDemo: Boolean(repo.is_demo),
      prNumber: pr.number,
      recommendation: decision.recommendation,
      findings: activeFindings,
      risk,
      staticTools: toolSummaries.map((t) => ({ tool: t.tool, status: t.status, summary: t.summary })),
      testGaps,
      dashboardUrl,
      topConcerns,
    });

    const githubPayload = buildGithubPayload({
      recommendation: decision.recommendation,
      findings: activeFindings,
      summaryMd,
      files,
    });

    // Persist findings (refuted ones are NOT persisted).
    const insertedIds = new Map<MergedFinding, string>();
    for (const f of activeFindings) {
      const priorMatch = previousFindings.find((p) => p.fingerprint === stableFingerprint(f));
      const fid = insertFinding(reviewId, f, {
        fingerprint: stableFingerprint(f),
        criticVerdict: f.criticVerdict,
        criticNotes: f.criticNotes,
        regression: f.regression,
        mergedFrom: f.mergedFrom.length > 1 ? f.mergedFrom : undefined,
        previousFindingId: priorMatch?.id,
      });
      insertedIds.set(f, fid);
    }
    void refuted;

    // Test scaffolding artifacts for TESTS findings (never auto-applied).
    for (const f of activeFindings.filter((x) => x.category === "TESTS")) {
      const fid = insertedIds.get(f);
      if (!fid) continue;
      const persisted = listFindingsForReview(reviewId).find((x) => x.id === fid);
      if (!persisted) continue;
      const gen = generateRouteTest(persisted);
      if (gen) saveArtifact(reviewId, "test_patch", gen.filename, gen.content);
    }

    // Reports.
    saveArtifact(reviewId, "markdown", "prism-review.md", summaryMd);
    saveArtifact(
      reviewId,
      "json",
      "prism-review.json",
      JSON.stringify(
        {
          reviewId,
          pr: { number: pr.number, title: pr.title, headSha: pr.head_sha, repo: repo.full_name },
          recommendation: decision.recommendation,
          recommendationReasons: decision.reasons,
          risk,
          intent: intentResult.intent,
          findings: activeFindings.map((f) => ({
            severity: f.severity,
            category: f.category,
            title: f.title,
            file: f.file,
            lineStart: f.lineStart,
            confidence: f.confidence,
            detector: f.detector,
            criticVerdict: f.criticVerdict ?? null,
            evidence: f.evidence,
            recommendation: f.recommendation,
            suggestedPatch: f.suggestedPatch ?? null,
          })),
          rejected: rejected.map((r) => ({ title: r.finding.title, reasons: r.notes })),
          usage: { inputTokens: totalIn, outputTokens: totalOut, estimatedCostUsd: Number(totalCost.toFixed(6)), model: providerModel },
        },
        null,
        2,
      ),
    );
    saveArtifact(reviewId, "github_review", "github-review.json", JSON.stringify(githubPayload, null, 2));

    completeRun(synthRun, {
      status: "COMPLETED",
      decisionSummary: `Recommendation ${decision.recommendation}: ${decision.reasons.join("; ")}. ${regression.fixed.length} prior finding(s) fixed, ${activeFindings.filter((f) => f.regression === "PERSISTENT").length} persistent, ${activeFindings.filter((f) => f.regression === "NEW").length} new.`,
      findingsCount: activeFindings.length,
      toolCalls: 3,
    });

    completeReview({
      reviewId,
      risk,
      recommendation: decision.recommendation,
      summaryMd,
      intent: intentResult.intent,
      model: providerModel,
      provider: providerChoice.isLocal ? LOCAL_PROVIDER_ID : providerChoice.provider.id,
      tokensIn: totalIn,
      tokensOut: totalOut,
      costUsd: totalCost,
      durationMs: Date.now() - startedAt,
    });

    // ------------------------------------------------------------- publish
    setReviewStatus(reviewId, "PUBLISHING");
    await publish(reviewId, repo, pr.number, githubPayload, Boolean(repo.is_demo));

    addEvent(reviewId, {
      stage: "COMPLETED",
      level: "success",
      message: `Review published — ${decision.recommendation.replace(/_/g, " ")}, risk ${risk.score}/100, ${activeFindings.length} findings (${((Date.now() - startedAt) / 1000).toFixed(1)}s).`,
    });
    log.info("review complete", {
      reviewId,
      recommendation: decision.recommendation,
      risk: risk.score,
      findings: activeFindings.length,
      durationMs: Date.now() - startedAt,
      msCost: Number(totalCost.toFixed(4)),
    });
    return reviewId;
  } catch (err) {
    const friendly = friendlyError(err);
    await fail(friendly, err);
    throw err;
  }
}

async function publish(
  reviewId: string,
  repo: { id: string; is_demo: number; installation_id: string | null; owner: string; name: string },
  prNumber: number,
  payload: { event: string; body: string; comments: unknown[] },
  isDemo: boolean,
): Promise<void> {
  const installation = repo.installation_id
    ? (db().prepare("SELECT * FROM installations WHERE id=?").get(repo.installation_id) as
        | { github_id: number | null; status: string }
        | undefined)
    : undefined;

  const live = !isDemo && config.mode === "live" && installation?.github_id && !repo.is_demo;
  if (!live) {
    const reasons = isDemo
      ? "DEMO MODE: no GitHub call is made; the exact review payload is stored for inspection."
      : config.mode !== "live"
        ? "PRISM is not in live mode (set PRISM_MODE=live with a configured GitHub App)."
        : "Repository is not linked to a GitHub App installation.";
    savePublication({ reviewId, mode: "demo_simulation", payload, status: "simulated" });
    markPublished(reviewId);
    addEvent(reviewId, { stage: "PUBLISHING", level: "info", message: `Review payload prepared (${payload.comments.length} inline comments). ${reasons}` });
    return;
  }
  try {
    const result = await submitReview(installation!.github_id!, repo.owner, repo.name, prNumber, payload as Parameters<typeof submitReview>[4]);
    savePublication({ reviewId, mode: "live", payload, status: "published", githubId: String(result.id) });
    markPublished(reviewId);
    addEvent(reviewId, { stage: "PUBLISHING", level: "success", message: `GitHub review #${result.id} posted with ${payload.comments.length} inline comment(s).` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    savePublication({ reviewId, mode: "live", payload, status: "failed", error: message.slice(0, 600) });
    addEvent(reviewId, { stage: "PUBLISHING", level: "error", message: `GitHub publication failed (the review remains available in the dashboard): ${message.slice(0, 200)}` });
    markPublished(reviewId); // review content itself is complete
  }
}

function friendlyError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/contents fetch|tree fetch|PR fetch|token exchange/i.test(m)) {
    return "Repository snapshot could not be retrieved from GitHub. Check installation permissions and retry.";
  }
  if (/snapshot/i.test(m)) return "PR snapshot is incomplete; re-ingest the pull request and retry.";
  if (/database|sqlite|SQLITE/i.test(m)) return "A database error occurred while processing the review.";
  return `Review failed during processing: ${m.slice(0, 200)}`;
}

/** Feedback → repository knowledge. We DO NOT train models; we store structured memory. */
export function recordFeedbackMemory(repoId: string, finding: { title: string; category: string; file: string }, action: string, note?: string): void {
  const kind = action === "accepted_risk" ? "exception" : action === "false_positive" ? "accepted_pattern" : "feedback";
  addMemory({
    repositoryId: repoId,
    kind,
    content: `[${action}] ${finding.category}: "${finding.title}" at ${finding.file}.${note ? ` Note: ${note}` : ""} Consider a repository rule if this recurs.`,
  });
}

void id;
