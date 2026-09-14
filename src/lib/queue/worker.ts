/**
 * Durable job worker. The same implementation runs in-process (started by
 * Next.js instrumentation in dev/single-node deployments) or as a standalone
 * process (`npm run worker`, recommended for production with multiple web
 * replicas). The jobs table + claim() locking makes the two modes safe; swap
 * claimJob/completeJob for BullMQ when REDIS_URL is set (adapter point).
 */
import { claimJob, completeJob, failJob, recoverStaleJobs, type JobRow } from "../db/repo/jobs";
import { runReview, type ReviewJobPayload } from "../orchestrator";
import { ensureAgentCatalog } from "../orchestrator";
import { ensureGlobalPolicy } from "../db/repo/governance";
import { log } from "../logger";
import { db } from "../db/client";

const WORKER_ID = `worker_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
let running = false;
let timer: NodeJS.Timeout | null = null;

const HANDLERS: Record<string, (job: JobRow) => Promise<void>> = {
  "review-pr": async (job) => {
    const payload = JSON.parse(job.payload_json) as ReviewJobPayload;
    await runReview(payload);
  },
  "ingest-github-pr": async (job) => {
    const payload = JSON.parse(job.payload_json) as {
      installationId: number;
      owner: string;
      repo: string;
      number: number;
      mode?: string;
    };
    const { ingestLivePullRequest } = await import("../services/github-live");
    await ingestLivePullRequest({
      installationId: payload.installationId,
      owner: payload.owner,
      repo: payload.repo,
      number: payload.number,
      mode: payload.mode,
    });
  },
  "discover-installation": async (job) => {
    const payload = JSON.parse(job.payload_json) as {
      installationId: number;
      action?: string;
      payload: unknown;
    };
    const { discoverInstallation } = await import("../services/github-live");
    await discoverInstallation({
      installationId: payload.installationId,
      action: payload.action,
      payload: payload.payload as never,
    });
  },
};

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Claim up to 2 jobs per tick (bounded concurrency).
    for (let i = 0; i < 2; i++) {
      let job: JobRow | null = null;
      try {
        job = claimJob(WORKER_ID);
      } catch (err) {
        log.error("job claim failed", { error: err instanceof Error ? err.message : String(err) });
        break;
      }
      if (!job) break;
      const handler = HANDLERS[job.type];
      if (!handler) {
        failJob(job, `No handler for job type ${job.type}`);
        continue;
      }
      try {
        log.info("job started", { jobId: job.id, type: job.type, attempt: job.attempts });
        await handler(job);
        completeJob(job.id);
        log.info("job completed", { jobId: job.id, type: job.type });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failJob(job, message);
        if (job.attempts >= job.max_attempts) {
          log.error("job exhausted retries (dead-letter)", { jobId: job.id, type: job.type, error: message });
        }
      }
    }
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  if (timer) return;
  // Touch DB so migrations run before recovery.
  db();
  ensureAgentCatalog();
  ensureGlobalPolicy();
  const recovered = recoverStaleJobs();
  if (recovered) log.warn("re-queued stale jobs from a crashed worker", { recovered });
  timer = setInterval(() => {
    void tick();
  }, 500);
  // Don't keep the event loop alive solely for polling in test contexts.
  timer.unref?.();
  log.info("review worker started", { workerId: WORKER_ID });
  void tick();
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
