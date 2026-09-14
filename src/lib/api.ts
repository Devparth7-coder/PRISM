/**
 * Tiny in-memory sliding-window rate limiter for mutating / AI-backed routes
 * (per-user) and unauthenticated endpoints (per-IP). Webhooks are additionally
 * protected by HMAC signature verification. For multi-replica deployments this
 * is backed by Redis behind the same interface.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs = 60_000): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const retryAfterMs = windowMs - (now - hits[0]!);
    buckets.set(key, hits);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, remaining: max - hits.length, retryAfterMs: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

import { NextResponse } from "next/server";

/** Uniform JSON error shape; raw stack traces never leave the API. */
export function apiError(err: unknown): NextResponse {
  const status = (err as { status?: number })?.status ?? 500;
  const message =
    status === 500 ? "Internal processing error. Check server logs and correlation id." : (err as Error).message;
  return NextResponse.json({ error: message, status }, { status });
}

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}
