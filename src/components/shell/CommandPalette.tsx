"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, FileCode, GitPullRequest, AlertTriangle, Activity, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

interface Result {
  type: string;
  label: string;
  href: string;
  group: string;
}

const typeIcon: Record<string, typeof FileCode> = {
  command: LayoutDashboard,
  repository: FileCode,
  "pull-request": GitPullRequest,
  review: Activity,
  finding: AlertTriangle,
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: { results: Result[] }) => {
        setResults(d.results.slice(0, 30));
        setCursor(0);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [q, open]);

  const grouped = useMemo(() => {
    const map = new Map<string, Result[]>();
    for (const r of results) {
      const list = map.get(r.group) ?? [];
      list.push(r);
      map.set(r.group, list);
    }
    return [...map.entries()];
  }, [results]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (e.key === "Enter" && results[cursor]) {
        router.push(results[cursor]!.href);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, cursor, router, onClose]);

  if (!open) return null;
  let flatIndex = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-graphite-600 bg-graphite-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-graphite-700 px-4">
          <Search className="h-4 w-4 text-graphite-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search PRs, findings, repositories, actions…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-graphite-400"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {grouped.length === 0 ? <div className="p-6 text-center text-xs text-graphite-400">No results</div> : null}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-graphite-500">{group}</div>
              {items.map((r) => {
                flatIndex += 1;
                const idx = flatIndex;
                const Icon = typeIcon[r.type] ?? FileCode;
                return (
                  <button
                    key={`${r.type}-${r.href}`}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => {
                      router.push(r.href);
                      onClose();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm",
                      cursor === idx ? "bg-graphite-700 text-graphite-50" : "text-graphite-200",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-graphite-400" />
                    <span className="truncate">{r.label}</span>
                    <CornerDownLeft className="ml-auto h-3 w-3 opacity-0" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
