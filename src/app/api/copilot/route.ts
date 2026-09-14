import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { answerCopilot } from "@/lib/copilot/answer";
import { clientIp, rateLimit } from "@/lib/api";
import { z } from "zod";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  question: z.string().min(3).max(1000),
  reviewId: z.string().optional(),
  repoId: z.string().optional(),
  findingId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = requireUser();
    if (!rateLimit(`copilot:${user.id}`, 30, 60_000).ok) {
      return NextResponse.json({ error: "Copilot rate limit reached (30/min)." }, { status: 429 });
    }
    void clientIp;
    const body = schema.parse(await req.json());
    const result = await answerCopilot({
      question: body.question,
      userId: user.id,
      reviewId: body.reviewId,
      repoId: body.repoId,
      findingId: body.findingId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
