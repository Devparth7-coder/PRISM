import { NextResponse, type NextRequest } from "next/server";
import { createSession, getUser } from "@/lib/db/repo/identity";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { seedDemo, DEMO } from "@/lib/demo/seed";
import { getRepositoryByFullName } from "@/lib/db/repo/repositories";
import { config, hasGitHubApp } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = rateLimit(`login:${ip}`, 10, 5 * 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many attempts, try again shortly." }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  if (body.mode === "demo") {
    const seeded = seedDemo();
    const user = getUser(seeded.userId)!;
    const token = createSession(user.id);
    const res = NextResponse.json({
      user: { id: user.id, login: user.login, name: user.name, isDemo: true },
      repoId: seeded.repoId,
      prId: seeded.prId,
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  if (hasGitHubApp() && config.github.oauthClientId) {
    return NextResponse.json({ error: "Use GitHub OAuth flow (/api/auth/github) in live mode." }, { status: 400 });
  }
  void DEMO;
  void getRepositoryByFullName;
  return NextResponse.json(
    { error: "No identity provider configured. Use demo mode or set GitHub OAuth credentials." },
    { status: 400 },
  );
}
