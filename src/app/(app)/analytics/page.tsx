import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import {
  dashboardMetrics,
  findingsBySeverity,
  findingsByCategory,
  findingsTimeline,
  riskTrend,
  reviewerEffectiveness,
} from "@/lib/db/repo/analytics";
import { Card, EmptyState, Stat } from "@/components/ui";
import { SeverityDonut, CategoryBars, RiskTrendChart } from "@/components/charts";
import { titleCase } from "@/lib/utils";
import { BarChart3, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  const user = requireUser();
  const metrics = dashboardMetrics(user.id);
  const severity = findingsBySeverity(user.id);
  const categories = findingsByCategory(user.id);
  const timeline = findingsTimeline(user.id, 60);
  const trend = riskTrend(user.id, 30);
  const effectiveness = reviewerEffectiveness(user.id);

  const totals = db()
    .prepare(
      `SELECT COALESCE(SUM(rv.tokens_in + rv.tokens_out),0) tokens,
              COALESCE(SUM(rv.cost_usd),0) cost,
              COUNT(*) reviews
       FROM reviews rv
       JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       WHERE rv.status='COMPLETED'`,
    )
    .get(user.id) as { tokens: number; cost: number; reviews: number };

  if (metrics.reviewedPrs === 0) {
    return (
      <div className="mx-auto max-w-7xl">
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          title="No analytics without reviews"
          body="Analytics are computed only from stored, tenant-scoped review data. Run the demo or connect a GitHub repository first."
        />
      </div>
    );
  }

  const maxDay = Math.max(1, ...timeline.map((t) => t.c));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Analytics</h1>
        <p className="text-xs text-graphite-400">Computed from real stored reviews only — no telemetry, no estimates.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Reviews completed" value={totals.reviews} />
        <Stat label="AI tokens used" value={totals.tokens.toLocaleString()} hint="across all agents" />
        <Stat label="AI spend" value={`$${totals.cost.toFixed(4)}`} hint="deterministic-only reviews cost $0" />
        <Stat
          label="Avg review time"
          value={metrics.avgReviewMs != null ? `${(metrics.avgReviewMs / 1000).toFixed(1)}s` : "—"}
          hint="wall clock"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Risk score trend</h3>
          <RiskTrendChart data={trend} />
          <div className="mt-1 flex justify-between text-[10px] text-graphite-500">
            <span>oldest</span>
            <span>most recent {trend[0] ? `${trend[0].repo}#${trend[0].pr}` : ""}</span>
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Open findings by severity</h3>
          <div className="flex items-center gap-4">
            <SeverityDonut data={severity.map((s) => ({ severity: s.severity, c: s.c }))} />
            <ul className="space-y-1 text-xs">
              {severity.map((s) => (
                <li key={s.severity} className="flex gap-2">
                  <span className="w-20 text-graphite-400">{s.severity}</span>
                  <span className="tabular-nums text-graphite-100">{s.c}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Findings over the last 60 days</h3>
          {timeline.length === 0 ? (
            <p className="py-6 text-center text-xs text-graphite-500">No findings in window</p>
          ) : (
            <div className="flex h-32 items-end gap-px">
              {timeline.map((t) => (
                <div key={t.day} className="group relative flex-1" title={`${t.day}: ${t.c} findings (${t.critical} high+)`}>
                  <div className="flex h-full flex-col justify-end">
                    <div className="w-full rounded-t bg-prism-amber/70" style={{ height: `${(t.c / maxDay) * 100}%` }}>
                      <div className="h-full rounded-t bg-prism-red" style={{ height: `${t.c ? (t.critical / t.c) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-4 text-[10px] text-graphite-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-prism-amber" /> all findings</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-prism-red" /> high/critical</span>
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Findings by category</h3>
          <CategoryBars data={categories} />
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex items-center gap-2 border-b border-graphite-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-graphite-400">
          <ShieldAlert className="h-3.5 w-3.5" /> Detector / agent effectiveness
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th className="th">Agent / detector</th>
              <th className="th text-right">Raised</th>
              <th className="th text-right">Critic confirmed</th>
              <th className="th text-right">False positives</th>
              <th className="th text-right">Resolved</th>
              <th className="th">Adjudication</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite-800">
            {effectiveness.map((e) => {
              const adjudicated = e.confirmed + e.false_positives;
              const precision = adjudicated ? e.confirmed / adjudicated : null;
              return (
                <tr key={e.agent}>
                  <td className="td font-mono text-graphite-200">{titleCase(e.agent.replace(/_/g, " "))}</td>
                  <td className="td text-right tabular-nums">{e.total}</td>
                  <td className="td text-right tabular-nums text-green-300">{e.confirmed}</td>
                  <td className="td text-right tabular-nums text-red-300">{e.false_positives}</td>
                  <td className="td text-right tabular-nums">{e.resolved}</td>
                  <td className="td">
                    {precision == null ? (
                      <span className="text-graphite-600">n/a</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded bg-graphite-800">
                          <div className={`h-full ${precision >= 0.8 ? "bg-prism-green" : precision >= 0.5 ? "bg-prism-amber" : "bg-prism-red"}`} style={{ width: `${precision * 100}%` }} />
                        </div>
                        <span className="tabular-nums text-graphite-300">{(precision * 100).toFixed(0)}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
