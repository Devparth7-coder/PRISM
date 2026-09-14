import { db, id } from "../client";
import { log } from "../../logger";

export type JobType =
  | "review-pr"
  | "ingest-github-pr"
  | "discover-installation"
  | "build-context"
  | "run-static-analysis"
  | "run-agent"
  | "critic-review"
  | "publish-review"
  | "generate-artifact";

export interface JobRow {
  id: string;
  type: JobType;
  dedupe_key: string | null;
  payload_json: string;
  status: "queued" | "running" | "completed" | "failed" | "dead";
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Enqueue with idempotency: an unfinished job with the same dedupe key
 * (e.g. review:<prId>:<headSha>) is returned instead of duplicated.
 */
export function enqueueJob(
  type: JobType,
  payload: unknown,
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
): { job: JobRow; deduped: boolean } {
  if (opts.dedupeKey) {
    const existing = db().prepare("SELECT * FROM jobs WHERE dedupe_key=?").get(opts.dedupeKey) as JobRow | undefined;
    if (existing) {
      if (existing.status === "queued" || existing.status === "running" || existing.status === "completed") {
        // Idempotent replay: an active or already-finished job for this exact
        // key (e.g. same PR + commit SHA) must never be duplicated.
        return { job: existing, deduped: true };
      }
      // A prior attempt failed/stalled: re-open the same row instead of
      // colliding with the UNIQUE dedupe key.
      db()
        .prepare(
          `UPDATE jobs SET status='queued', payload_json=?, attempts=0, max_attempts=?, run_at=?,
           locked_by=NULL, locked_at=NULL, last_error=NULL, completed_at=NULL, updated_at=datetime('now')
           WHERE id=?`,
        )
        .run(JSON.stringify(payload), opts.maxAttempts ?? 3, (opts.runAt ?? new Date()).toISOString(), existing.id);
      return { job: db().prepare("SELECT * FROM jobs WHERE id=?").get(existing.id) as JobRow, deduped: false };
    }
  }
  const jid = id("job");
  db()
    .prepare(
      `INSERT INTO jobs (id, type, dedupe_key, payload_json, status, run_at, max_attempts)
       VALUES (?,?,?,?, 'queued', ?, ?)`,
    )
    .run(jid, type, opts.dedupeKey ?? null, JSON.stringify(payload), (opts.runAt ?? new Date()).toISOString(), opts.maxAttempts ?? 3);
  return { job: db().prepare("SELECT * FROM jobs WHERE id=?").get(jid) as JobRow, deduped: false };
}

/** Atomically claim the next due job for this worker. */
export function claimJob(workerId: string): JobRow | null {
  const dbi = db();
  const row = dbi
    .prepare(
      `SELECT * FROM jobs WHERE status='queued' AND datetime(run_at) <= datetime('now')
       ORDER BY rowid LIMIT 1`,
    )
    .get() as JobRow | undefined;
  if (!row) return null;
  const res = dbi
    .prepare(
      `UPDATE jobs SET status='running', locked_by=?, locked_at=datetime('now'), attempts=attempts+1, updated_at=datetime('now')
       WHERE id=? AND status='queued'`,
    )
    .run(workerId, row.id);
  if (res.changes === 0) return null;
  return dbi.prepare("SELECT * FROM jobs WHERE id=?").get(row.id) as JobRow;
}

export function completeJob(jobId: string): void {
  db()
    .prepare("UPDATE jobs SET status='completed', completed_at=datetime('now'), locked_by=NULL, updated_at=datetime('now') WHERE id=?")
    .run(jobId);
}

/** Retry with exponential backoff; exceeding max attempts routes to the dead-letter set. */
export function failJob(job: JobRow, error: string): void {
  const attempts = job.attempts;
  if (attempts >= job.max_attempts) {
    db()
      .prepare("UPDATE jobs SET status='dead', last_error=?, locked_by=NULL, updated_at=datetime('now') WHERE id=?")
      .run(error.slice(0, 4000), job.id);
    log.error("job moved to dead-letter", { jobId: job.id, type: job.type, attempts });
    return;
  }
  const backoffMs = Math.min(60_000, 500 * 2 ** (attempts - 1)) + Math.floor(Math.random() * 250);
  const runAt = new Date(Date.now() + backoffMs).toISOString();
  db()
    .prepare(
      "UPDATE jobs SET status='queued', last_error=?, locked_by=NULL, run_at=?, updated_at=datetime('now') WHERE id=?",
    )
    .run(error.slice(0, 4000), runAt, job.id);
  log.warn("job scheduled for retry", { jobId: job.id, attempts, runAt });
}

/** On worker boot: re-queue jobs left 'running' by a crashed worker. */
export function recoverStaleJobs(staleMinutes = 10): number {
  const res = db()
    .prepare(
      `UPDATE jobs SET status='queued', locked_by=NULL, locked_at=NULL
       WHERE status='running' AND locked_at < datetime('now', ?)`,
    )
    .run(`-${staleMinutes} minutes`);
  return res.changes;
}

export function listRecentJobs(limit = 50): JobRow[] {
  return db().prepare("SELECT * FROM jobs ORDER BY rowid DESC LIMIT ?").all(limit) as JobRow[];
}

export function listDeadJobs(): JobRow[] {
  return db().prepare("SELECT * FROM jobs WHERE status='dead' ORDER BY rowid DESC").all() as JobRow[];
}

export function retryDeadJob(jobId: string): void {
  db()
    .prepare("UPDATE jobs SET status='queued', attempts=0, last_error=NULL, run_at=datetime('now') WHERE id=? AND status='dead'")
    .run(jobId);
}
