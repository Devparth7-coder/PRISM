import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPolicyForRepo, listPolicies, upsertRepoPolicy } from "@/lib/db/repo/governance";
import { getRepositoryById } from "@/lib/db/repo/repositories";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser();
    const repoId = req.nextUrl.searchParams.get("repositoryId");
    if (repoId) {
      if (!authorizedRepoIds(user.id).has(repoId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      return NextResponse.json({ policy: getPolicyForRepo(repoId) });
    }
    return NextResponse.json({ policies: listPolicies(), global: getPolicyForRepo(null) });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireUser();
    const body = (await req.json()) as Parameters<typeof upsertRepoPolicy>[1] & { repositoryId?: string | null };
    if (body.repositoryId) {
      if (!authorizedRepoIds(user.id).has(body.repositoryId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    upsertRepoPolicy(body.repositoryId ?? null, body);
    return NextResponse.json({ ok: true, policy: getPolicyForRepo(body.repositoryId ?? null) });
  } catch (err) {
    return apiError(err);
  }
}
void getRepositoryById;
