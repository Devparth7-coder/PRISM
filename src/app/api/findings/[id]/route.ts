import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  dismissFinding,
  getFinding,
  getReview,
} from "@/lib/db/repo/reviews";
import { getPullRequest } from "@/lib/db/repo/repositories";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { recordFeedbackMemory } from "@/lib/orchestrator";
import { apiError } from "@/lib/api";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.enum(["false_positive", "intentional", "not_applicable", "accepted_risk", "reopen"]),
  note: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireUser();
    const body = patchSchema.parse(await req.json());
    const finding = getFinding(params.id);
    if (!finding) return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    const review = getReview(finding.reviewId);
    if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    const pr = getPullRequest(review.pr_id);
    if (!pr || !authorizedRepoIds(user.id).has(pr.repository_id)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    dismissFinding(params.id, { action: body.action, note: body.note, userId: user.id });
    if (body.action !== "reopen") {
      recordFeedbackMemory(pr.repository_id, finding, body.action, body.note);
    }
    return NextResponse.json({ ok: true, status: getFinding(params.id)?.status });
  } catch (err) {
    return apiError(err);
  }
}
