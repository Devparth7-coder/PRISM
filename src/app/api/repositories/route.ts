import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listRepositoriesForUser } from "@/lib/db/repo/repositories";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = requireUser();
    const repos = listRepositoriesForUser(user.id);
    return NextResponse.json({
      repositories: repos.map((r) => ({
        ...r,
        profile: r.profile_json ? JSON.parse(r.profile_json) : null,
        profile_json: undefined,
      })),
    });
  } catch (err) {
    return apiError(err);
  }
}
