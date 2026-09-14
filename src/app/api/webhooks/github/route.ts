/**
 * GitHub webhook endpoint. Contract: verify signature → persist event →
 * enqueue job → respond fast. No review work happens in the request.
 */
import { NextResponse, type NextRequest } from "next/server";
import { config, hasWebhookSecret } from "@/lib/config";
import { verifySignature, parseWebhook } from "@/lib/github/webhook";
import { recordWebhook } from "@/lib/db/repo/governance";
import { enqueueJob } from "@/lib/db/repo/jobs";
import { clientIp, rateLimit } from "@/lib/api";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limiter = rateLimit(`webhook:${ip}`, 120, 60_000);
  if (!limiter.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");
  const delivery = req.headers.get("x-github-delivery") ?? undefined;

  // Without a configured secret we cannot verify deliveries at all.
  if (!hasWebhookSecret()) {
    recordWebhook({
      deliveryId: delivery,
      event: event ?? "unknown",
      signatureValid: false,
      payload: { note: "rejected: GITHUB_WEBHOOK_SECRET not configured" },
      status: "invalid",
      error: "webhook secret unconfigured",
    });
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  if (!verifySignature(raw, signature, config.github.webhookSecret)) {
    recordWebhook({
      deliveryId: delivery,
      event: event ?? "unknown",
      signatureValid: false,
      payload: safeParse(raw),
      status: "invalid",
      error: "signature mismatch",
    });
    log.warn("rejected webhook with invalid signature", { delivery, event });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    recordWebhook({ deliveryId: delivery, event: event ?? "unknown", signatureValid: true, payload: {}, status: "invalid", error: "invalid JSON" });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseWebhook(
    { event, delivery },
    payload,
  );

  if (!parsed.ok) {
    recordWebhook({
      deliveryId: delivery,
      event: event ?? "unknown",
      action: (payload as { action?: string })?.action,
      signatureValid: true,
      installationId: (payload as { installation?: { id?: number } })?.installation?.id,
      payload,
      status: "invalid",
      error: parsed.reason,
    });
    return NextResponse.json({ ok: false, reason: parsed.reason }, { status: 400 });
  }

  const { webhook, shouldEnqueue, reason } = parsed;
  recordWebhook({
    deliveryId: webhook.deliveryId,
    event: webhook.event,
    action: webhook.action,
    signatureValid: true,
    installationId: webhook.installationId,
    repositoryFull: webhook.repositoryFullName,
    payload: webhook.payload,
    status: shouldEnqueue ? "enqueued" : "ignored",
  });
  log.info("webhook accepted", { event: webhook.event, action: webhook.action, delivery: webhook.deliveryId });

  if (webhook.event === "installation" || webhook.event === "installation_repositories") {
    enqueueJob("discover-installation", {
      installationId: webhook.installationId,
      action: webhook.action,
      payload: compact(webhook.payload),
    });
  }

  if (shouldEnqueue && webhook.installationId && webhook.repositoryFullName) {
    const pr = webhook.payload.pull_request as { number: number; head: { sha: string } };
    const [owner, repo] = webhook.repositoryFullName.split("/");
    enqueueJob(
      "ingest-github-pr",
      {
        installationId: webhook.installationId,
        owner,
        repo,
        number: pr.number,
        headSha: pr.head.sha,
      },
      { dedupeKey: `ingest:${webhook.repositoryFullName}:${pr.number}:${pr.head.sha}` },
    );
  }

  return NextResponse.json({ ok: true, enqueued: shouldEnqueue, reason });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function compact(payload: Record<string, unknown>): unknown {
  // Persist a trimmed envelope; never store redundant installation tokens.
  return {
    action: payload.action,
    installation: payload.installation,
    repositories_added: payload.repositories_added,
    repositories_removed: payload.repositories_removed,
    repositories: payload.repositories,
  };
}
