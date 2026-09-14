/**
 * Next.js instrumentation hook: starts the in-process review worker once per
 * server process. In production with multiple replicas, run `npm run worker`
 * as a dedicated process instead (the queue is claim-locked so both modes are
 * safe to coexist).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/queue/worker");
    startWorker();
  }
}
