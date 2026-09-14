/**
 * Context Engine — PRISM does not review the diff in a vacuum.
 * Selects a BOUNDED, relevant context bundle: changed symbols, callers/callees,
 * related tests, config, and architectural hotspots. We never dump the whole
 * repository into an LLM: the bundle has a hard character budget.
 */
import type { ChangedFile, CodeSymbol } from "../types";
import { buildGraph, relatedNodes, type BuiltGraph } from "./graph";

export interface ContextFile {
  path: string;
  content: string;
  reason: string;
  truncated: boolean;
}

export interface ContextBundle {
  files: ContextFile[];
  changedSymbols: { file: string; symbol: CodeSymbol }[];
  relationships: {
    file: string;
    callers: string[];
    callees: string[];
    tests: string[];
    importers: string[];
  }[];
  totalChars: number;
  budgetChars: number;
  hotspots: string[];
}

const HOTSPOT_PATTERNS = [
  { re: /auth|session|login|oauth|jwt|password|credential/i, label: "authentication boundary" },
  { re: /authori[sz]|permission|role|rbac|admin/i, label: "authorization boundary" },
  { re: /payment|billing|stripe|charge|refund/i, label: "payments surface" },
  { re: /sql|query|migration|schema|database|db\//i, label: "data layer" },
  { re: /middleware|guard|interceptor/i, label: "request middleware" },
  { re: /secret|token|crypto|encrypt|hash/i, label: "cryptography / secrets" },
];

const MAX_FILE_CHARS = 12_000;

export function buildContext(input: {
  tree: Record<string, string>;
  changedFiles: ChangedFile[];
  budgetChars?: number;
}): ContextBundle & { built: BuiltGraph } {
  const budgetChars = input.budgetChars ?? 90_000;
  const built = buildGraph(input.tree, input.changedFiles);
  const { graph, extractions } = built;
  const files: ContextFile[] = [];
  const include = new Map<string, ContextFile>();
  const relationships: ContextBundle["relationships"] = [];
  const changedSymbols: ContextBundle["changedSymbols"] = [];
  const hotspots = new Set<string>();

  const addFile = (path: string, reason: string) => {
    if (include.has(path)) return;
    const raw = input.tree[path];
    if (raw === undefined) return;
    const truncated = raw.length > MAX_FILE_CHARS;
    const entry: ContextFile = { path, content: raw.slice(0, MAX_FILE_CHARS), reason, truncated };
    include.set(path, entry);
  };

  const changedPaths = input.changedFiles.map((f) => f.path);

  // 1. Changed files themselves + symbols intersecting added lines.
  for (const cf of input.changedFiles) {
    addFile(cf.path, "changed in PR");
    for (const h of cf.hunks) {
      for (const l of h.lines) {
        if (l.type !== "add" || l.newNo === null) continue;
        const ext = extractions.get(cf.path);
        if (!ext) continue;
        const owner = ext.symbols.find((s) => l.newNo! >= s.lineStart && l.newNo! <= s.lineEnd);
        if (owner && !changedSymbols.some((c) => c.symbol.name === owner.name && c.file === cf.path)) {
          changedSymbols.push({ file: cf.path, symbol: owner });
        }
      }
    }
  }

  // 2. Graph-derived relationships — the "understand, don't just read" step.
  for (const path of changedPaths) {
    const rel = relatedNodes(graph, path, 2);
    relationships.push({
      file: path,
      callers: rel.callers.map((n) => (n.kind === "file" ? n.id : `${n.file}::${n.name}`)),
      callees: rel.callees.map((n) => (n.kind === "file" ? n.id : `${n.file}::${n.name}`)),
      tests: rel.tests.map((n) => n.id),
      importers: rel.importers.map((n) => n.id),
    });
    for (const n of [...rel.callers, ...rel.callees, ...rel.tests, ...rel.importers]) {
      if (n.kind === "file" && input.tree[n.id] !== undefined) {
        addFile(n.id, n.kind === "file" && /test/i.test(n.id) ? "related test suite" : "graph relationship");
      }
    }
  }

  // 3. Nearby test files by convention even if the static graph missed them.
  for (const cf of input.changedFiles) {
    const dir = cf.path.split("/").slice(0, -1).join("/");
    const base = cf.path.split("/").pop()!.replace(/\.[a-z]+$/, "");
    for (const p of Object.keys(input.tree)) {
      if (!/\.(test|spec)\.[a-z]+$|_test\.go$|test_/.test(p)) continue;
      if (p.includes(base) || p.startsWith(`${dir}/__tests__`)) addFile(p, "conventionally related test");
    }
  }

  // 4. Configuration & policy surfaces.
  for (const p of Object.keys(input.tree)) {
    if (/(package\.json|tsconfig|pyproject|go\.mod|requirements.*\.txt|\.github\/workflows\/|Dockerfile|docker-compose)/i.test(p)) {
      addFile(p, "dependency / CI configuration");
    }
    if (/(middleware|auth|permission|guard|policy)/i.test(p) && changedPaths.some((c) => /route|api|handler|controller/i.test(c))) {
      addFile(p, "security boundary used by changed routes");
    }
  }

  // 5. Hotspots label architectural risk areas (feeds risk explainability).
  for (const p of [...changedPaths, ...include.keys()]) {
    for (const h of HOTSPOT_PATTERNS) if (h.re.test(p)) hotspots.add(h.label);
  }

  // Apply global budget, changed files first.
  const ordered = [...include.values()].sort((a, b) => {
    const rank = (f: ContextFile) => (f.reason === "changed in PR" ? 0 : f.reason.includes("test") ? 2 : 1);
    return rank(a) - rank(b);
  });
  let used = 0;
  for (const f of ordered) {
    if (used + f.content.length > budgetChars) {
      // Keep partial file to use remaining budget, then stop.
      const room = budgetChars - used;
      if (room > 1000) files.push({ ...f, content: f.content.slice(0, room), truncated: true });
      break;
    }
    files.push(f);
    used += f.content.length;
  }

  return {
    files,
    changedSymbols,
    relationships: relationships.filter(
      (r) => r.callers.length || r.callees.length || r.tests.length || r.importers.length,
    ),
    totalChars: used,
    budgetChars,
    hotspots: [...hotspots],
    built,
  };
}
