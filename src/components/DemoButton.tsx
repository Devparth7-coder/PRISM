"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";
import { Play, Loader2 } from "lucide-react";

/**
 * Boots the deterministic demo: seeds the bundled fixture repository + PR,
 * queues a REAL review through the same pipeline as live webhooks, then opens
 * the review workspace (SSE shows actual progress).
 */
export function DemoButton({ label = "View Demo", variant = "secondary", className }: { label?: string; variant?: "primary" | "secondary"; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function boot() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/bootstrap", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Demo boot failed");
      const data = (await res.json()) as { prId: string };
      router.push(`/pull-requests/${data.prId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} onClick={boot} loading={busy} className={className}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {busy ? "Seeding & reviewing…" : label}
      </Button>
      {error ? <span className="text-xs text-prism-red">{error}</span> : null}
    </div>
  );
}
