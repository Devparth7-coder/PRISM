import { type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { getPullRequest } from "@/lib/db/repo/repositories";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireUser();
    const artifact = db()
      .prepare(
        `SELECT a.*, rv.pr_id FROM artifacts a JOIN reviews rv ON rv.id=a.review_id WHERE a.id=?`,
      )
      .get(params.id) as
      | { review_id: string; pr_id: string; kind: string; filename: string; content: string }
      | undefined;
    if (!artifact) return new Response("Not found", { status: 404 });
    const pr = getPullRequest(artifact.pr_id);
    if (!pr || !authorizedRepoIds(user.id).has(pr.repository_id)) return new Response("Forbidden", { status: 403 });

    const contentType =
      artifact.kind === "json" || artifact.filename.endsWith(".json")
        ? "application/json"
        : artifact.filename.endsWith(".ts")
          ? "text/typescript; charset=utf-8"
          : "text/markdown; charset=utf-8";
    return new Response(artifact.content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${artifact.filename}"`,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
