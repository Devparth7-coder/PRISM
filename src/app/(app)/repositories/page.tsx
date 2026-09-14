import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listRepositoriesForUser } from "@/lib/db/repo/repositories";
import { db } from "@/lib/db/client";
import { Card, EmptyState } from "@/components/ui";
import { FolderGit2, GitPullRequest, AlertTriangle, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default function RepositoriesPage() {
  const user = requireUser();
  const repos = listRepositoriesForUser(user.id);

  const stats = new Map<
    string,
    { reviews: number; open: number; lastReview: string | null }
  >();
  for (const r of repos) {
    const row = db()
      .prepare(
        `SELECT COUNT(rv.id) reviews,
          SUM(CASE WHEN f.status='OPEN' AND rv.is_stale=0 THEN 1 ELSE 0 END) open,
          MAX(rv.created_at) last_review
         FROM pull_requests p
         LEFT JOIN reviews rv ON rv.pr_id=p.id
         LEFT JOIN findings f ON f.review_id=rv.id
         WHERE p.repository_id=?`,
      )
      .get(r.id) as { reviews: number; open: number | null; last_review: string | null };
    stats.set(r.id, { reviews: row.reviews, open: row.open ?? 0, lastReview: row.last_review });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Repositories</h1>
          <p className="text-xs text-graphite-400">Installed GitHub repositories and the demo repository.</p>
        </div>
        <Link href="/install" className="btn-secondary text-xs">
          <Plus className="h-3.5 w-3.5" /> Connect a repository
        </Link>
      </div>

      {repos.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-8 w-8" />}
          title="No repositories connected"
          body="Install the PRISM GitHub App to connect real repositories, or launch the demo from the login page."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {repos.map((r) => {
            const s = stats.get(r.id)!;
            return (
              <Link key={r.id} href={`/repositories/${r.id}`}>
                <Card className="p-4 transition-colors hover:border-graphite-500">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <FolderGit2 className="h-4 w-4 text-graphite-400" />
                      <span className="font-mono text-sm font-medium text-graphite-100">{r.full_name}</span>
                    </div>
                    {r.is_demo ? (
                      <span className="rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">demo</span>
                    ) : (
                      <span className="rounded border border-graphite-700 px-1.5 py-0.5 text-[10px] uppercase text-graphite-400">github</span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-5 text-xs text-graphite-400">
                    <span className="flex items-center gap-1.5">
                      <GitPullRequest className="h-3.5 w-3.5" /> {s.reviews} reviews
                    </span>
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> {s.open} open findings
                    </span>
                    {r.language && <span className="ml-auto text-graphite-500">{r.language}</span>}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
