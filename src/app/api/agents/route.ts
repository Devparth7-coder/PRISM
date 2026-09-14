import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = requireUser();
    const catalog = db().prepare("SELECT * FROM agents ORDER BY stage").all();
    const runs = db()
      .prepare(
        `SELECT ar.*, p.number AS pr_number, r.full_name AS repo_full_name
         FROM agent_runs ar
         JOIN reviews rv ON rv.id = ar.review_id
         JOIN pull_requests p ON p.id = rv.pr_id
         JOIN repositories r ON r.id = p.repository_id
         JOIN org_members m ON m.org_id = r.org_id AND m.user_id = ?
         ORDER BY ar.rowid DESC LIMIT 60`,
      )
      .all(user.id);
    return NextResponse.json({ agents: catalog, runs });
  } catch (err) {
    return apiError(err);
  }
}
