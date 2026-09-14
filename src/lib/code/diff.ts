/**
 * Real line-diff engine (LCS dynamic programming) plus a unified-diff parser.
 * Used to pin every review to an exact commit and to map findings to changed
 * lines rather than guessing from current file contents.
 */
import type { ChangedFile, DiffHunk, DiffLine } from "../types";
import { languageForPath } from "./language";

interface Op {
  type: "context" | "add" | "del";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** Compute edit operations between two file versions using LCS. */
export function lineOps(oldText: string, newText: string): Op[] {
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  // Trailing newline creates a phantom empty line; drop it.
  if (a.length && a[a.length - 1] === "") a.pop();
  if (b.length && b[b.length - 1] === "") b.pop();

  const n = a.length;
  const m = b.length;
  // DP table. Size is bounded upstream by blob truncation (200k chars/file).
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", text: a[i]!, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", text: a[i]!, oldNo: i + 1, newNo: null });
      i++;
    } else {
      ops.push({ type: "add", text: b[j]!, oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: a[i]!, oldNo: i + 1, newNo: null });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", text: b[j]!, oldNo: null, newNo: j + 1 });
    j++;
  }
  return ops;
}

const CONTEXT = 3;

/** Group edit ops into unified hunks with surrounding context lines. */
export function opsToHunks(ops: Op[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let idx = 0;
  while (idx < ops.length) {
    // Skip pure-context runs until a change.
    if (ops[idx]!.type === "context") {
      idx++;
      continue;
    }
    const start = Math.max(0, idx - CONTEXT);
    let end = idx;
    while (end < ops.length) {
      if (ops[end]!.type !== "context") {
        end = Math.min(ops.length, end + 1 + CONTEXT);
        continue;
      }
      // Look ahead through context for another change within 2*CONTEXT.
      let gap = 0;
      let k = end;
      while (k < ops.length && ops[k]!.type === "context" && gap < CONTEXT * 2) {
        k++;
        gap++;
      }
      if (k < ops.length && ops[k]!.type !== "context") {
        end = k;
      } else {
        break;
      }
    }
    const slice = ops.slice(start, end);
    const lines: DiffLine[] = [];
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;
    for (const op of slice) {
      if (op.type === "context") {
        oldStart = oldStart || op.oldNo!;
        newStart = newStart || op.newNo!;
      } else if (op.type === "del") {
        oldStart = oldStart || op.oldNo!;
      } else {
        newStart = newStart || op.newNo!;
      }
    }
    void oldStart;
    void newStart;
    for (const op of slice) {
      lines.push({ type: op.type, oldNo: op.oldNo, newNo: op.newNo, text: op.text });
      if (op.type !== "add") oldCount++;
      if (op.type !== "del") newCount++;
    }
    const firstOld = slice.find((s) => s.oldNo !== null)?.oldNo ?? 1;
    const firstNew = slice.find((s) => s.newNo !== null)?.newNo ?? 1;
    hunks.push({
      oldStart: Math.max(1, firstOld - slice.slice(0, slice.findIndex((s) => s.oldNo === firstOld)).length + 1),
      oldLines: oldCount,
      newStart: firstNew,
      newLines: newCount,
      lines,
    });
    idx = end;
  }
  // Simplify hunk headers (recompute exact starts).
  return hunks.map((h) => {
    const firstContext = h.lines.find((l) => l.type === "context");
    const firstDel = h.lines.find((l) => l.oldNo !== null);
    const firstAdd = h.lines.find((l) => l.newNo !== null);
    return {
      ...h,
      oldStart: (firstContext ?? firstDel)?.oldNo ?? 1,
      newStart: (firstContext ?? firstAdd)?.newNo ?? 1,
    };
  });
}

export function diffFiles(
  path: string,
  oldText: string | undefined,
  newText: string | undefined,
): ChangedFile | null {
  if (oldText === newText) return null;
  let status: ChangedFile["status"];
  let ops: Op[];
  if (oldText === undefined) {
    status = "added";
    ops = (newText ?? "").split("\n").map((text, k) => ({ type: "add" as const, text, oldNo: null, newNo: k + 1 }));
  } else if (newText === undefined) {
    status = "removed";
    ops = oldText.split("\n").map((text, k) => ({ type: "del" as const, text, oldNo: k + 1, newNo: null }));
  } else {
    status = "modified";
    ops = lineOps(oldText, newText);
  }
  if (!ops.some((o) => o.type !== "context")) return null;
  const hunks = opsToHunks(ops);
  const additions = ops.filter((o) => o.type === "add").length;
  const deletions = ops.filter((o) => o.type === "del").length;
  return { path, status, additions, deletions, hunks, language: languageForPath(path) };
}

/** Added (new-file) line numbers — the only lines on which inline review comments can anchor. */
export function addedLineNumbers(file: ChangedFile): Set<number> {
  const set = new Set<number>();
  for (const h of file.hunks) for (const l of h.lines) if (l.type === "add" && l.newNo !== null) set.add(l.newNo);
  return set;
}

/** Parse a unified diff (e.g. from GitHub API) into ChangedFile objects. */
export function parseUnifiedPatch(path: string, patch: string): ChangedFile {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let deletions = 0;
  for (const rawLine of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
    if (header) {
      if (current) hunks.push(current);
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      current = {
        oldStart: oldNo,
        oldLines: Number(header[2] ?? 1),
        newStart: newNo,
        newLines: Number(header[4] ?? 1),
        lines: [{ type: "hunk", oldNo: null, newNo: null, text: rawLine }],
      };
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("+")) {
      current.lines.push({ type: "add", oldNo: null, newNo: newNo++, text: rawLine.slice(1) });
      additions++;
    } else if (rawLine.startsWith("-")) {
      current.lines.push({ type: "del", oldNo: oldNo++, newNo: null, text: rawLine.slice(1) });
      deletions++;
    } else {
      current.lines.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text: rawLine.replace(/^ /, "") });
    }
  }
  if (current) hunks.push(current);
  return {
    path,
    status: "modified",
    additions,
    deletions,
    hunks,
    language: languageForPath(path),
  };
}
