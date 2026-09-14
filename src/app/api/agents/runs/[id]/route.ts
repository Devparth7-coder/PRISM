import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRun, listToolsForRun, getReview } from "@/lib/db/repo/reviews";
import { getPullRequest } from "@/lib/db/repo/repositories";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireUser();
    const run = getRun(params.id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const review = getReview(run.review_id)!;
    const pr = getPullRequest(review.pr_id)!;
    if (!authorizedRepoIds(user.id).has(pr.repository_id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ run, tools: listToolsForRun(run.id), reviewId: run.review_id });
  } catch (err) {
    return apiError(err);
  }
}
