"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-graphite-700 bg-graphite-950">
      <div className="flex items-center justify-between border-b border-graphite-800 px-3 py-1.5">
        <span className="font-mono text-[10px] text-graphite-400">{label ?? "text"}</span>
        <button
          className="flex items-center gap-1 text-[10px] text-graphite-300 hover:text-graphite-100"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-3 w-3 text-prism-green" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-graphite-300">{value}</pre>
    </div>
  );
}
