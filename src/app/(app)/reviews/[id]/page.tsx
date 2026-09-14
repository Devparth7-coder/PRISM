import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { reviewDetail } from "@/lib/services/read-models";
import { ReviewWorkspace } from "@/components/review/ReviewWorkspace";

export const dynamic = "force-dynamic";

export default function ReviewPage({ params }: { params: { id: string } }) {
  const user = requireUser();
  let detail;
  try {
    detail = reviewDetail(params.id, user.id);
  } catch (err) {
    if ((err as { status?: number }).status === 404) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <ReviewWorkspace
        isDemo={detail.review.is_demo === 1 || detail.repo.is_demo === 1}
        detail={{
          review: detail.review,
          pr: {
            id: detail.pr.id,
            number: detail.pr.number,
            title: detail.pr.title,
            html_url: null,
            base_sha: detail.pr.base_sha,
            head_sha: detail.pr.head_sha,
            author: detail.pr.author,
            created_at: detail.pr.created_at,
          },
          repo: { id: detail.repo.id, full_name: detail.repo.full_name, is_demo: detail.repo.is_demo },
          files: detail.files,
          findings: detail.findings,
          runs: detail.runs,
          events: detail.events,
          artifacts: detail.artifacts,
          risk: detail.risk,
          previousReview: detail.previousReview
            ? { id: detail.previousReview.id, risk_score: detail.previousReview.risk_score, findings: detail.previousReview.findings }
            : null,
        }}
      />
    </div>
  );
}
