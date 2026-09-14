const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java", kt: "kotlin",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  cpp: "cpp", c: "c", h: "c", hpp: "cpp",
  sql: "sql",
  sh: "shell", bash: "shell",
  yml: "yaml", yaml: "yaml",
  json: "json", json5: "json",
  toml: "toml",
  md: "markdown", mdx: "markdown",
  html: "html", css: "css", scss: "css",
  dockerfile: "dockerfile",
  tf: "hcl",
};

const FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  "package.json": "json",
  "tsconfig.json": "json",
  "pnpm-lock.yaml": "yaml",
  "package-lock.json": "json",
  "yarn.lock": "text",
  "gemfile": "ruby",
  "makefile": "make",
};

export function languageForPath(path: string): string {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  if (FILENAMES[base]) return FILENAMES[base]!;
  if (base === ".env" || base.startsWith(".env")) return "env";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return EXT[ext] ?? "plaintext";
}

export function isTestFile(path: string): boolean {
  return /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$|_test\.go$|test_[a-z_]+\.py$/i.test(path);
}

export function isConfigFile(path: string): boolean {
  return /(^|\/)\.github\/workflows\/|(^|\/)(eslint|prettier|tsconfig|vitest|jest|pytest|tox|pyproject|go\.mod|cargo|docker-compose|docker-compose\.ya?ml)/i.test(
    path,
  );
}

export function isLockFile(path: string): boolean {
  return /(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|go\.sum|cargo\.lock|gemfile\.lock|Pipfile\.lock)$/i.test(path);
}

export function isManifest(path: string): boolean {
  return /(package\.json|pyproject\.toml|requirements(-dev)?\.txt|go\.mod|Cargo\.toml|pom\.xml|Gemfile|build\.gradle)$/i.test(
    path,
  );
}
