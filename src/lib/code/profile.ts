/**
 * Repository discovery — generates the repository profile FROM REAL FILES.
 * Language shares, package manager, framework, test framework, CI, linters
 * and architecture hints. Nothing here is fabricated or LLM-guessed.
 */
import type { RepoProfile } from "../types";
import { languageForPath, isLockFile, isManifest } from "./language";

const BINARY_EXT = new Set([
  "png","jpg","jpeg","gif","webp","ico","pdf","zip","gz","tar","tgz","mp3","mp4","woff","woff2","ttf","eot","wasm","jar","class","lock",
]);

export function discoverProfile(tree: Record<string, string>): RepoProfile {
  const paths = Object.keys(tree);
  const langBytes: Record<string, number> = {};
  let total = 0;
  for (const p of paths) {
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    if (BINARY_EXT.has(ext)) continue;
    const lang = languageForPath(p);
    if (lang === "plaintext") continue;
    const bytes = (tree[p] ?? "").length;
    langBytes[lang] = (langBytes[lang] ?? 0) + bytes;
    total += bytes;
  }
  const languages = Object.fromEntries(
    Object.entries(langBytes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([lang, bytes]) => [lang, Math.round((bytes / Math.max(1, total)) * 100)]),
  );

  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const read = (name: string) => tree[paths.find((p) => p.endsWith(name)) ?? ""];

  const profile: RepoProfile = {
    languages,
    linters: [],
    architectureHints: [],
    manifests: paths.filter(isManifest),
  };

  const pkg = read("package.json");
  if (pkg) {
    try {
      const json = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const deps = { ...json.dependencies, ...json.devDependencies };
      if (deps?.next) profile.framework = "Next.js";
      else if (deps?.express) profile.framework = "Express";
      else if (deps?.fastify) profile.framework = "Fastify";
      else if (deps?.["@nestjs/core"]) profile.framework = "NestJS";
      else if (deps?.react) profile.framework = "React";
      if (deps?.vitest) profile.testFramework = "Vitest";
      else if (deps?.jest) profile.testFramework = "Jest";
      else if (deps?.mocha) profile.testFramework = "Mocha";
      if (deps?.eslint) profile.linters.push("ESLint");
      if (deps?.prettier) profile.linters.push("Prettier");
      if (deps?.typescript) profile.linters.push("tsc");
      if (deps?.semgrep) profile.linters.push("Semgrep");
      if (json.scripts?.test) profile.architectureHints.push(`test script: ${json.scripts.test}`);
    } catch {
      /* malformed package.json is itself worth a later finding */
    }
    if (has(/pnpm-lock\.yaml/)) profile.packageManager = "pnpm";
    else if (has(/yarn\.lock/)) profile.packageManager = "yarn";
    else if (has(/package-lock\.json/)) profile.packageManager = "npm";
    else profile.packageManager = "npm";
  }

  if (has(/pyproject\.toml/)) {
    const py = paths.find((p) => p.endsWith("pyproject.toml"));
    const content = py ? tree[py] : "";
    if (!profile.framework && /fastapi/i.test(content)) profile.framework = "FastAPI";
    else if (!profile.framework && /django/i.test(content)) profile.framework = "Django";
    else if (!profile.framework && /flask/i.test(content)) profile.framework = "Flask";
    profile.packageManager ??= "pip";
    if (/pytest/i.test(content)) profile.testFramework = "pytest";
    if (/ruff/i.test(content)) profile.linters.push("ruff");
  }
  if (has(/go\.mod/)) {
    profile.packageManager ??= "go modules";
    profile.testFramework ??= "go test";
  }

  if (has(/\.github\/workflows\/.+\.ya?ml/)) profile.ci = "GitHub Actions";
  else if (has(/\.gitlab-ci\.yml/)) profile.ci = "GitLab CI";
  else if (has(/circleci\/config\.yml/)) profile.ci = "CircleCI";
  else if (has(/Jenkinsfile/)) profile.ci = "Jenkins";

  if (has(/dockerfile/i)) profile.architectureHints.push("containerized deployment");
  const dirs = new Set(paths.map((p) => p.split("/").slice(0, 2).join("/")));
  if (dirs.has("src/routes") || paths.some((p) => /route\.[tj]s$/.test(p))) profile.architectureHints.push("HTTP API layer");
  if (dirs.has("src/migrations") || has(/migrations?\//)) profile.architectureHints.push("versioned database migrations");
  if (has(/middleware/)) profile.architectureHints.push("explicit middleware chain");
  if (paths.some((p) => /(^|\/)__tests__|\.test\.|\.spec\./.test(p))) {
    profile.architectureHints.push("co-located test suites");
  }
  void isLockFile;
  return profile;
}

/** Cheap additive/deletion stats per file for diff-driven analysis. */
export function fileTreeSummary(tree: Record<string, string>): { files: number; dirs: number; chars: number } {
  const dirs = new Set<string>();
  let chars = 0;
  for (const [p, c] of Object.entries(tree)) {
    p.split("/").slice(0, -1).forEach((_, i, arr) => dirs.add(arr.slice(0, i + 1).join("/")));
    chars += c.length;
  }
  return { files: Object.keys(tree).length, dirs: dirs.size, chars };
}
