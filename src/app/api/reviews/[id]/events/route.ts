/**
 * Server-Sent Events stream for live review progress. Every UI update is
 * driven by persisted AgentEvent rows (and immediate pub/sub nudges) — there
 * are no simulated/timer-based progress states.
 */
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/db/repo/identity";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { getReview, listEvents, eventBus, type ReviewRow } from "@/lib/db/repo/reviews";
import { getPullRequest } from "@/lib/db/repo/repositories";
import { authorizedRepoIds } from "@/lib/db/repo/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["COMPLETED", "FAILED"]);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const user = getSessionUser(token);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const review = getReview(params.id);
  if (!review) return new Response("Not found", { status: 404 });
  const pr = getPullRequest(review.pr_id);
  if (!pr || !authorizedRepoIds(user.id).has(pr.repository_id)) return new Response("Forbidden", { status: 403 });

  let lastId = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown, name = "message") => {
        try {
          controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          teardown();
        }
      };

      const flush = () => {
        const events = listEvents(params.id, lastId);
        for (const e of events) {
          lastId = e.id;
          send(e);
        }
        const current = getReview(params.id) as ReviewRow | undefined;
        if (current && TERMINAL.has(current.status)) {
          send({ status: current.status, reviewId: params.id }, "done");
          teardown();
        }
      };

      const unsubscribe = eventBus.subscribe(params.id, flush);
      const interval = setInterval(flush, 900);
      interval.unref?.();

      const teardown = () => {
        clearInterval(interval);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Heartbeat keeps proxies from idling the connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          teardown();
        }
      }, 15_000);
      heartbeat.unref?.();
      const originalTeardown = teardown;
      // (heartbeat cleared in teardown closure below)
      const teardownAll = () => {
        clearInterval(heartbeat);
        originalTeardown();
      };
      _req.signal.addEventListener("abort", teardownAll);

      send({ status: review.status, reviewId: params.id }, "snapshot");
      flush();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
