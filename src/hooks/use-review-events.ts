"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEventRow } from "@/lib/db/repo/reviews";
import type { ReviewRow } from "@/lib/db/repo/reviews";

export interface LiveReviewState {
  status: ReviewRow["status"];
  events: AgentEventRow[];
  connected: boolean;
}

/**
 * Subscribes to the persisted-event SSE stream. Renders only real pipeline
 * output — no timers, no fake stage transitions. When the review is already
 * terminal the stream closes on the `done` event and the page refetches.
 */
export function useReviewEvents(reviewId: string, initial: { status: ReviewRow["status"]; events: AgentEventRow[] }): LiveReviewState {
  const [status, setStatus] = useState(initial.status);
  const [events, setEvents] = useState<AgentEventRow[]>(initial.events);
  const [connected, setConnected] = useState(false);
  const seen = useRef<Set<number>>(new Set(initial.events.map((e) => e.id)));

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const terminal = new Set(["COMPLETED", "FAILED"]);

    const connect = () => {
      if (cancelled) return;
      es = new EventSource(`/api/reviews/${reviewId}/events`);
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        try {
          const row = JSON.parse(ev.data) as AgentEventRow;
          setEvents((prev) => {
            if (seen.current.has(row.id)) return prev;
            seen.current.add(row.id);
            const next = [...prev, row];
            return next.sort((a, b) => a.id - b.id);
          });
        } catch {
          /* ignore malformed heartbeat payloads */
        }
      };
      es.addEventListener("done", (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data) as { status: ReviewRow["status"] };
          setStatus(d.status);
        } catch {
          /* fall through to refetch */
        }
        es?.close();
        // Server components hold the full detail; refetch after terminal.
        setTimeout(() => window.location.reload(), 400);
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!cancelled) retry = setTimeout(connect, 2500);
      };
    };

    if (!terminal.has(status)) connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  return { status, events, connected };
}
