import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { queryFindings } from "@/lib/db/repo/reviews";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser();
    const sp = req.nextUrl.searchParams;
    const result = queryFindings({
      severity: sp.get("severity") ?? undefined,
      category: sp.get("category") ?? undefined,
      repositoryId: sp.get("repositoryId") ?? undefined,
      author: sp.get("author") ?? undefined,
      status: (sp.get("status") as never) ?? undefined,
      confidenceMin: sp.get("confidenceMin") ? Number(sp.get("confidenceMin")) : undefined,
      q: sp.get("q") ?? undefined,
      limit: Math.min(Number(sp.get("limit") ?? 100), 300),
      offset: Number(sp.get("offset") ?? 0),
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
