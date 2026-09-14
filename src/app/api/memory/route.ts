import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { addMemory, listMemory } from "@/lib/db/repo/governance";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { z } from "zod";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser();
    const repoId = req.nextUrl.searchParams.get("repositoryId");
    if (!repoId) return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
    if (!authorizedRepoIds(user.id).has(repoId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ memory: listMemory(repoId) });
  } catch (err) {
    return apiError(err);
  }
}

const schema = z.object({
  repositoryId: z.string(),
  kind: z.enum(["accepted_pattern", "rejected_pattern", "architecture_decision", "feedback", "exception"]),
  content: z.string().min(4).max(1000),
});

export async function POST(req: NextRequest) {
  try {
    const user = requireUser();
    const body = schema.parse(await req.json());
    if (!authorizedRepoIds(user.id).has(body.repositoryId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const memory = addMemory({ repositoryId: body.repositoryId, kind: body.kind, content: body.content });
    return NextResponse.json({ ok: true, memory });
  } catch (err) {
    return apiError(err);
  }
}
