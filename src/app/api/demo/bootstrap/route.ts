import { NextResponse } from "next/server";
import { seedDemo } from "@/lib/demo/seed";
import { createSession, getUser } from "@/lib/db/repo/identity";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = seedDemo();
  const user = getUser(result.userId)!;
  let token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    token = createSession(user.id);
    cookies().set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return NextResponse.json({ ok: true, ...result, demo: true });
}
