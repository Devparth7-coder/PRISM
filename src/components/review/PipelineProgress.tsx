"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, Loader2, Circle, AlertTriangle, Cpu, Radio } from "lucide-react";
import type { AgentEventRow, AgentRunRow } from "@/lib/db/repo/reviews";
import { cn, fmtDuration } from "@/lib/utils";

export const STAGES = [
  "INGESTING",
  "CONTEXT",
  "STATIC_ANALYSIS",
  "AGENTS",
  "CRITIC",
  "VERIFICATION",
  "RISK",
  "SYNTHESIS",
  "PUBLISHING",
] as const;

export function stageIndex(status: string): number {
  if (status === "QUEUED") return -1;
  if (status === "COMPLETED") return STAGES.length;
  if (status === "FAILED") return STAGES.indexOf("PUBLISHING");
  const i = STAGES.indexOf(status as (typeof STAGES)[number]);
  return i < 0 ? -1 : i;
}

export function PipelineProgress({
  status,
  events,
  connected,
  runs,
}: {
  status: string;
  events: AgentEventRow[];
  connected: boolean;
  runs: AgentRunRow[];
}) {
  const current = stageIndex(status);
  const failed = status === "FAILED";
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [events.length]);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <ol className="space-y-0.5">
        {STAGES.map((stage, i) => {
          const done = i < current || status === "COMPLETED";
          const active = i === current && !failed;
          const isFailedStage = failed && i === current;
          return (
            <li key={stage} className="flex items-center gap-2.5 py-1.5">
              {done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-prism-green" />
              ) : isFailedStage ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-prism-red" />
              ) : active ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-prism-amber" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-graphite-600" />
              )}
              <span
                className={cn(
                  "text-xs",
                  done ? "text-graphite-200" : active ? "font-medium text-graphite-50" : isFailedStage ? "text-prism-red" : "text-graphite-500",
                )}
              >
                {stage.replace(/_/g, " ")}
              </span>
            </li>
          );
        })}
        <li className="mt-2 flex items-center gap-2 border-t border-graphite-800 pt-2 text-[10px] text-graphite-500">
          <Radio className={cn("h-3 w-3", connected ? "text-prism-green" : "text-graphite-600")} />
          {connected ? "live stream connected" : status === "COMPLETED" ? "stream closed" : "reconnecting…"}
        </li>
      </ol>

      <div className="overflow-hidden rounded-lg border border-graphite-700">
        <div className="flex items-center justify-between border-b border-graphite-800 bg-graphite-900 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-graphite-400">Pipeline events</span>
          <span className="text-[10px] text-graphite-500">{events.length} persisted events</span>
        </div>
        <div ref={consoleRef} className="max-h-64 overflow-y-auto bg-graphite-950 p-2 font-mono text-[10.5px] leading-relaxed">
          {events.length === 0 && <div className="p-2 text-graphite-600">Waiting for worker…</div>}
          {events.map((e) => (
            <div key={e.id} className="flex gap-2 py-px">
              <span className="shrink-0 text-graphite-600">{new Date(e.created_at).toLocaleTimeString()}</span>
              <span
                className={cn(
                  "shrink-0 uppercase",
                  e.level === "error" ? "text-prism-red" : e.level === "warn" ? "text-prism-amber" : "text-graphite-500",
                )}
              >
                {e.stage.replace(/_/g, " ")}
              </span>
              <span className="text-graphite-300">{e.message}</span>
            </div>
          ))}
        </div>
        {runs.length > 0 && (
          <div className="border-t border-graphite-800">
            <div className="grid grid-cols-[1.2fr_70px_90px_70px_80px] gap-2 border-b border-graphite-800 bg-graphite-900 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-graphite-500">
              <span>Agent / tool</span>
              <span>Status</span>
              <span>Tokens</span>
              <span>Cost</span>
              <span>Time</span>
            </div>
            {runs.map((r) => (
              <div key={r.id} className="grid grid-cols-[1.2fr_70px_90px_70px_80px] gap-2 border-b border-graphite-800/60 px-3 py-1.5 text-[10.5px] last:border-0">
                <span className="flex items-center gap-1.5 truncate text-graphite-200" title={r.decision_summary ?? r.error ?? ""}>
                  <Cpu className="h-3 w-3 shrink-0 text-graphite-500" />
                  {r.display_name}
                  {r.findings_count > 0 && <span className="text-red-400">({r.findings_count})</span>}
                </span>
                <span className={cn("uppercase", r.status === "COMPLETED" ? "text-green-400" : r.status === "FAILED" ? "text-red-400" : r.status === "SKIPPED" ? "text-graphite-600" : "text-amber-400")}>
                  {r.status.toLowerCase()}
                </span>
                <span className="tabular-nums text-graphite-400">{r.tokens_in + r.tokens_out || "—"}</span>
                <span className="tabular-nums text-graphite-400">{r.cost_usd ? `$${r.cost_usd.toFixed(4)}` : "—"}</span>
                <span className="tabular-nums text-graphite-400">{r.duration_ms ? fmtDuration(r.duration_ms) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
