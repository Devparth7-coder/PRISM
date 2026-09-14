"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  GitPullRequest,
  Download,
  RotateCw,
  Wrench,
  ShieldAlert,
  FileText,
  Files,
  ListChecks,
  ExternalLink,
  Activity,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useReviewEvents } from "@/hooks/use-review-events";
import { useReviewContext } from "@/components/shell/ReviewContext";
import { DiffViewer } from "./DiffViewer";
import { FindingsChain } from "./EvidenceChain";
import { PipelineProgress } from "./PipelineProgress";
import { Card, Spinner, Progress } from "@/components/ui";
import { RecommendationBadge, StatusPill, DetectorBadge } from "@/components/badges";
import { cn, fmtDuration, relTime } from "@/lib/utils";
import type { Finding, RiskResult } from "@/lib/types";
import type { AgentEventRow, AgentRunRow, ReviewRow } from "@/lib/db/repo/reviews";
import type { ChangedFile } from "@/lib/types";

interface Detail {
  review: ReviewRow;
  pr: {
    id: string;
    number: number;
    title: string;
    html_url: string | null;
    base_sha: string;
    head_sha: string;
    author: string | null;
    created_at: string;
  };
  repo: { id: string; full_name: string; is_demo: number };
  files: ChangedFile[];
  findings: Finding[];
  runs: AgentRunRow[];
  events: AgentEventRow[];
  artifacts: { id: string; kind: string; filename: string; created_at: string }[];
  risk: RiskResult | null;
  previousReview?: { id: string; risk_score: number | null; findings: Finding[] } | null;
}

const TABS = [
  { key: "findings", label: "Findings & evidence", icon: ListChecks },
  { key: "files", label: "Changed files", icon: Files },
  { key: "summary", label: "Summary & artifacts", icon: FileText },
  { key: "timeline", label: "Pipeline", icon: Activity },
] as const;

export function ReviewWorkspace({ detail, isDemo }: { detail: Detail; isDemo: boolean }) {
  const { setContext } = useReviewContext();
  useEffect(() => {
    setContext({ reviewId: detail.review.id, repoId: detail.repo.id });
    return () => setContext({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.review.id]);
  const { status, events, connected } = useReviewEvents(detail.review.id, {
    status: detail.review.status,
    events: detail.events,
  });
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("findings");
  const [selectedFinding, setSelectedFinding] = useState<string | undefined>(detail.findings[0]?.id);
  const [busy, setBusy] = useState<string | null>(null);

  const terminal = status === "COMPLETED" || status === "FAILED";
  const selected = detail.findings.find((f) => f.id === selectedFinding);

  const findingsByFile = useMemo(() => {
    const map = new Map<string, { lineStart: number; lineEnd: number; id: string; severity: string }[]>();
    for (const f of detail.findings) {
      if (f.status !== "OPEN") continue;
      const arr = map.get(f.file) ?? [];
      arr.push({ lineStart: f.lineStart, lineEnd: f.lineEnd, id: f.id, severity: f.severity });
      map.set(f.file, arr);
    }
    return map;
  }, [detail.findings]);

  async function post(url: string, key: string) {
    setBusy(key);
    const res = await fetch(url, { method: "POST" });
    if (res.ok) {
      setTimeout(() => window.location.reload(), 500);
    } else {
      setBusy(null);
    }
  }

  // FIXED findings are recorded in place on the PREVIOUS review's rows;
  // NEW/PERSISTENT live on the current review.
  const fixedPrev = detail.previousReview?.findings.filter(
    (f) => f.regression === "FIXED" || f.status === "FIXED",
  ).length ?? 0;
  const counts = {
    open: detail.findings.filter((f) => f.status === "OPEN").length,
    fixed: fixedPrev,
    persisted: detail.findings.filter((f) => f.regression === "PERSISTENT").length,
    fresh: detail.findings.filter((f) => f.regression === "NEW").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-graphite-400">
            <Link href={`/repositories/${detail.repo.id}`} className="font-mono hover:text-graphite-200">
              {detail.repo.full_name}
            </Link>
            <span>/</span>
            <Link href={`/pull-requests/${detail.pr.id}`} className="flex items-center gap-1 hover:text-graphite-200">
              <GitPullRequest className="h-3.5 w-3.5" /> #{detail.pr.number}
            </Link>
            {isDemo && <span className="rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">demo</span>}
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-graphite-50">{detail.pr.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-graphite-500">
            <span className="font-mono">{detail.pr.base_sha.slice(0, 7)} → {detail.pr.head_sha.slice(0, 7)}</span>
            <span>{detail.files.length} files · +{detail.files.reduce((s, f) => s + f.additions, 0)}/-{detail.files.reduce((s, f) => s + f.deletions, 0)}</span>
            <span>{relTime(detail.review.created_at)}</span>
            {detail.review.duration_ms != null && <span>ran in {fmtDuration(detail.review.duration_ms)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {detail.review.recommendation && <RecommendationBadge rec={detail.review.recommendation} />}
          {detail.review.error && (
            <button onClick={() => post(`/api/reviews/${detail.review.id}/retry`, "retry")} disabled={busy !== null} className="btn-secondary text-xs">
              <RotateCw className={cn("h-3.5 w-3.5", busy === "retry" && "animate-spin")} /> Retry job
            </button>
          )}
          {isDemo && (
            <button onClick={() => post("/api/demo/fix", "fix")} disabled={busy !== null} className="btn-primary text-xs">
              {busy === "fix" ? <Spinner className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
              Simulate author fix commit
            </button>
          )}
          {detail.pr.html_url && (
            <a href={detail.pr.html_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> On GitHub
            </a>
          )}
        </div>
      </div>

      {!terminal && (
        <Card className="p-4">
          <PipelineProgress status={status} events={events} connected={connected} runs={detail.runs} />
        </Card>
      )}

      {status === "FAILED" && (
        <Card className="border-red-900/60 bg-red-950/20 p-4">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 text-prism-red" />
            <div>
              <div className="text-sm font-semibold text-red-200">Review failed</div>
              <p className="mt-1 font-mono text-[11px] text-red-300/80">{detail.review.error ?? "Unknown worker error — the job is on the dead-letter queue and can be retried."}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Risk + regression strip */}
      {terminal && detail.risk && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <RiskCard risk={detail.risk} recommendation={detail.review.recommendation} />
          <RegressionCard previous={detail.previousReview} counts={counts} currentScore={detail.review.risk_score} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-graphite-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs",
              tab === t.key ? "border-prism-red text-graphite-50" : "border-transparent text-graphite-400 hover:text-graphite-200",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.key === "findings" && counts.open > 0 && <span className="rounded-full bg-graphite-800 px-1.5 text-[10px]">{counts.open}</span>}
          </button>
        ))}
      </div>

      {tab === "findings" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
          <div className="space-y-2 xl:max-h-[70vh] xl:overflow-y-auto xl:pr-1">
            {detail.findings.length === 0 ? (
              <Card className="p-6 text-center text-xs text-graphite-500">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-prism-green" />
                No findings survived evidence verification for this change.
              </Card>
            ) : (
              <FindingsChain
                findings={[...detail.findings].sort((a, b) => sevRank(b.severity) - sevRank(a.severity))}
                selectedId={selectedFinding}
                onSelect={(id) => {
                  setSelectedFinding(id);
                  setTimeout(() => {
                    document.getElementById(`finding-line-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }, 50);
                }}
                detectorLabel
              />
            )}
          </div>
          <div className="min-w-0">
            <DiffViewer files={detail.files} findingsByFile={findingsByFile} selectedFindingId={selectedFinding} onSelectFinding={setSelectedFinding} />
            {selected && (
              <div className="mt-2 flex items-center justify-between rounded-md border border-graphite-700 bg-graphite-900 px-3 py-2 text-[11px]">
                <span className="truncate text-graphite-300">
                  <DetectorBadge detector={selected.detector} /> <span className="ml-2">{selected.title}</span>
                </span>
                <button onClick={() => document.getElementById(`finding-${selected.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="ml-3 shrink-0 text-graphite-400 hover:text-graphite-200">
                  Evidence chain ↑
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "files" && <DiffViewer files={detail.files} findingsByFile={findingsByFile} selectedFindingId={selectedFinding} onSelectFinding={(id) => { setSelectedFinding(id); setTab("findings"); }} />}

      {tab === "summary" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold">Synthesized review summary</h3>
            {detail.review.summary_md ? (
              <MarkdownLite text={detail.review.summary_md} />
            ) : (
              <p className="text-xs text-graphite-500">Summary is produced during SYNTHESIS.</p>
            )}
          </Card>
          <ArtifactsPanel artifacts={detail.artifacts} />
        </div>
      )}

      {tab === "timeline" && (
        <Card className="p-4">
          <PipelineProgress status={status} events={events} connected={connected} runs={detail.runs} />
        </Card>
      )}
    </div>
  );
}

function sevRank(s: string) {
  return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }[s as "CRITICAL"] ?? 0;
}

function RiskCard({ risk, recommendation }: { risk: RiskResult; recommendation: string | null }) {
  const entries: [keyof RiskResult["breakdown"], string][] = [
    ["security", "Security"],
    ["correctness", "Correctness"],
    ["performance", "Performance"],
    ["maintainability", "Maintainability"],
    ["testing", "Testing"],
    ["dependencies", "Dependencies"],
    ["scope", "Change scope"],
  ];
  const tone = risk.score >= 60 ? "text-prism-red" : risk.score >= 30 ? "text-prism-amber" : "text-prism-green";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-graphite-400" />
        <h3 className="text-sm font-semibold">Risk assessment</h3>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <span className={cn("text-4xl font-bold tabular-nums leading-none", tone)}>{risk.score}</span>
        <div className="pb-0.5">
          <div className={cn("text-xs font-semibold uppercase tracking-wider", tone)}>{risk.level} risk</div>
          {recommendation && <div className="text-[11px] text-graphite-400">{recommendation.replace(/_/g, " ").toLowerCase()}</div>}
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {entries.map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 shrink-0 text-graphite-400">{label}</span>
            <Progress value={Math.min(100, risk.breakdown[key] * 1.25)} className="h-1.5 flex-1" />
            <span className="w-6 text-right tabular-nums text-graphite-300">{risk.breakdown[key]}</span>
          </div>
        ))}
      </div>
      {risk.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-graphite-800 pt-3">
          {risk.reasons.slice(0, 6).map((r, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-graphite-400">
              <span className="text-prism-red">•</span> {r}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RegressionCard({
  previous,
  counts,
  currentScore,
}: {
  previous?: { id: string; risk_score: number | null; findings: Finding[] } | null;
  counts: { open: number; fixed: number; persisted: number; fresh: number };
  currentScore: number | null;
}) {
  if (!previous) {
    return (
      <Card className="flex items-center justify-center p-4 text-xs text-graphite-500">
        First review of this PR — regression comparison appears after the author pushes another commit.
      </Card>
    );
  }
  const delta = currentScore != null && previous.risk_score != null ? currentScore - previous.risk_score : null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">Re-review regression tracking</h3>
      <p className="mt-1 text-[11px] text-graphite-500">
        Compared against the previous completed review (risk {previous.risk_score ?? "—"}) using finding fingerprints.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <RegStat icon={<CheckCircle2 className="h-4 w-4 text-prism-green" />} value={counts.fixed} label="Fixed" />
        <RegStat icon={<XCircle className="h-4 w-4 text-prism-amber" />} value={counts.persisted} label="Persistent" />
        <RegStat icon={<ShieldAlert className="h-4 w-4 text-prism-red" />} value={counts.fresh} label="New" />
      </div>
      {delta != null && (
        <div className="mt-3 text-xs text-graphite-400">
          Risk score moved{" "}
          <span className={cn("font-semibold", delta < 0 ? "text-prism-green" : delta > 0 ? "text-prism-red" : "text-graphite-300")}>
            {delta > 0 ? "+" : ""}
            {delta}
          </span>{" "}
          points since the last review.
        </div>
      )}
    </Card>
  );
}

function RegStat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-md border border-graphite-700 bg-graphite-950/60 p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xl font-bold tabular-nums text-graphite-100">
        {icon}
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-graphite-500">{label}</div>
    </div>
  );
}

function ArtifactsPanel({ artifacts }: { artifacts: Detail["artifacts"] }) {
  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Download className="h-4 w-4 text-graphite-400" /> Artifacts
      </h3>
      {artifacts.length === 0 ? (
        <p className="text-xs text-graphite-500">Artifacts (Markdown summary, JSON report, generated tests) appear at SYNTHESIS.</p>
      ) : (
        <ul className="space-y-2">
          {artifacts.map((a) => (
            <li key={a.id}>
              <a
                href={`/api/artifacts/${a.id}`}
                className="flex items-center justify-between rounded-md border border-graphite-700 px-3 py-2 text-xs hover:border-graphite-500"
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-graphite-400" />
                  <span className="font-mono text-graphite-200">{a.filename}</span>
                </span>
                <span className="rounded bg-graphite-800 px-1.5 py-0.5 text-[10px] uppercase text-graphite-400">{a.kind}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Minimal markdown renderer (no dangerous HTML) for synthesized summaries. */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-graphite-300">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h4 key={i} className="pt-2 text-sm font-semibold text-graphite-100">{line.slice(4)}</h4>;
        if (line.startsWith("## ")) return <h3 key={i} className="pt-2 text-sm font-semibold text-graphite-100">{line.slice(3)}</h3>;
        if (line.startsWith("# ")) return <h3 key={i} className="text-sm font-semibold text-graphite-100">{line.slice(2)}</h3>;
        const bullet = line.match(/^\s*[-*]\s+(.*)/);
        if (bullet) return <div key={i} className="flex gap-2 pl-2"><span className="text-prism-red">•</span><span>{inline(bullet[1]!)}</span></div>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode {
  // Backtick code only — safe, no raw HTML injection.
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("`") && p.endsWith("`") ? (
      <code key={i} className="rounded bg-graphite-800 px-1 py-0.5 font-mono text-[10.5px] text-graphite-200">{p.slice(1, -1)}</code>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
