import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { oauthAuthorizeUrl } from "@/lib/github/app";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  if (!config.github.oauthClientId) {
    return NextResponse.json({ error: "GitHub OAuth is not configured." }, { status: 400 });
  }
  const state = randomBytes(16).toString("hex");
  cookies().set("prism_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/", maxAge: 600 });
  return NextResponse.redirect(oauthAuthorizeUrl(state));
}
