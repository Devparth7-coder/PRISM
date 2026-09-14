import { db, id } from "../client";
import type {
  CriticVerdict,
  EvidenceItem,
  FindingInput,
  FindingStatus,
  Recommendation,
  ReviewStatus,
  RiskResult,
} from "../../types";

export interface ReviewRow {
  id: string;
  pr_id: string;
  snapshot_id: string;
  mode: string;
  status: ReviewStatus;
  risk_score: number | null;
  risk_json: string | null;
  recommendation: Recommendation | null;
  summary_md: string | null;
  intent_json: string | null;
  head_sha: string;
  model: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number | null;
  error: string | null;
  is_demo: number;
  is_stale: number;
  published_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface FindingRow {
  id: string;
  review_id: string;
  fingerprint: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  file: string | null;
  line_start: number | null;
  line_end: number | null;
  confidence: number;
  impact: string | null;
  recommendation: string;
  suggested_patch_json: string | null;
  detector: string;
  agent: string;
  critic_verdict: CriticVerdict | null;
  critic_notes: string | null;
  status: FindingStatus;
  regression: string | null;
  merged_from_json: string | null;
  previous_finding_id: string | null;
  dismissed_reason: string | null;
  dismissed_note: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface AgentRunRow {
  id: string;
  review_id: string;
  agent_key: string;
  display_name: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  tool_calls: number;
  findings_count: number;
  decision_summary: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface AgentEventRow {
  id: number;
  review_id: string;
  run_id: string | null;
  stage: string;
  level: string;
  message: string;
  data_json: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- reviews ---

export function createReview(input: {
  prId: string;
  snapshotId: string;
  mode: string;
  headSha: string;
  isDemo: boolean;
}): string {
  const rid = id("rev");
  db()
    .prepare(
      `INSERT INTO reviews (id, pr_id, snapshot_id, mode, status, head_sha, is_demo)
       VALUES (?,?,?,?,'QUEUED',?,?)`,
    )
    .run(rid, input.prId, input.snapshotId, input.mode, input.headSha, input.isDemo ? 1 : 0);
  return rid;
}

export function getReview(reviewId: string): ReviewRow | undefined {
  return db().prepare("SELECT * FROM reviews WHERE id=?").get(reviewId) as ReviewRow | undefined;
}

export function listReviewsForPr(prId: string): ReviewRow[] {
  return db().prepare("SELECT * FROM reviews WHERE pr_id=? ORDER BY created_at DESC").all(prId) as ReviewRow[];
}

export function latestCompletedReviewForPr(prId: string, excludeReviewId?: string): ReviewRow | undefined {
  if (excludeReviewId) {
    return db()
      .prepare(
        "SELECT * FROM reviews WHERE pr_id=? AND status='COMPLETED' AND id<>? ORDER BY created_at DESC LIMIT 1",
      )
      .get(prId, excludeReviewId) as ReviewRow | undefined;
  }
  return db()
    .prepare("SELECT * FROM reviews WHERE pr_id=? AND status='COMPLETED' ORDER BY created_at DESC LIMIT 1")
    .get(prId) as ReviewRow | undefined;
}

export function setReviewStatus(reviewId: string, status: ReviewStatus, error?: string): void {
  db().prepare("UPDATE reviews SET status=?, error=? WHERE id=?").run(status, error ?? null, reviewId);
}

export function completeReview(input: {
  reviewId: string;
  risk: RiskResult;
  recommendation: Recommendation;
  summaryMd: string;
  intent: unknown;
  model: string | null;
  provider: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
}): void {
  db()
    .prepare(
      `UPDATE reviews SET status='COMPLETED', risk_score=?, risk_json=?, recommendation=?, summary_md=?, intent_json=?,
       model=?, provider=?, tokens_in=?, tokens_out=?, cost_usd=?, duration_ms=?, completed_at=datetime('now') WHERE id=?`,
    )
    .run(
      input.risk.score,
      JSON.stringify(input.risk),
      input.recommendation,
      input.summaryMd,
      JSON.stringify(input.intent),
      input.model,
      input.provider,
      input.tokensIn,
      input.tokensOut,
      input.costUsd,
      input.durationMs,
      input.reviewId,
    );
}

export function failReview(reviewId: string, friendlyError: string): void {
  db()
    .prepare("UPDATE reviews SET status='FAILED', error=?, completed_at=datetime('now') WHERE id=?")
    .run(friendlyError, reviewId);
}

export function markPublished(reviewId: string): void {
  // Publication is the terminal step — the review content was already
  // completed in completeReview; flip PUBLISHING back to COMPLETED.
  db()
    .prepare("UPDATE reviews SET published_at=datetime('now'), status='COMPLETED' WHERE id=?")
    .run(reviewId);
}

// ---------------------------------------------------------------- findings ---

export function insertFinding(
  reviewId: string,
  f: FindingInput,
  extras: Partial<{
    fingerprint: string;
    criticVerdict: CriticVerdict;
    criticNotes: string;
    regression: "NEW" | "PERSISTENT" | "FIXED";
    mergedFrom: string[];
    previousFindingId: string;
    status: FindingStatus;
  }> = {},
): string {
  const fid = id("fnd");
  const fingerprint =
    extras.fingerprint ??
    [f.agent, f.category, f.file, f.lineStart, f.title]
      .map((s) => String(s).toLowerCase().trim())
      .join("|");
  db()
    .prepare(
      `INSERT INTO findings (id, review_id, fingerprint, severity, category, title, description, file, line_start, line_end,
        confidence, impact, recommendation, suggested_patch_json, detector, agent, critic_verdict, critic_notes,
        status, regression, merged_from_json, previous_finding_id)
       VALUES (@id,@reviewId,@fingerprint,@severity,@category,@title,@description,@file,@lineStart,@lineEnd,
        @confidence,@impact,@recommendation,@suggestedPatch,@detector,@agent,@criticVerdict,@criticNotes,
        @status,@regression,@mergedFrom,@previousFindingId)`,
    )
    .run({
      id: fid,
      reviewId,
      fingerprint,
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      file: f.file,
      lineStart: f.lineStart,
      lineEnd: f.lineEnd,
      confidence: f.confidence,
      impact: f.impact ?? null,
      recommendation: f.recommendation,
      suggestedPatch: f.suggestedPatch ? JSON.stringify(f.suggestedPatch) : null,
      detector: f.detector,
      agent: f.agent,
      criticVerdict: extras.criticVerdict ?? null,
      criticNotes: extras.criticNotes ?? null,
      status: extras.status ?? "OPEN",
      regression: extras.regression ?? null,
      mergedFrom: extras.mergedFrom ? JSON.stringify(extras.mergedFrom) : null,
      previousFindingId: extras.previousFindingId ?? null,
    });
  insertEvidence(fid, f.evidence);
  return fid;
}

export function insertEvidence(findingId: string, evidence: EvidenceItem[]): void {
  const stmt = db().prepare(
    "INSERT INTO evidence_items (id, finding_id, kind, label, detail, file, line, position) VALUES (?,?,?,?,?,?,?,?)",
  );
  evidence.forEach((e, i) => {
    stmt.run(id("evd"), findingId, e.kind, e.label, e.detail, e.file ?? null, e.line ?? null, i);
  });
}

export function getEvidence(findingId: string): EvidenceItem[] {
  const rows = db()
    .prepare("SELECT * FROM evidence_items WHERE finding_id=? ORDER BY position")
    .all(findingId) as {
    kind: EvidenceItem["kind"];
    label: string;
    detail: string;
    file: string | null;
    line: number | null;
  }[];
  return rows.map((r) => ({ kind: r.kind, label: r.label, detail: r.detail, file: r.file ?? undefined, line: r.line ?? undefined }));
}

export function rowToFinding(r: FindingRow): import("../../types").Finding {
  return {
    id: r.id,
    reviewId: r.review_id,
    fingerprint: r.fingerprint,
    severity: r.severity as import("../../types").Severity,
    category: r.category,
    title: r.title,
    description: r.description,
    file: r.file ?? "",
    lineStart: r.line_start ?? 0,
    lineEnd: r.line_end ?? 0,
    confidence: r.confidence,
    evidence: [],
    impact: r.impact ?? undefined,
    recommendation: r.recommendation,
    suggestedPatch: r.suggested_patch_json ? JSON.parse(r.suggested_patch_json) : undefined,
    detector: r.detector as import("../../types").Detector,
    agent: r.agent,
    criticVerdict: r.critic_verdict ?? undefined,
    criticNotes: r.critic_notes ?? undefined,
    status: r.status,
    regression: (r.regression as import("../../types").Finding["regression"]) ?? undefined,
    mergedFrom: r.merged_from_json ? (JSON.parse(r.merged_from_json) as string[]) : undefined,
    previousFindingId: r.previous_finding_id ?? undefined,
    createdAt: r.created_at,
  };
}

export function listFindingsForReview(reviewId: string): import("../../types").Finding[] {
  const rows = db().prepare("SELECT * FROM findings WHERE review_id=? ORDER BY rowid").all(reviewId) as FindingRow[];
  return rows.map((r) => ({ ...rowToFinding(r), evidence: getEvidence(r.id) }));
}

export function getFinding(findingId: string): (import("../../types").Finding & { evidence: EvidenceItem[] }) | undefined {
  const r = db().prepare("SELECT * FROM findings WHERE id=?").get(findingId) as FindingRow | undefined;
  if (!r) return undefined;
  return { ...rowToFinding(r), evidence: getEvidence(findingId) };
}

export interface FindingFilter {
  severity?: string;
  category?: string;
  repositoryId?: string;
  author?: string;
  status?: FindingStatus;
  confidenceMin?: number;
  q?: string;
  limit?: number;
  offset?: number;
  userId: string;
}

export function queryFindings(filter: FindingFilter): {
  findings: (import("../../types").Finding & {
    evidence: EvidenceItem[];
    repo_full_name: string;
    pr_number: number;
    pr_title: string;
  })[];
  total: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];
  // Multi-tenancy: always constrain to repositories the user may access.
  where.push(
    "rep.id IN (SELECT rep2.id FROM repositories rep2 JOIN org_members m ON m.org_id = rep2.org_id WHERE m.user_id = ?)",
  );
  params.push(filter.userId);
  if (filter.severity) {
    where.push("f.severity = ?");
    params.push(filter.severity);
  }
  if (filter.category) {
    where.push("f.category = ?");
    params.push(filter.category);
  }
  if (filter.repositoryId) {
    where.push("rep.id = ?");
    params.push(filter.repositoryId);
  }
  if (filter.author) {
    where.push("p.author = ?");
    params.push(filter.author);
  }
  if (filter.status) {
    where.push("f.status = ?");
    params.push(filter.status);
  }
  if (typeof filter.confidenceMin === "number") {
    where.push("f.confidence >= ?");
    params.push(filter.confidenceMin);
  }
  if (filter.q) {
    where.push("(f.title LIKE ? OR f.description LIKE ? OR f.file LIKE ?)");
    const like = `%${filter.q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.join(" AND ");
  const total = (
    db()
      .prepare(
        `SELECT COUNT(*) c FROM findings f
         JOIN reviews rv ON rv.id = f.review_id
         JOIN pull_requests p ON p.id = rv.pr_id
         JOIN repositories rep ON rep.id = p.repository_id
         WHERE ${whereSql}`,
      )
      .get(...params) as { c: number }
  ).c;
  const rows = db()
    .prepare(
      `SELECT f.*, rep.full_name AS repo_full_name, p.number AS pr_number, p.title AS pr_title
       FROM findings f
       JOIN reviews rv ON rv.id = f.review_id
       JOIN pull_requests p ON p.id = rv.pr_id
       JOIN repositories rep ON rep.id = p.repository_id
       WHERE ${whereSql}
       ORDER BY f.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, filter.limit ?? 100, filter.offset ?? 0) as (FindingRow & {
    repo_full_name: string;
    pr_number: number;
    pr_title: string;
  })[];
  return {
    total,
    findings: rows.map((r) => ({ ...rowToFinding(r), evidence: getEvidence(r.id), repo_full_name: r.repo_full_name, pr_number: r.pr_number, pr_title: r.pr_title })),
  };
}

export function dismissFinding(
  findingId: string,
  input: { action: "false_positive" | "intentional" | "not_applicable" | "accepted_risk" | "reopen"; note?: string; userId: string },
): void {
  if (input.action === "reopen") {
    db()
      .prepare("UPDATE findings SET status='OPEN', dismissed_reason=NULL, dismissed_note=NULL, dismissed_by=NULL, dismissed_at=NULL WHERE id=?")
      .run(findingId);
  } else {
    const status: FindingStatus = input.action === "accepted_risk" ? "ACCEPTED_RISK" : "DISMISSED";
    db()
      .prepare(
        "UPDATE findings SET status=?, dismissed_reason=?, dismissed_note=?, dismissed_by=?, dismissed_at=datetime('now') WHERE id=?",
      )
      .run(status, input.action, input.note ?? null, input.userId, findingId);
  }
  db().prepare("INSERT INTO feedback (id, finding_id, user_id, action, note) VALUES (?,?,?,?,?)").run(
    id("fdb"),
    findingId,
    input.userId,
    input.action,
    input.note ?? null,
  );
}

// ------------------------------------------------------- agent runs/events ---

export function startRun(reviewId: string, agentKey: string, displayName: string): string {
  const runId = id("run");
  db()
    .prepare(
      "INSERT INTO agent_runs (id, review_id, agent_key, display_name, status, started_at) VALUES (?,?,?,?,'RUNNING',datetime('now'))",
    )
    .run(runId, reviewId, agentKey, displayName);
  return runId;
}

export function completeRun(
  runId: string,
  input: {
    status: "COMPLETED" | "FAILED" | "SKIPPED";
    decisionSummary?: string;
    findingsCount: number;
    toolCalls: number;
    model?: string | null;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    error?: string | null;
  },
): void {
  db()
    .prepare(
      `UPDATE agent_runs SET status=?, decision_summary=?, findings_count=?, tool_calls=?, model=?, tokens_in=?, tokens_out=?,
       cost_usd=?, error=?, completed_at=datetime('now'),
       duration_ms=CAST((julianday(datetime('now')) - julianday(started_at)) * 86400000 AS INTEGER)
       WHERE id=?`,
    )
    .run(
      input.status,
      input.decisionSummary ?? null,
      input.findingsCount,
      input.toolCalls,
      input.model ?? null,
      input.tokensIn ?? 0,
      input.tokensOut ?? 0,
      input.costUsd ?? 0,
      input.error ?? null,
      runId,
    );
}

export function listRunsForReview(reviewId: string): AgentRunRow[] {
  return db().prepare("SELECT * FROM agent_runs WHERE review_id=? ORDER BY rowid").all(reviewId) as AgentRunRow[];
}

export function getRun(runId: string): AgentRunRow | undefined {
  return db().prepare("SELECT * FROM agent_runs WHERE id=?").get(runId) as AgentRunRow | undefined;
}

export function recordTool(runId: string, t: { tool: string; status: string; summary: string; durationMs: number }): void {
  db()
    .prepare("INSERT INTO tool_executions (id, run_id, tool, status, summary, duration_ms) VALUES (?,?,?,?,?,?)")
    .run(id("tlx"), runId, t.tool, t.status, t.summary, t.durationMs);
}

export function listToolsForRun(runId: string): unknown[] {
  return db().prepare("SELECT * FROM tool_executions WHERE run_id=? ORDER BY rowid").all(runId);
}

export function addEvent(
  reviewId: string,
  input: { stage: string; level?: "info" | "success" | "warn" | "error"; message: string; runId?: string; data?: unknown },
): void {
  db()
    .prepare("INSERT INTO agent_events (review_id, run_id, stage, level, message, data_json) VALUES (?,?,?,?,?,?)")
    .run(reviewId, input.runId ?? null, input.stage, input.level ?? "info", input.message, input.data ? JSON.stringify(input.data) : null);
  eventBus.publish(reviewId);
}

export function listEvents(reviewId: string, afterId = 0): AgentEventRow[] {
  return db()
    .prepare("SELECT * FROM agent_events WHERE review_id=? AND id > ? ORDER BY id")
    .all(reviewId, afterId) as AgentEventRow[];
}

// ---------------------------------------------------------------- artifacts ---

export function saveArtifact(reviewId: string, kind: string, filename: string, content: string): string {
  const aid = id("art");
  db().prepare("INSERT INTO artifacts (id, review_id, kind, filename, content) VALUES (?,?,?,?,?)").run(
    aid,
    reviewId,
    kind,
    filename,
    content,
  );
  return aid;
}

export function listArtifacts(reviewId: string): { id: string; kind: string; filename: string; created_at: string }[] {
  return db()
    .prepare("SELECT id, kind, filename, created_at FROM artifacts WHERE review_id=? ORDER BY rowid")
    .all(reviewId) as { id: string; kind: string; filename: string; created_at: string }[];
}

export function getArtifact(id: string): { content: string; filename: string; kind: string } | undefined {
  return db().prepare("SELECT content, filename, kind FROM artifacts WHERE id=?").get(id) as
    | { content: string; filename: string; kind: string }
    | undefined;
}

// ------------------------------------------------------------ tiny pub/sub ---
// Drives SSE without requiring Redis. In multi-process production this is
// replaced by Redis pub/sub behind the same interface.
class EventBus {
  private listeners = new Map<string, Set<() => void>>();
  subscribe(reviewId: string, fn: () => void): () => void {
    const set = this.listeners.get(reviewId) ?? new Set<() => void>();
    set.add(fn);
    this.listeners.set(reviewId, set);
    return () => set.delete(fn);
  }
  publish(reviewId: string): void {
    this.listeners.get(reviewId)?.forEach((fn) => fn());
  }
}
export const eventBus = new EventBus();
