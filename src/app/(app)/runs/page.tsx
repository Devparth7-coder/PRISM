import { requireUser } from "@/lib/auth";
import { listRecentJobs, listDeadJobs, type JobRow } from "@/lib/db/repo/jobs";
import { Card } from "@/components/ui";
import { RetryJobButton } from "@/components/jobs/RetryJobButton";
import { relTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Inbox, AlertOctagon, Workflow } from "lucide-react";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  requireUser();
  const jobs = listRecentJobs(60);
  const dead = listDeadJobs();
  const queued = jobs.filter((j) => j.status === "queued").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const failed = jobs.filter((j) => j.status === "failed" || j.status === "dead").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Jobs & queue</h1>
        <p className="text-xs text-graphite-400">
          Every webhook and manual trigger is persisted as an idempotent job with retries, exponential backoff and a
          dead-letter queue.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-graphite-400">
            <Inbox className="h-3.5 w-3.5" /> Queued
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-graphite-50">{queued}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-graphite-400">
            <Workflow className="h-3.5 w-3.5" /> Running
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-prism-amber">{running}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-graphite-400">
            <AlertOctagon className="h-3.5 w-3.5" /> Dead / failed
          </div>
          <div className={cn("mt-1 text-2xl font-semibold tabular-nums", failed ? "text-prism-red" : "text-prism-green")}>{failed}</div>
        </Card>
      </div>

      {dead.length > 0 && (
        <Card className="border-red-900/50 p-0">
          <div className="border-b border-red-900/40 bg-red-950/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-red-300">
            Dead-letter queue ({dead.length})
          </div>
          <div className="divide-y divide-graphite-800">
            {dead.map((j) => (
              <div key={j.id} className="grid grid-cols-[1fr_auto] items-start gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-graphite-200">{j.type}</span>
                    <span className="text-[10px] text-graphite-500">{j.attempts}/{j.max_attempts} attempts · {relTime(j.updated_at)}</span>
                  </div>
                  {j.last_error && <p className="mt-1 break-words font-mono text-[10.5px] text-red-300/80">{j.last_error}</p>}
                </div>
                <RetryJobButton jobId={j.id} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="border-b border-graphite-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-graphite-400">
          Recent jobs
        </div>
        <div className="divide-y divide-graphite-800">
          {jobs.length === 0 && <div className="px-4 py-8 text-center text-xs text-graphite-500">No jobs yet — trigger a review or wait for a webhook.</div>}
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function JobRow({ job: j }: { job: JobRow }) {
  const tone =
    j.status === "completed"
      ? "text-prism-green"
      : j.status === "running"
        ? "text-prism-amber"
        : j.status === "failed" || j.status === "dead"
          ? "text-prism-red"
          : "text-graphite-400";
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(j.payload_json) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return (
    <div className="grid grid-cols-[120px_1fr_120px_160px] items-center gap-3 px-4 py-2.5 text-xs">
      <span className={cn("font-semibold uppercase", tone)}>{j.status}</span>
      <div className="min-w-0">
        <div className="font-mono text-graphite-200">{j.type}</div>
        <div className="truncate text-[10px] text-graphite-500">
          {j.dedupe_key ?? "—"} · {JSON.stringify(payload).slice(0, 120)}
        </div>
        {j.last_error && j.status !== "dead" && <div className="mt-0.5 truncate font-mono text-[10px] text-red-300/70">{j.last_error}</div>}
      </div>
      <span className="text-graphite-500">{j.attempts}/{j.max_attempts}</span>
      <span className="text-right text-[10px] text-graphite-500">{relTime(j.updated_at)}</span>
    </div>
  );
}
