import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/db/repo/identity";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { config, hasGitHubApp } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const user = getSessionUser(token);
  return NextResponse.json({
    user,
    mode: config.mode,
    githubAppConfigured: hasGitHubApp(),
  });
}
