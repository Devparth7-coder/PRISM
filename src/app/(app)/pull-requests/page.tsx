import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import type { PullRequestRow, RepositoryRow } from "@/lib/db/repo/repositories";
import type { ReviewRow } from "@/lib/db/repo/reviews";
import { Card, EmptyState } from "@/components/ui";
import { RecommendationBadge, StatusPill } from "@/components/badges";
import { ToneText } from "@/components/charts";
import { relTime } from "@/lib/utils";
import { GitPullRequest } from "lucide-react";

export const dynamic = "force-dynamic";

interface Row extends PullRequestRow {
  repo_full_name: string;
  review_id: string | null;
  review_status: ReviewRow["status"] | null;
  risk_score: number | null;
  recommendation: string | null;
}

export default function PullRequestsPage() {
  const user = requireUser();
  const ids = [...authorizedRepoIds(user.id)];
  if (ids.length === 0) {
    return <EmptyState icon={<GitPullRequest className="h-8 w-8" />} title="No pull requests" body="Connect a repository or launch the demo to see pull requests here." />;
  }
  const placeholders = ids.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT p.*, r.full_name AS repo_full_name, rv.id AS review_id, rv.status AS review_status,
              rv.risk_score, rv.recommendation
       FROM pull_requests p
       JOIN repositories r ON r.id=p.repository_id
       LEFT JOIN reviews rv ON rv.id=(
         SELECT id FROM reviews WHERE pr_id=p.id ORDER BY created_at DESC LIMIT 1
       )
       WHERE p.repository_id IN (${placeholders})
       ORDER BY p.updated_at DESC`,
    )
    .all(...ids) as Row[];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Pull requests</h1>
      {rows.length === 0 ? (
        <EmptyState icon={<GitPullRequest className="h-8 w-8" />} title="No pull requests" body="Pull requests appear here after webhook ingestion or demo bootstrap." />
      ) : (
        <Card className="divide-y divide-graphite-800 p-0">
          {rows.map((p) => (
            <Link key={p.id} href={`/pull-requests/${p.id}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 hover:bg-graphite-900/40">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-graphite-100">
                  <span className="font-mono text-graphite-400">{p.repo_full_name}#{p.number}</span> {p.title}
                </div>
                <div className="mt-0.5 text-[10px] text-graphite-500">
                  {p.author} · {p.changed_files} files · +{p.additions}/-{p.deletions} · {relTime(p.updated_at)}
                </div>
              </div>
              <ToneText value={p.risk_score} className="w-10 text-right text-sm font-semibold" />
              <div className="w-44 text-right">
                {p.review_status === "COMPLETED" && p.recommendation ? (
                  <RecommendationBadge rec={p.recommendation} />
                ) : p.review_status ? (
                  <StatusPill status={p.review_status} />
                ) : (
                  <StatusPill status="QUEUED" />
                )}
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
