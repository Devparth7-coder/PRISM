/**
 * GitHub webhook security. Payloads are NEVER trusted without a valid
 * X-Hub-Signature-256 HMAC over the raw request body, compared in constant
 * time. Event type, installation and repository identifiers are validated
 * before persistence/enqueueing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifiedWebhook {
  event: string;
  action: string | undefined;
  deliveryId: string | undefined;
  installationId: number | undefined;
  repositoryFullName: string | undefined;
  payload: Record<string, unknown>;
}

export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256").update(secret).update(rawBody).digest("hex")}`;
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

const SUPPORTED_EVENTS = new Set([
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "installation",
  "installation_repositories",
]);

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "closed"]);

export function parseWebhook(headers: { event?: string | null; delivery?: string | null }, payload: unknown):
  | { ok: true; webhook: VerifiedWebhook; shouldEnqueue: boolean; reason?: string }
  | { ok: false; reason: string } {
  const event = headers.event ?? "";
  if (!SUPPORTED_EVENTS.has(event)) {
    return { ok: false, reason: `Unsupported event type: ${event}` };
  }
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "Payload is not an object" };
  }
  const p = payload as Record<string, unknown>;
  const action = typeof p.action === "string" ? p.action : undefined;
  const installation = (p.installation as { id?: number } | undefined)?.id;
  const repository = (p.repository as { full_name?: string } | undefined)?.full_name;

  if (event === "pull_request") {
    if (!action || !PR_ACTIONS.has(action)) {
      return {
        ok: true,
        shouldEnqueue: false,
        reason: `pull_request action '${action ?? "?"}' requires no review`,
        webhook: { event, action, deliveryId: headers.delivery ?? undefined, installationId: installation, repositoryFullName: repository, payload: p },
      };
    }
    const pr = p.pull_request as { number?: number; head?: { sha?: string }; base?: { sha?: string } } | undefined;
    if (!pr?.number || !pr.head?.sha || !pr.base?.sha) {
      return { ok: false, reason: "pull_request payload missing number/head/base SHA" };
    }
    if (!repository || !installation) {
      return { ok: false, reason: "pull_request payload missing installation/repository" };
    }
  }

  return {
    ok: true,
    shouldEnqueue: event === "pull_request" && ["opened", "synchronize", "reopened"].includes(action ?? ""),
    webhook: { event, action, deliveryId: headers.delivery ?? undefined, installationId: installation, repositoryFullName: repository, payload: p },
  };
}
