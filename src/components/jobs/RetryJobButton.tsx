"use client";

import { useState } from "react";
import { RotateCw, CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui";

export function RetryJobButton({ jobId }: { jobId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function retry() {
    setState("busy");
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retryDeadJob: jobId }),
    });
    setState(res.ok ? "done" : "error");
    if (res.ok) setTimeout(() => window.location.reload(), 800);
  }
  return (
    <button onClick={retry} disabled={state === "busy" || state === "done"} className="btn-secondary h-7 text-[11px]">
      {state === "busy" ? (
        <Spinner className="h-3 w-3" />
      ) : state === "done" ? (
        <CheckCircle2 className="h-3 w-3 text-prism-green" />
      ) : (
        <RotateCw className="h-3 w-3" />
      )}
      {state === "error" ? "Retry failed" : state === "done" ? "Requeued" : "Requeue job"}
    </button>
  );
}
