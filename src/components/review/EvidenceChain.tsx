"use client";

import { useState } from "react";
import {
  Crosshair,
  GitCompare,
  Workflow,
  FolderTree,
  Gauge,
  Bot,
  ShieldCheck,
  ShieldQuestion,
  Wrench,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
import type { Finding, EvidenceItem } from "@/lib/types";
import { SeverityBadge, DetectorBadge, CriticBadge, FindingStatusBadge } from "@/components/badges";
import { cn, titleCase } from "@/lib/utils";

const KIND_META: Record<EvidenceItem["kind"], { stage: string; icon: typeof GitCompare }> = {
  changed_line: { stage: "Changed code", icon: GitCompare },
  related_code: { stage: "Related code", icon: Workflow },
  caller: { stage: "Caller", icon: Workflow },
  callee: { stage: "Callee", icon: Workflow },
  graph: { stage: "Code graph", icon: Workflow },
  test: { stage: "Test evidence", icon: FolderTree },
  config: { stage: "Repo context", icon: FolderTree },
  convention: { stage: "Repo context", icon: FolderTree },
  dependency: { stage: "Deterministic evidence", icon: Gauge },
  static_tool: { stage: "Deterministic evidence", icon: Gauge },
};

const DISMISS_REASONS = [
  { action: "false_positive", label: "False positive" },
  { action: "intentional", label: "Intentional" },
  { action: "not_applicable", label: "Not applicable" },
  { action: "accepted_risk", label: "Accept risk" },
] as const;

export function FindingsChain({
  findings,
  selectedId,
  onSelect,
  detectorLabel,
}: {
  findings: Finding[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  detectorLabel?: boolean;
}) {
  const [openId, setOpenId] = useState<string | undefined>(selectedId ?? findings[0]?.id);
  const active = selectedId ?? openId;

  return (
    <div className="space-y-2">
      {findings.map((f) => (
        <FindingCard
          key={f.id}
          finding={f}
          open={active === f.id}
          onToggle={() => {
            setOpenId(f.id);
            onSelect?.(f.id);
          }}
          showDetectorLabel={detectorLabel}
        />
      ))}
    </div>
  );
}

function FindingCard({
  finding: f,
  open,
  onToggle,
  showDetectorLabel,
}: {
  finding: Finding;
  open: boolean;
  onToggle: () => void;
  showDetectorLabel?: boolean;
}) {
  const dismissed = f.status !== "OPEN";
  return (
    <div
      id={`finding-${f.id}`}
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        open ? "border-graphite-500 bg-graphite-900" : "border-graphite-700 bg-graphite-900/60 hover:border-graphite-600",
        dismissed && "opacity-60",
        f.regression === "FIXED" && "border-green-900/60",
      )}
    >
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-graphite-400 transition-transform", !open && "-rotate-90")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            {f.regression && <RegressionTag reg={f.regression} />}
            {showDetectorLabel && <DetectorBadge detector={f.detector} />}
            <FindingStatusBadge status={f.status} />
            <span className="font-mono text-[10px] text-graphite-500">
              {f.file}:{f.lineStart}
            </span>
          </div>
          <div className="mt-1.5 text-sm font-medium text-graphite-100">{f.title}</div>
        </div>
      </button>

      {open && <FindingChainBody finding={f} />}
    </div>
  );
}

function RegressionTag({ reg }: { reg: NonNullable<Finding["regression"]> }) {
  const cls =
    reg === "FIXED"
      ? "border-green-800 bg-green-950/50 text-green-300"
      : reg === "PERSISTENT"
        ? "border-amber-800 bg-amber-950/50 text-amber-300"
        : "border-red-800 bg-red-950/50 text-red-300";
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>{reg}</span>;
}

/**
 * The signature evidence chain:
 * Finding → changed code → related code → repo context → deterministic
 * evidence → AI analysis → critic verification → recommendation.
 */
function FindingChainBody({ finding: f }: { finding: Finding }) {
  const groups = new Map<string, EvidenceItem[]>();
  for (const e of f.evidence) {
    const meta = KIND_META[e.kind];
    const arr = groups.get(meta.stage) ?? [];
    arr.push(e);
    groups.set(meta.stage, arr);
  }
  const stageOrder = ["Changed code", "Related code", "Repo context", "Test evidence", "Deterministic evidence"];
  const orderedStages = stageOrder.filter((s) => groups.has(s));

  const deterministic = f.detector !== "AI-DETECTED";
  const aiStage = f.detector === "DETERMINISTIC" ? null : f.agent;

  return (
    <div className="border-t border-graphite-800 px-4 py-4">
      <ol className="relative space-y-4 before:absolute before:left-[13px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-graphite-700">
        <ChainStep icon={Crosshair} tone="red" title="Finding" subtitle={`${f.category.replace(/_/g, " ").toLowerCase()} · confidence ${Math.round(f.confidence * 100)}%`}>
          <p className="text-xs leading-relaxed text-graphite-300">{f.description}</p>
          {f.impact && (
            <p className="mt-2 text-xs leading-relaxed text-graphite-300">
              <span className="font-semibold text-graphite-200">Impact: </span>
              {f.impact}
            </p>
          )}
        </ChainStep>

        {orderedStages.map((stage) => {
          const Icon = KIND_META[groups.get(stage)![0]!.kind]!.icon;
          const isDeterministic = stage === "Deterministic evidence";
          return (
            <ChainStep key={stage} icon={Icon} tone={isDeterministic ? "amber" : "graphite"} title={stage}>
              <ul className="space-y-1.5">
                {groups.get(stage)!.map((e, i) => (
                  <li key={i} className="rounded-md border border-graphite-700/70 bg-graphite-950/60 p-2">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-graphite-200">
                      {e.file && <span className="font-mono text-graphite-400">{e.file}{e.line ? `:${e.line}` : ""}</span>}
                      {!e.file && <span>{e.label}</span>}
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-graphite-400">
                      {e.file ? `${e.label ? e.label + "\n" : ""}${e.detail}` : e.detail}
                    </pre>
                  </li>
                ))}
              </ul>
            </ChainStep>
          );
        })}

        {!deterministic && aiStage && (
          <ChainStep icon={Bot} tone="blue" title="AI analysis" subtitle={titleCase(f.agent.replace(/_/g, " "))}>
            <p className="text-xs leading-relaxed text-graphite-300">
              Structured finding produced by the {f.agent.replace(/_/g, " ")} agent against repository-grounded context,
              then schema-validated. {f.detector === "HYBRID" ? "Confirmed by at least one deterministic signal — labeled HYBRID." : "Labeled AI-DETECTED; treat as analyst input, not fact."}
            </p>
          </ChainStep>
        )}
        {deterministic && (
          <ChainStep icon={Gauge} tone="blue" title="Analysis" subtitle="Deterministic-first">
            <p className="text-xs text-graphite-300">
              This finding was produced by the deterministic rules/secret/dependency engine without relying on an LLM,
              so it carries direct tool evidence.
            </p>
          </ChainStep>
        )}

        <ChainStep
          icon={f.criticVerdict === "CONFIRMED" ? ShieldCheck : f.criticVerdict === "FALSE_POSITIVE" ? XCircle : ShieldQuestion}
          tone={f.criticVerdict === "CONFIRMED" ? "green" : f.criticVerdict === "FALSE_POSITIVE" ? "red" : "graphite"}
          title="Critic verification"
          subtitle={f.criticVerdict ? undefined : "Not required at this severity"}
        >
          {f.criticVerdict ? (
            <div>
              <CriticBadge verdict={f.criticVerdict} />
              {f.criticNotes && <p className="mt-1.5 text-xs italic leading-relaxed text-graphite-400">“{f.criticNotes}”</p>}
            </div>
          ) : (
            <p className="text-xs text-graphite-500">Adversarial critic only adjudicates HIGH/CRITICAL findings.</p>
          )}
        </ChainStep>

        <ChainStep icon={Wrench} tone="green" title="Recommendation">
          <p className="text-xs leading-relaxed text-graphite-300">{f.recommendation}</p>
          {f.suggestedPatch && (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <PatchBlock label="Current" tone="del" code={f.suggestedPatch.current} />
              <PatchBlock label="Proposed" tone="add" code={f.suggestedPatch.proposed} />
              {f.suggestedPatch.explanation && (
                <p className="text-[11px] text-graphite-500 md:col-span-2">{f.suggestedPatch.explanation}</p>
              )}
            </div>
          )}
          {f.status === "OPEN" && <DismissControls findingId={f.id} />}
        </ChainStep>
      </ol>
    </div>
  );
}

function ChainStep({
  icon: Icon,
  tone,
  title,
  subtitle,
  children,
}: {
  icon: typeof Crosshair;
  tone: "red" | "green" | "amber" | "blue" | "graphite";
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const toneCls = {
    red: "border-prism-red/60 bg-red-950/60 text-prism-red",
    green: "border-green-700/70 bg-green-950/50 text-green-400",
    amber: "border-amber-700/70 bg-amber-950/50 text-amber-400",
    blue: "border-blue-800 bg-blue-950/50 text-blue-300",
    graphite: "border-graphite-600 bg-graphite-800 text-graphite-300",
  }[tone];
  return (
    <li className="relative pl-10">
      <span className={cn("absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border", toneCls)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-graphite-200">{title}</span>
        {subtitle && <span className="text-[10px] text-graphite-500">{subtitle}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </li>
  );
}

function PatchBlock({ label, tone, code }: { label: string; tone: "add" | "del"; code: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-graphite-700">
      <div className="border-b border-graphite-800 bg-graphite-900 px-2 py-1 text-[10px] uppercase tracking-wider text-graphite-400">{label}</div>
      <pre className={cn("overflow-x-auto p-2 font-mono text-[10.5px] leading-relaxed", tone === "add" ? "bg-green-950/30 text-green-200" : "bg-red-950/30 text-red-200")}>
        {code}
      </pre>
    </div>
  );
}

function DismissControls({ findingId }: { findingId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function act(action: string) {
    setBusy(action);
    try {
      const res = await fetch(`/api/findings/${findingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setDone(true);
        setTimeout(() => window.location.reload(), 600);
      }
    } finally {
      setBusy(null);
    }
  }

  if (done) return <div className="mt-2 flex items-center gap-1.5 text-[11px] text-prism-green"><CheckCircle2 className="h-3.5 w-3.5" /> Recorded — feedback feeds repository memory</div>;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-graphite-500">
        <Ban className="h-3 w-3" /> Triage:
      </span>
      {DISMISS_REASONS.map((r) => (
        <button key={r.action} disabled={busy !== null} onClick={() => act(r.action)} className="rounded border border-graphite-700 px-2 py-1 text-[10px] text-graphite-300 hover:border-graphite-500 hover:text-graphite-100 disabled:opacity-50">
          {busy === r.action ? "…" : r.label}
        </button>
      ))}
    </div>
  );
}
