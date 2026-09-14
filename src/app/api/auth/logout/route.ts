import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@/lib/db/repo/identity";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
