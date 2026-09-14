"use client";

import { useMemo, useState } from "react";
import { FileDiff, ChevronRight } from "lucide-react";
import type { ChangedFile } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  files: ChangedFile[];
  /** Findings keyed by file path — used to highlight flagged lines. */
  findingsByFile?: Map<string, { lineStart: number; lineEnd: number; id: string; severity: string }[]>;
  selectedFindingId?: string;
  onSelectFinding?: (id: string) => void;
}

export function DiffViewer({ files, findingsByFile, selectedFindingId, onSelectFinding }: Props) {
  const [active, setActive] = useState(files[0]?.path ?? "");
  const file = files.find((f) => f.path === active) ?? files[0];

  const lineMarks = useMemo(() => {
    if (!file) return new Map<number, { id: string; severity: string }[]>();
    const marks = new Map<number, { id: string; severity: string }[]>();
    for (const f of findingsByFile?.get(file.path) ?? []) {
      for (let ln = f.lineStart; ln <= Math.max(f.lineEnd, f.lineStart); ln++) {
        const arr = marks.get(ln) ?? [];
        arr.push({ id: f.id, severity: f.severity });
        marks.set(ln, arr);
      }
    }
    return marks;
  }, [file, findingsByFile]);

  if (!file) return <div className="p-6 text-center text-xs text-graphite-500">No changed files in snapshot</div>;

  return (
    <div className="overflow-hidden rounded-lg border border-graphite-700">
      <div className="flex items-stretch overflow-x-auto border-b border-graphite-700 bg-graphite-900">
        {files.map((f) => {
          const count = findingsByFile?.get(f.path)?.length ?? 0;
          return (
            <button
              key={f.path}
              onClick={() => setActive(f.path)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-r border-graphite-800 px-3 py-2 font-mono text-[11px]",
                f.path === active ? "bg-graphite-950 text-graphite-100" : "text-graphite-400 hover:bg-graphite-800/60",
              )}
            >
              <FileDiff className="h-3 w-3" />
              {f.path.split("/").pop()}
              {count > 0 && <span className="rounded-full bg-red-950 px-1.5 text-[10px] text-red-300">{count}</span>}
              <span className="text-graphite-600">+{f.additions}/-{f.deletions}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto font-mono text-[11.5px] leading-[1.55]">
        {file.hunks.map((hunk, hi) => (
          <div key={hi}>
            <div className="diff-hunk">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </div>
            {hunk.lines.map((line, li) => {
              const marks = line.newNo != null ? lineMarks.get(line.newNo) : undefined;
              const isMarked = marks && marks.length > 0;
              const selected = marks?.some((m) => m.id === selectedFindingId);
              return (
                <div
                  key={li}
                  id={isMarked ? `finding-line-${marks[0]!.id}` : undefined}
                  onClick={() => isMarked && onSelectFinding?.(marks[0]!.id)}
                  className={cn(
                    "diff-line group flex",
                    line.type === "add" && "diff-add",
                    line.type === "del" && "diff-del",
                    isMarked && "diff-finding",
                    selected && "diff-finding-selected",
                    isMarked && "cursor-pointer",
                  )}
                >
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-graphite-600">{line.oldNo ?? ""}</span>
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-graphite-600">{line.newNo ?? ""}</span>
                  <span className="w-4 shrink-0 select-none text-graphite-500">
                    {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                  </span>
                  <pre className="whitespace-pre">{line.text}</pre>
                  {isMarked && (
                    <span
                      className={cn(
                        "ml-auto flex shrink-0 items-center gap-1 pr-2 text-[9px] font-sans font-semibold uppercase",
                        marks.some((m) => m.severity === "CRITICAL" || m.severity === "HIGH")
                          ? "text-red-300"
                          : "text-amber-300",
                      )}
                    >
                      <ChevronRight className="h-3 w-3" />
                      {marks[0]!.severity}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
