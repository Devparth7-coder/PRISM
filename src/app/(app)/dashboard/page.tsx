import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { dashboardData } from "@/lib/services/read-models";
import {
  dashboardMetrics,
  findingsByCategory,
  findingsBySeverity,
} from "@/lib/db/repo/analytics";
import { Card, EmptyState, Stat } from "@/components/ui";
import { SeverityDonut, CategoryBars, ToneText } from "@/components/charts";
import { RecommendationBadge, StatusPill } from "@/components/badges";
import { fmtDuration, relTime } from "@/lib/utils";
import { FolderGit2, GitPullRequest, AlertTriangle, FlaskConical } from "lucide-react";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const user = requireUser();
  const metrics = dashboardMetrics(user.id);
  const { repos, recentReviews, recentPrs } = dashboardData(user.id);
  const severity = findingsBySeverity(user.id);
  const categories = findingsByCategory(user.id);
  const hasData = metrics.reviewedPrs > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Dashboard</h1>
          <p className="text-xs text-graphite-400">
            Every metric below is computed from stored reviews. No data yet? Run the flagship demo.
          </p>
        </div>
        <Link href="/pull-requests" className="btn-secondary text-xs">
          <GitPullRequest className="h-3.5 w-3.5" /> Pull requests
        </Link>
      </div>

      {!hasData ? (
        <EmptyState
          icon={<FlaskConical className="h-8 w-8" />}
          title="No reviews yet"
          body="Bootstrap the deterministic demo repository (PR #184 — organization member management with seeded security, correctness, performance and test-gap issues) and watch the full pipeline run on real code."
          action={
            <Link href="/login" className="btn-primary text-xs">
              Open demo login
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Repositories" value={metrics.repositories} hint="connected + demo" />
            <Stat label="PRs reviewed" value={metrics.reviewedPrs} />
            <Stat label="Open findings" value={metrics.openFindings} tone={metrics.openFindings ? "warn" : "ok"} />
            <Stat label="High / critical open" value={metrics.criticalFindings} tone={metrics.criticalFindings ? "danger" : "ok"} />
            <Stat
              label="Avg review time"
              value={metrics.avgReviewMs != null ? fmtDuration(metrics.avgReviewMs) : "—"}
              hint="wall clock, completed runs"
            />
            <Stat
              label="False-positive rate"
              value={metrics.falsePositiveRate != null ? `${(metrics.falsePositiveRate * 100).toFixed(0)}%` : "—"}
              hint="from dismissals / adjudications"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent reviews</h3>
                <Link href="/pull-requests" className="text-[11px] text-graphite-400 hover:text-graphite-200">
                  View all
                </Link>
              </div>
              <div className="divide-y divide-graphite-800">
                {recentReviews.map((r) => (
                  <Link key={r.id} href={`/reviews/${r.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 hover:bg-graphite-900/40">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-graphite-100">
                        <span className="font-mono text-graphite-400">{r.repo_full_name} #{r.pr_number}</span> — {r.pr_title}
                      </div>
                      <div className="mt-0.5 text-[10px] text-graphite-500">{relTime(r.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <ToneText value={r.risk_score} className="text-sm font-semibold" />
                      <RecommendationBadge rec={r.recommendation} />
                      <StatusPill status={r.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <h3 className="mb-3 text-sm font-semibold">Open findings by severity</h3>
                <div className="flex items-center gap-4">
                  <SeverityDonut data={severity.map((s) => ({ severity: s.severity, c: s.c }))} />
                  <ul className="space-y-1.5 text-xs">
                    {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((sev) => {
                      const c = severity.find((s) => s.severity === sev)?.c ?? 0;
                      return (
                        <li key={sev} className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: { CRITICAL: "#b91c1c", HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#3b82f6", INFO: "#5a6170" }[sev] }} />
                          <span className="w-16 text-graphite-300">{sev}</span>
                          <span className="tabular-nums text-graphite-100">{c}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-semibold">Findings by category</h3>
                <CategoryBars data={categories} />
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FolderGit2 className="h-4 w-4 text-graphite-400" /> Repositories
              </h3>
              <div className="space-y-2">
                {repos.map((r) => (
                  <Link key={r.id} href={`/repositories/${r.id}`} className="flex items-center justify-between rounded-md border border-graphite-700/60 px-3 py-2 text-xs hover:border-graphite-500">
                    <span className="font-mono text-graphite-100">{r.full_name}</span>
                    {r.is_demo ? <span className="rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">demo</span> : null}
                  </Link>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-graphite-400" /> Recent pull requests
              </h3>
              <div className="space-y-2">
                {recentPrs.map((p) => (
                  <Link key={p.id} href={`/pull-requests/${p.id}`} className="flex items-center justify-between rounded-md border border-graphite-700/60 px-3 py-2 text-xs hover:border-graphite-500">
                    <span className="truncate font-mono text-graphite-200">
                      {p.repo_full_name}#{p.number}
                    </span>
                    <span className="ml-3 truncate text-graphite-400">{p.title}</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
