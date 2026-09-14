import { cn } from "@/lib/utils";
import type {
  CriticVerdict,
  Detector,
  FindingStatus,
  Recommendation,
  ReviewStatus,
  Severity,
} from "@/lib/types";

const sevStyle: Record<Severity, string> = {
  CRITICAL: "border-red-800/70 bg-red-950/60 text-red-300",
  HIGH: "border-red-900/60 bg-red-950/40 text-red-400",
  MEDIUM: "border-amber-900/50 bg-amber-950/40 text-amber-300",
  LOW: "border-blue-900/50 bg-blue-950/40 text-blue-300",
  INFO: "border-graphite-600 bg-graphite-800 text-graphite-200",
};

const dot: Record<Severity, string> = {
  CRITICAL: "bg-red-400",
  HIGH: "bg-prism-red",
  MEDIUM: "bg-prism-amber",
  LOW: "bg-prism-blue",
  INFO: "bg-graphite-400",
};

export function SeverityBadge({ severity, className }: { severity: Severity | string; className?: string }) {
  const s = severity as Severity;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold", sevStyle[s], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[s])} />
      {s}
    </span>
  );
}

export function RecommendationBadge({ rec }: { rec: Recommendation | string | null }) {
  if (!rec) return <span className="text-xs text-graphite-400">—</span>;
  const map: Record<string, string> = {
    APPROVE: "border-prism-green/40 bg-green-950/40 text-green-300",
    APPROVE_WITH_WARNINGS: "border-amber-800/50 bg-amber-950/40 text-amber-300",
    REQUEST_CHANGES: "border-orange-800/60 bg-orange-950/50 text-orange-300",
    BLOCK: "border-red-800/70 bg-red-950/70 text-red-200",
  };
  const emoji: Record<string, string> = {
    APPROVE: "✅",
    APPROVE_WITH_WARNINGS: "🟡",
    REQUEST_CHANGES: "⚠️",
    BLOCK: "⛔️",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold", map[rec])}>
      <span>{emoji[rec]}</span>
      {rec.replace(/_/g, " ")}
    </span>
  );
}

const statusMap: Record<string, string> = {
  QUEUED: "text-graphite-300 border-graphite-600",
  INGESTING: "text-blue-300 border-blue-900",
  CONTEXT: "text-blue-300 border-blue-900",
  STATIC_ANALYSIS: "text-blue-300 border-blue-900",
  AGENTS: "text-violet-300 border-violet-900",
  CRITIC: "text-amber-300 border-amber-900",
  VERIFICATION: "text-amber-300 border-amber-900",
  RISK: "text-amber-300 border-amber-900",
  SYNTHESIS: "text-amber-300 border-amber-900",
  PUBLISHING: "text-blue-300 border-blue-900",
  COMPLETED: "text-green-300 border-green-900",
  FAILED: "text-red-300 border-red-900",
  STALE: "text-graphite-400 border-graphite-700",
};

export function StatusPill({ status, className }: { status: ReviewStatus | string; className?: string }) {
  const running = !["COMPLETED", "FAILED", "STALE"].includes(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", statusMap[status] ?? statusMap.QUEUED, className)}>
      {running ? <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-current" /> : null}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function DetectorBadge({ detector }: { detector: Detector | string }) {
  const map: Record<string, string> = {
    DETERMINISTIC: "border-graphite-600 bg-graphite-800 text-graphite-100",
    "AI-DETECTED": "border-violet-900/60 bg-violet-950/40 text-violet-300",
    HYBRID: "border-indigo-900/60 bg-indigo-950/40 text-indigo-300",
  };
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", map[detector] ?? map.DETERMINISTIC)}>
      {detector === "AI-DETECTED" ? "AI" : detector === "HYBRID" ? "DET + AI" : "DET"}
    </span>
  );
}

const criticMap: Record<CriticVerdict, string> = {
  CONFIRMED: "border-green-900/60 bg-green-950/40 text-green-300",
  WEAK: "border-amber-900/60 bg-amber-950/40 text-amber-300",
  FALSE_POSITIVE: "border-graphite-600 bg-graphite-800 text-graphite-400 line-through",
  UNCERTAIN: "border-blue-900/60 bg-blue-950/40 text-blue-300",
};

export function CriticBadge({ verdict }: { verdict?: CriticVerdict | null }) {
  if (!verdict) return <span className="text-[11px] text-graphite-500">not challenged</span>;
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", criticMap[verdict])}>
      Critic: {verdict.replace("_", " ").toLowerCase()}
    </span>
  );
}

const findingStatusMap: Record<FindingStatus, string> = {
  OPEN: "border-red-900/50 bg-red-950/30 text-red-300",
  FIXED: "border-green-900/60 bg-green-950/40 text-green-300",
  DISMISSED: "border-graphite-600 bg-graphite-800 text-graphite-400",
  ACCEPTED_RISK: "border-amber-900/60 bg-amber-950/40 text-amber-300",
  STALE: "border-graphite-700 bg-graphite-850 text-graphite-400",
};

export function FindingStatusBadge({ status }: { status: FindingStatus | string }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", findingStatusMap[status as FindingStatus] ?? findingStatusMap.OPEN)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
