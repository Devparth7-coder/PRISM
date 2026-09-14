import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeOAuthCode } from "@/lib/github/app";
import { createSession, upsertUser } from "@/lib/db/repo/identity";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookies().get("prism_oauth_state")?.value;
  if (!code || !state || state !== expected) {
    return NextResponse.redirect(new URL("/login?error=oauth_state", config.baseUrl));
  }
  try {
    const gh = await exchangeOAuthCode(code);
    const user = upsertUser({
      githubId: gh.githubId,
      login: gh.login,
      name: gh.name,
      email: gh.email,
      avatarUrl: gh.avatarUrl,
    });
    // Repository access is derived entirely from GitHub installations on
    // subsequent webhooks — never invented at login.
    const token = createSession(user.id);
    const res = NextResponse.redirect(new URL("/dashboard", config.baseUrl));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    cookies().delete("prism_oauth_state");
    return res;
  } catch (err) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(err instanceof Error ? err.message.slice(0, 120) : "oauth")}`, config.baseUrl),
    );
  }
}
