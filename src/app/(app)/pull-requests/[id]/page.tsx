import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prDetail } from "@/lib/services/read-models";
import { Card } from "@/components/ui";
import { RecommendationBadge, StatusPill } from "@/components/badges";
import { ToneText } from "@/components/charts";
import { ReviewActions } from "@/components/review/ReviewActions";
import { fmtDuration, relTime } from "@/lib/utils";
import { GitPullRequest, GitCommit } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PullRequestPage({ params }: { params: { id: string } }) {
  const user = requireUser();
  let d;
  try {
    d = prDetail(params.id, user.id);
  } catch (err) {
    if ((err as { status?: number }).status === 404) notFound();
    throw err;
  }
  const { pr, repo, reviews, latestReviewId } = d;
  const isDemo = repo.is_demo === 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-graphite-400">
            <Link href={`/repositories/${repo.id}`} className="font-mono hover:text-graphite-200">{repo.full_name}</Link>
            {isDemo && <span className="rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">demo</span>}
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-graphite-50">
            <GitPullRequest className="h-4 w-4 text-graphite-400" /> #{pr.number} {pr.title}
          </h1>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-graphite-500">
            <span>opened by {pr.author} {relTime(pr.created_at)}</span>
            <span>{pr.changed_files} files · +{pr.additions}/-{pr.deletions}</span>
            <span className="flex items-center gap-1"><GitCommit className="h-3 w-3" />{pr.head_sha.slice(0, 9)}</span>
          </div>
        </div>
        <ReviewActions prId={pr.id} isDemo={isDemo} latestReviewId={latestReviewId} />
      </div>

      {pr.body && (
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-graphite-400">Description</h3>
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-graphite-300">{pr.body}</pre>
        </Card>
      )}

      <Card className="p-0">
        <div className="border-b border-graphite-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-graphite-400">
          Review history ({reviews.length})
        </div>
        {reviews.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-graphite-500">No review runs yet — trigger the first review above.</p>
        ) : (
          <div className="divide-y divide-graphite-800">
            {reviews.map((r) => (
              <Link key={r.id} href={`/reviews/${r.id}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-graphite-900/40">
                <div className="text-xs text-graphite-300">
                  <span className="font-mono text-graphite-500">{r.head_sha.slice(0, 9)}</span>
                  <span className="ml-2 text-[10px] text-graphite-500">{r.mode} mode · {relTime(r.created_at)}</span>
                </div>
                <span className="text-[11px] text-graphite-500">{r.duration_ms != null ? fmtDuration(r.duration_ms) : "—"}</span>
                <ToneText value={r.risk_score} className="w-10 text-right text-sm font-semibold" />
                <div className="w-40 text-right">
                  {r.status === "COMPLETED" && r.recommendation ? <RecommendationBadge rec={r.recommendation} /> : <StatusPill status={r.status} />}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
