"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Wrench, ArrowRight } from "lucide-react";
import { Spinner } from "@/components/ui";

const MODES = [
  { value: "fast", label: "Fast — deterministic only" },
  { value: "standard", label: "Standard (default)" },
  { value: "deep", label: "Deep — all agents + critic" },
  { value: "security", label: "Security focused" },
  { value: "test", label: "Test-gap focused" },
] as const;

export function ReviewActions({ prId, isDemo, latestReviewId }: { prId: string; isDemo: boolean; latestReviewId?: string }) {
  const [mode, setMode] = useState<string>("standard");
  const [busy, setBusy] = useState<"review" | "fix" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runReview() {
    setBusy("review");
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prId, mode, force: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to enqueue review");
      setTimeout(() => window.location.assign(`/pull-requests/${prId}`), 1200);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function simulateFix() {
    setBusy("fix");
    setError(null);
    const res = await fetch("/api/demo/fix", { method: "POST" });
    if (res.ok) {
      setTimeout(() => window.location.assign(`/pull-requests/${prId}`), 1500);
    } else {
      setError("Could not create the fix commit");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="input h-8 w-56 text-xs">
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <button onClick={runReview} disabled={busy !== null} className="btn-primary h-8 text-xs">
          {busy === "review" ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          Run review
        </button>
        {isDemo && (
          <button onClick={simulateFix} disabled={busy !== null} className="btn-secondary h-8 text-xs">
            {busy === "fix" ? <Spinner className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
            Simulate fix push
          </button>
        )}
        {latestReviewId && (
          <Link href={`/reviews/${latestReviewId}`} className="btn-secondary h-8 text-xs">
            Latest review <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {error && <p className="text-[11px] text-prism-red">{error}</p>}
    </div>
  );
}
