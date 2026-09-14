/**
 * Lightweight static symbol extractor (tree-sitter can replace this behind the
 * same interface). It resolves imports, functions, classes, interfaces, routes,
 * tests and database entities well enough to build a real call/relationship
 * graph and context bundle for TS/JS/Python — the demo stack's languages.
 */
import type { CodeSymbol } from "../types";

export interface FileExtraction {
  file: string;
  language: string;
  symbols: CodeSymbol[];
  imports: { source: string; names: string[]; line: number }[];
  /** Identifiers invoked in this file, with line numbers. */
  calls: { name: string; line: number }[];
}

const TS_FUNCTION =
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\(([^)]*)\)/g;
const TS_ARROW =
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(([^)]*)\)[^=>]*=>/gm;
const TS_CLASS = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$.]+))?/gm;
const TS_INTERFACE = /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$.,\s]+))?/g;
const TS_TYPE = /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/g;
const TS_IMPORT = /^\s*import\s+(?:([\w*${}\s,]+)\s+from\s+)?["']([^"']+)["']/gm;
const TS_ROUTE = /(?:[Rr]outer|app)\.(get|post|put|patch|delete|use)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
const TS_CALL = /\b([A-Za-z_$][\w$]*)\s*\(/g;

const PY_DEF = /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gm;
const PY_CLASS = /^class\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?\s*:/gm;
const PY_IMPORT = /^\s*from\s+([\w.]+)\s+import\s+([\w,\s*]+)|^\s*import\s+([\w.,\s]+)/gm;
const PY_ROUTE = /@(app|router)\.(get|post|put|patch|delete)\(["']([^"']+)["']/g;

export function extractSymbols(file: string, content: string, language: string): FileExtraction {
  const lines = content.split("\n");
  const endFor = (startLine: number): number => {
    // Bracket-based block end for the symbol beginning at startLine.
    let depth = 0;
    let seen = false;
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i] ?? "") {
        if (ch === "{" || ch === "(") {
          depth++;
          seen = true;
        } else if (ch === "}" || ch === ")") depth--;
      }
      if (seen && depth <= 0 && i > startLine) return i + 1;
      if (!seen && i > startLine + 30) return i + 1;
    }
    return Math.min(lines.length, startLine + 1);
  };

  const symbols: CodeSymbol[] = [];
  const imports: FileExtraction["imports"] = [];
  const callSet = new Map<string, number>();

  const push = (kind: CodeSymbol["kind"], name: string, line: number, detail?: string) => {
    symbols.push({ kind, name, file, lineStart: line + 1, lineEnd: Math.max(line + 1, endFor(line)), language, detail });
  };

  if (language === "typescript" || language === "javascript") {
    for (const m of content.matchAll(TS_IMPORT)) {
      const line = content.slice(0, m.index ?? 0).split("\n").length - 1;
      const names = (m[1] ?? "")
        .replace(/[{}*]/g, "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      imports.push({ source: m[2]!, names, line });
    }
    for (const m of content.matchAll(TS_FUNCTION)) {
      const line = lineOf(content, m.index);
      push("function", m[1]!, line, m[2]);
    }
    for (const m of content.matchAll(TS_ARROW)) {
      const line = lineOf(content, m.index);
      push("function", m[1]!, line, m[2]);
    }
    for (const m of content.matchAll(TS_CLASS)) {
      const line = lineOf(content, m.index);
      push(/model|schema|entity/i.test(m[2] ?? "") ? "db_entity" : "class", m[1]!, line, m[2] ? `extends ${m[2]}` : undefined);
    }
    for (const m of content.matchAll(TS_INTERFACE)) push("interface", m[1]!, lineOf(content, m.index), m[2] ?? undefined);
    for (const m of content.matchAll(TS_TYPE)) push("type", m[1]!, lineOf(content, m.index));
    for (const m of content.matchAll(TS_ROUTE)) {
      push("route", `${m[1]!.toUpperCase()} ${m[2]}`, lineOf(content, m.index));
    }
    if (/mongoose|sequelize|prisma|typeorm|CREATE TABLE/i.test(content)) {
      for (const m of content.matchAll(/model\(["']([\w]+)["']|CREATE TABLE(?: IF NOT EXISTS)? ["`]?(\w+)/g)) {
        push("db_entity", (m[1] ?? m[2])!, lineOf(content, m.index));
      }
    }
    for (const m of content.matchAll(TS_CALL)) {
      const name = m[1]!;
      if (KEYWORDS.has(name)) continue;
      const line = lineOf(content, m.index);
      if (!callSet.has(name)) callSet.set(name, line);
    }
  } else if (language === "python") {
    for (const m of content.matchAll(PY_IMPORT)) {
      const line = lineOf(content, m.index);
      const source = m[1] ?? m[3] ?? "";
      const names = (m[2] ?? m[3] ?? "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      imports.push({ source: source.trim(), names, line });
    }
    for (const m of content.matchAll(PY_DEF)) push("function", m[1]!, lineOf(content, m.index), m[2]);
    for (const m of content.matchAll(PY_CLASS)) {
      push(/Model|Schema|Base/i.test(m[2] ?? "") ? "db_entity" : "class", m[1]!, lineOf(content, m.index), m[2] ?? undefined);
    }
    for (const m of content.matchAll(PY_ROUTE)) push("route", `${m[2]!.toUpperCase()} ${m[3]}`, lineOf(content, m.index));
    for (const m of content.matchAll(/\b([A-Za-z_][\w]*)\s*\(/g)) {
      const name = m[1]!;
      if (KEYWORDS.has(name)) continue;
      if (!callSet.has(name)) callSet.set(name, lineOf(content, m.index));
    }
  }

  if (/(^|\/)test|spec/i.test(file)) {
    for (const s of symbols) if (s.kind === "function") s.kind = "test";
  }
  for (const m of content.matchAll(/\b(?:it|test|describe)\s*\(\s*[`"']([^`"']+)[`'"]/g)) {
    symbols.push({ kind: "test", name: m[1]!, file, lineStart: lineOf(content, m.index) + 1, lineEnd: lineOf(content, m.index) + 1, language });
  }

  return { file, language, symbols: dedupeSymbols(symbols), imports, calls: [...callSet.entries()].map(([name, line]) => ({ name, line: line + 1 })) };
}

const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await", "async",
  "const", "let", "var", "require", "import", "from", "export", "default", "throw", "else", "do",
  "map", "filter", "reduce", "forEach", "parse", "stringify", "then", "catch2", "super",
  "print", "range", "len", "isinstance", "str", "int", "list", "dict", "set", "getattr",
]);

function dedupeSymbols(symbols: CodeSymbol[]): CodeSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.kind}:${s.name}:${s.lineStart}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lineOf(text: string, index?: number): number {
  return text.slice(0, index ?? 0).split("\n").length - 1;
}
