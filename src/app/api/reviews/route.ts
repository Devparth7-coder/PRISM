import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueueJob } from "@/lib/db/repo/jobs";
import { getPullRequest, getLatestSnapshot, getRepositoryById } from "@/lib/db/repo/repositories";
import { id } from "@/lib/db/client";
import { apiError, rateLimit } from "@/lib/api";
import { ingestLivePullRequest } from "@/lib/services/github-live";
import { config, hasGitHubApp } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual review trigger:
 *  { prId, mode?, force? }                 — queued snapshot review
 *  { owner, repo, number, mode? }          — live GitHub PR (requires App)
 */
export async function POST(req: NextRequest) {
  try {
    const user = requireUser();
    if (!rateLimit(`review:${user.id}`, 12, 60_000).ok) {
      return NextResponse.json({ error: "Rate limit exceeded for manual reviews." }, { status: 429 });
    }
    const body = (await req.json()) as {
      prId?: string;
      mode?: "fast" | "standard" | "deep" | "security" | "test";
      force?: boolean;
      owner?: string;
      repo?: string;
      number?: number;
      installationId?: number;
    };

    if (body.owner && body.repo && body.number) {
      if (config.mode !== "live" || !hasGitHubApp()) {
        return NextResponse.json(
          { error: "Live GitHub review requires PRISM_MODE=live with a configured GitHub App." },
          { status: 400 },
        );
      }
      const installationId = body.installationId ?? Number(process.env.GITHUB_APP_DEFAULT_INSTALLATION);
      if (!installationId) return NextResponse.json({ error: "installationId required" }, { status: 400 });
      const result = await ingestLivePullRequest({
        installationId,
        owner: body.owner,
        repo: body.repo,
        number: body.number,
        mode: body.mode ?? "standard",
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (!body.prId) return NextResponse.json({ error: "prId or owner/repo/number required" }, { status: 400 });
    const pr = getPullRequest(body.prId);
    if (!pr) return NextResponse.json({ error: "Pull request not found" }, { status: 404 });
    const repo = getRepositoryById(pr.repository_id)!;
    const member = repo.org_id
      ? ((await import("@/lib/db/repo/identity")).authorizedRepoIds(user.id).has(repo.id))
      : false;
    if (!member) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

    const snapshotId = getLatestSnapshot(pr.id, pr.head_sha)?.id;
    if (!snapshotId) return NextResponse.json({ error: "No snapshot" }, { status: 409 });

    const dedupeKey = body.force
      ? `manual:${pr.id}:${pr.head_sha}:${id("j")}`
      : `review:${pr.id}:${pr.head_sha}`;
    enqueueJob(
      "review-pr",
      { prId: pr.id, snapshotId, headSha: pr.head_sha, mode: body.mode ?? "standard" },
      { dedupeKey, maxAttempts: 3 },
    );
    return NextResponse.json({ ok: true, prId: pr.id, snapshotId, queued: true });
  } catch (err) {
    return apiError(err);
  }
}
