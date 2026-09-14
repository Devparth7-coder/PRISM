import { NextResponse } from "next/server";
import { ingestFixedCommit } from "@/lib/demo/seed";
import { requireUser } from "@/lib/auth";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { getPullRequest } from "@/lib/db/repo/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Simulate the author pushing a fix commit (pull_request `synchronize`). */
export async function POST() {
  const user = requireUser();
  const { prId, snapshotId } = ingestFixedCommit({ enqueue: true });
  const pr = getPullRequest(prId)!;
  if (!authorizedRepoIds(user.id).has(pr.repository_id)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, prId, snapshotId, headSha: pr.head_sha });
}
