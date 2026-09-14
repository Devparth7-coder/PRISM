/**
 * Builds the repository Code Graph: nodes for files, functions, classes,
 * interfaces, routes, tests, DB entities and configuration; edges for
 * IMPORTS / CALLS / EXTENDS / TESTS / DEPENDS_ON / MODIFIES.
 * This is what lets PRISM reason "changed function -> callers -> DB layer
 * -> test suite" instead of staring at the diff in isolation.
 */
import type { ChangedFile, CodeEdge, CodeGraph, CodeSymbol } from "../types";
import { extractSymbols, type FileExtraction } from "./symbols";
import { isTestFile, languageForPath } from "./language";

function resolveImport(fromFile: string, source: string, files: Set<string>): string | null {
  if (!source.startsWith(".")) return null; // external package
  const dir = fromFile.split("/").slice(0, -1).join("/");
  const candidates = [
    source,
    `${source}.ts`,
    `${source}.tsx`,
    `${source}.js`,
    `${source}.py`,
    `${source}/index.ts`,
    `${source}/__init__.py`,
  ];
  for (const c of candidates) {
    const resolved = normalizePath(dir ? `${dir}/${c}` : c);
    if (files.has(resolved)) return resolved;
  }
  return null;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export function symbolNodeId(file: string, name: string): string {
  return `${file}::${name}`;
}

export interface BuiltGraph {
  graph: CodeGraph;
  extractions: Map<string, FileExtraction>;
}

export function buildGraph(
  tree: Record<string, string>,
  changedFiles: ChangedFile[] = [],
): BuiltGraph {
  const paths = new Set(Object.keys(tree));
  const extractions = new Map<string, FileExtraction>();
  for (const [path, content] of Object.entries(tree)) {
    const lang = languageForPath(path);
    if (["plaintext", "json", "yaml", "markdown", "toml", "text", "env"].includes(lang)) continue;
    extractions.set(path, extractSymbols(path, content, lang));
  }

  const nodes: CodeGraph["nodes"] = [];
  const edges: CodeEdge[] = [];
  const symbolOwner = new Map<string, string>(); // symbol name -> file (best effort)
  const symbolsByFile = new Map<string, CodeSymbol[]>();

  for (const path of paths) {
    nodes.push({ id: path, kind: "file", name: path, file: path, lineStart: 1, lineEnd: 1, language: languageForPath(path) });
  }
  for (const [path, ext] of extractions) {
    symbolsByFile.set(path, ext.symbols);
    for (const s of ext.symbols) {
      const id = symbolNodeId(path, s.name);
      nodes.push({ id, ...s });
      edges.push({ from: id, to: path, type: "DEPENDS_ON", detail: "declared in" });
      symbolOwner.set(s.name, path);
    }
  }

  // Imports
  for (const [path, ext] of extractions) {
    for (const imp of ext.imports) {
      const resolved = resolveImport(path, imp.source, paths);
      if (resolved) edges.push({ from: path, to: resolved, type: "IMPORTS", detail: imp.source });
    }
  }

  // Calls: a symbol body (lines between start/end) invoking another symbol.
  for (const [path, ext] of extractions) {
    for (const caller of ext.symbols) {
      for (const callee of ext.calls) {
        if (callee.line < caller.lineStart || callee.line > caller.lineEnd) continue;
        if (callee.name === caller.name) continue;
        const owner = symbolOwner.get(callee.name);
        const calleeId = owner ? symbolNodeId(owner, callee.name) : null;
        if (calleeId && calleeId !== symbolNodeId(path, caller.name)) {
          edges.push({ from: symbolNodeId(path, caller.name), to: calleeId, type: "CALLS", detail: `line ${callee.line}` });
        }
      }
    }
  }

  // Extends / implements
  for (const [path, ext] of extractions) {
    for (const s of ext.symbols) {
      if ((s.kind === "class" || s.kind === "db_entity") && s.detail?.startsWith("extends ")) {
        const parent = s.detail.slice(8).trim();
        const owner = symbolOwner.get(parent);
        if (owner) edges.push({ from: symbolNodeId(path, s.name), to: symbolNodeId(owner, parent), type: "EXTENDS" });
      }
    }
  }

  // Tests -> source files
  for (const path of paths) {
    if (!isTestFile(path)) continue;
    const stem = path
      .replace(/\.(test|spec)\.[a-z]+$/i, "")
      .replace(/\/__tests__\//, "/")
      .replace(/^tests?\//, "src/")
      .replace(/_test$/i, "");
    const candidates = [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.py`];
    for (const c of candidates) {
      if (paths.has(c)) {
        edges.push({ from: path, to: c, type: "TESTS" });
        break;
      }
    }
    // Also: same-directory name overlap
    for (const other of paths) {
      if (other === path) continue;
      const ob = other.split("/").pop()?.replace(/\.(test|spec)\.[a-z]+$/i, "").replace(/\.[a-z]+$/, "");
      const tb = path.split("/").pop()?.replace(/\.(test|spec)\.[a-z]+$/i, "").replace(/_test$/i, "");
      if (ob && tb && ob === tb && isTestFile(path) && !isTestFile(other)) {
        edges.push({ from: path, to: other, type: "TESTS" });
      }
    }
  }

  // Modifies: changed file relationships surfaced on the graph.
  for (const cf of changedFiles) {
    const node = nodes.find((n) => n.id === cf.path);
    if (node) node.detail = `MODIFIED (+${cf.additions}/-${cf.deletions})`;
  }

  // De-duplicate edges.
  const seen = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    const k = `${e.from}|${e.type}|${e.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { graph: { nodes, edges: uniqueEdges }, extractions };
}

/** Reverse call graph: who reaches this symbol/file. */
export function relatedNodes(graph: CodeGraph, file: string, depth = 2): {
  callers: CodeGraph["nodes"];
  callees: CodeGraph["nodes"];
  tests: CodeGraph["nodes"];
  importers: CodeGraph["nodes"];
} {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const callers = new Set<string>();
  const callees = new Set<string>();
  const tests = new Set<string>();
  const importers = new Set<string>();

  const seedIds = graph.nodes.filter((n) => n.file === file).map((n) => n.id);
  const inAdj = new Map<string, Set<string>>();
  const outAdj = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!outAdj.has(e.from)) outAdj.set(e.from, new Set());
    if (!inAdj.has(e.to)) inAdj.set(e.to, new Set());
    outAdj.get(e.from)!.add(`${e.to}::${e.type}`);
    inAdj.get(e.to)!.add(`${e.from}::${e.type}`);
  }

  const walk = (start: string[], adj: Map<string, Set<string>>, sink: Set<string>, d: number) => {
    const frontier = [...start];
    for (let level = 0; level < d; level++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const raw of adj.get(id) ?? []) {
          const [target, type] = raw.split("::");
          if (!target || sink.has(target)) continue;
          sink.add(target);
          if (type !== "DEPENDS_ON") next.push(target);
          if (type === "TESTS") tests.add(target);
        }
      }
      frontier.push(...next);
    }
  };

  walk(seedIds, inAdj, callers, depth);
  walk(seedIds, outAdj, callees, depth);
  for (const e of graph.edges) {
    if (e.type === "IMPORTS" && e.to === file) importers.add(e.from);
    if (e.type === "TESTS" && e.to === file) tests.add(e.from);
  }

  const resolve = (set: Set<string>) =>
    [...set].map((id) => nodeById.get(id)).filter((n): n is CodeGraph["nodes"][number] => Boolean(n));

  return { callers: resolve(callers), callees: resolve(callees), tests: resolve(tests), importers: resolve(importers) };
}
