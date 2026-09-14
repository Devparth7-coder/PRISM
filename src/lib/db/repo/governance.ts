import { db, id } from "../client";

// ---------------------------------------------------------------- policies ---

export interface SeverityMap {
  CRITICAL: "BLOCK" | "REQUEST_CHANGES" | "COMMENT" | "INFORMATIONAL";
  HIGH: "BLOCK" | "REQUEST_CHANGES" | "COMMENT" | "INFORMATIONAL";
  MEDIUM: "BLOCK" | "REQUEST_CHANGES" | "COMMENT" | "INFORMATIONAL";
  LOW: "BLOCK" | "REQUEST_CHANGES" | "COMMENT" | "INFORMATIONAL";
  INFO: "BLOCK" | "REQUEST_CHANGES" | "COMMENT" | "INFORMATIONAL";
}

// Defaults do NOT auto-block: per product policy, blocking requires explicit
// repository configuration. CRITICAL/HIGH both request changes by default.
export const DEFAULT_SEVERITY_MAP: SeverityMap = {
  CRITICAL: "REQUEST_CHANGES",
  HIGH: "REQUEST_CHANGES",
  MEDIUM: "COMMENT",
  LOW: "INFORMATIONAL",
  INFO: "INFORMATIONAL",
};

export interface PolicyRow {
  id: string;
  repository_id: string | null;
  name: string;
  mode: string;
  min_severity_comment: string;
  severity_map_json: string;
  require_tests: number;
  security_blocking: number;
  dependency_blocking: number;
  max_complexity: number | null;
  path_reviewers_json: string;
  updated_at: string;
}

export function defaultPolicyRow(): PolicyRow {
  return {
    id: "default",
    repository_id: null,
    name: "Global default",
    mode: "standard",
    min_severity_comment: "LOW",
    severity_map_json: JSON.stringify(DEFAULT_SEVERITY_MAP),
    require_tests: 1,
    security_blocking: 1,
    dependency_blocking: 0,
    max_complexity: null,
    path_reviewers_json: "[]",
    updated_at: new Date().toISOString(),
  };
}

export function ensureGlobalPolicy(): PolicyRow {
  const existing = db()
    .prepare("SELECT * FROM review_policies WHERE repository_id IS NULL")
    .get() as PolicyRow | undefined;
  if (existing) return existing;
  const pid = id("pol");
  db()
    .prepare(
      `INSERT INTO review_policies (id, repository_id, name, severity_map_json)
       VALUES (?, NULL, 'Global default', ?)`,
    )
    .run(pid, JSON.stringify(DEFAULT_SEVERITY_MAP));
  return db().prepare("SELECT * FROM review_policies WHERE id=?").get(pid) as PolicyRow;
}

export function getPolicyForRepo(repoId: string | null): PolicyRow {
  if (repoId) {
    const repoPolicy = db()
      .prepare("SELECT * FROM review_policies WHERE repository_id=?")
      .get(repoId) as PolicyRow | undefined;
    if (repoPolicy) return repoPolicy;
  }
  const global = db().prepare("SELECT * FROM review_policies WHERE repository_id IS NULL").get() as
    | PolicyRow
    | undefined;
  return global ?? defaultPolicyRow();
}

export function listPolicies(): PolicyRow[] {
  return db().prepare("SELECT * FROM review_policies ORDER BY repository_id NULLS FIRST").all() as PolicyRow[];
}

export function upsertRepoPolicy(
  repoId: string | null,
  input: Partial<{
    name: string;
    mode: string;
    minSeverityComment: string;
    severityMap: SeverityMap;
    requireTests: boolean;
    securityBlocking: boolean;
    dependencyBlocking: boolean;
    maxComplexity: number | null;
    pathReviewers: { glob: string; agents: string[] }[];
  }>,
): void {
  const existing = repoId
    ? (db().prepare("SELECT * FROM review_policies WHERE repository_id=?").get(repoId) as PolicyRow | undefined)
    : (db().prepare("SELECT * FROM review_policies WHERE repository_id IS NULL").get() as PolicyRow | undefined);
  const current = existing ?? defaultPolicyRow();
  const merged = {
    name: input.name ?? current.name,
    mode: input.mode ?? current.mode,
    minSeverity: input.minSeverityComment ?? current.min_severity_comment,
    severityMap: input.severityMap ?? JSON.parse(current.severity_map_json),
    requireTests: input.requireTests ?? Boolean(current.require_tests),
    securityBlocking: input.securityBlocking ?? Boolean(current.security_blocking),
    dependencyBlocking: input.dependencyBlocking ?? Boolean(current.dependency_blocking),
    maxComplexity: input.maxComplexity === undefined ? current.max_complexity : input.maxComplexity,
    pathReviewers: input.pathReviewers ?? JSON.parse(current.path_reviewers_json),
  };
  if (existing) {
    db()
      .prepare(
        `UPDATE review_policies SET name=?, mode=?, min_severity_comment=?, severity_map_json=?, require_tests=?,
         security_blocking=?, dependency_blocking=?, max_complexity=?, path_reviewers_json=?, updated_at=datetime('now')
         WHERE id=?`,
      )
      .run(
        merged.name,
        merged.mode,
        merged.minSeverity,
        JSON.stringify(merged.severityMap),
        merged.requireTests ? 1 : 0,
        merged.securityBlocking ? 1 : 0,
        merged.dependencyBlocking ? 1 : 0,
        merged.maxComplexity,
        JSON.stringify(merged.pathReviewers),
        existing.id,
      );
  } else {
    db()
      .prepare(
        `INSERT INTO review_policies (id, repository_id, name, mode, min_severity_comment, severity_map_json,
         require_tests, security_blocking, dependency_blocking, max_complexity, path_reviewers_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id("pol"),
        repoId,
        merged.name,
        merged.mode,
        merged.minSeverity,
        JSON.stringify(merged.severityMap),
        merged.requireTests ? 1 : 0,
        merged.securityBlocking ? 1 : 0,
        merged.dependencyBlocking ? 1 : 0,
        merged.maxComplexity,
        JSON.stringify(merged.pathReviewers),
      );
  }
}

// ----------------------------------------------------------- rules & memory ---

export interface RuleRow {
  id: string;
  repository_id: string;
  kind: "block" | "require" | "allow" | "custom";
  path_glob: string | null;
  pattern: string;
  description: string;
  rationale: string | null;
  enabled: number;
  created_at: string;
}

export function listRules(repoId: string): RuleRow[] {
  return db().prepare("SELECT * FROM repository_rules WHERE repository_id=? ORDER BY rowid DESC").all(repoId) as RuleRow[];
}

export function addRule(input: {
  repositoryId: string;
  kind: RuleRow["kind"];
  pattern: string;
  description: string;
  rationale?: string;
  pathGlob?: string;
}): RuleRow {
  const rid = id("rul");
  db()
    .prepare(
      "INSERT INTO repository_rules (id, repository_id, kind, path_glob, pattern, description, rationale) VALUES (?,?,?,?,?,?,?)",
    )
    .run(rid, input.repositoryId, input.kind, input.pathGlob ?? null, input.pattern, input.description, input.rationale ?? null);
  return db().prepare("SELECT * FROM repository_rules WHERE id=?").get(rid) as RuleRow;
}

export function setRuleEnabled(ruleId: string, enabled: boolean): void {
  db().prepare("UPDATE repository_rules SET enabled=? WHERE id=?").run(enabled ? 1 : 0, ruleId);
}

export interface MemoryRow {
  id: string;
  repository_id: string;
  kind: "accepted_pattern" | "rejected_pattern" | "architecture_decision" | "feedback" | "exception";
  content: string;
  source_finding_id: string | null;
  created_at: string;
}

export function listMemory(repoId: string): MemoryRow[] {
  return db().prepare("SELECT * FROM repository_memory WHERE repository_id=? ORDER BY rowid DESC").all(repoId) as MemoryRow[];
}

export function addMemory(input: {
  repositoryId: string;
  kind: MemoryRow["kind"];
  content: string;
  sourceFindingId?: string;
}): MemoryRow {
  const mid = id("mem");
  db()
    .prepare("INSERT INTO repository_memory (id, repository_id, kind, content, source_finding_id) VALUES (?,?,?,?,?)")
    .run(mid, input.repositoryId, input.kind, input.content, input.sourceFindingId ?? null);
  return db().prepare("SELECT * FROM repository_memory WHERE id=?").get(mid) as MemoryRow;
}

// --------------------------------------------------------------- webhooks ---

export function recordWebhook(input: {
  deliveryId?: string;
  event: string;
  action?: string;
  signatureValid: boolean;
  installationId?: number;
  repositoryFull?: string;
  payload: unknown;
  status: string;
  error?: string;
}): string {
  const wid = id("whk");
  db()
    .prepare(
      `INSERT INTO webhook_events (id, delivery_id, event, action, signature_valid, installation_id, repository_full,
       payload_json, status, error) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      wid,
      input.deliveryId ?? null,
      input.event,
      input.action ?? null,
      input.signatureValid ? 1 : 0,
      input.installationId ?? null,
      input.repositoryFull ?? null,
      JSON.stringify(input.payload),
      input.status,
      input.error ?? null,
    );
  return wid;
}

export function listWebhooks(limit = 50): unknown[] {
  return db()
    .prepare("SELECT id, delivery_id, event, action, signature_valid, status, repository_full, error, created_at FROM webhook_events ORDER BY rowid DESC LIMIT ?")
    .all(limit);
}

// ------------------------------------------------------------- publications ---

export function savePublication(input: {
  reviewId: string;
  mode: "live" | "demo_simulation";
  payload: unknown;
  status: "pending" | "published" | "failed" | "simulated";
  githubId?: string;
  error?: string;
}): void {
  db()
    .prepare(
      "INSERT INTO github_publications (id, review_id, mode, github_id, payload_json, status, error) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      id("pub"),
      input.reviewId,
      input.mode,
      input.githubId ?? null,
      JSON.stringify(input.payload, null, 2),
      input.status,
      input.error ?? null,
    );
}

export function listPublicationsForReview(reviewId: string): unknown[] {
  return db()
    .prepare("SELECT * FROM github_publications WHERE review_id=? ORDER BY rowid")
    .all(reviewId);
}
