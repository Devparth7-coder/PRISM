import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { reviewDetail } from "@/lib/services/read-models";
import { enqueueJob } from "@/lib/db/repo/jobs";
import { id } from "@/lib/db/client";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-queue a failed/stale review as a fresh job (old rows retained for audit). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = requireUser();
    const detail = reviewDetail(params.id, user.id);
    enqueueJob(
      "review-pr",
      { prId: detail.pr.id, snapshotId: detail.review.snapshot_id, headSha: detail.review.head_sha, mode: detail.review.mode as never },
      { dedupeKey: `manual:${detail.pr.id}:${detail.review.head_sha}:${id("j")}` },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
