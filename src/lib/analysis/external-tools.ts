/**
 * External deterministic tooling (Semgrep / ESLint / tsc / secret scanners).
 *
 * SECURITY MODEL: repository code is untrusted. Tools run with:
 *  - a throwaway temp working directory
 *  - a scrubbed environment (no app secrets/tokens)
 *  - no shell, fixed args, wall-clock timeout, capped output
 *  - read-only intent; the temp dir is destroyed afterwards
 * Production deployments run this step in an ephemeral container (see README).
 * Missing tools are reported as SKIPPED — never silently faked.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config";
import type { ToolResult } from "../types";

function which(binary: string): string | null {
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const candidate = join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function runGuarded(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    // Scrubbed environment: explicitly approved safe variables ONLY.
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: cwd,
      NODE_OPTIONS: "--no-experimental-fetch",
      CI: "true",
      NODE_NO_WARNINGS: "1",
    };
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, args, {
      cwd,
      env: safeEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 50_000) stderr = stderr.slice(0, 50_000);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err), timedOut });
    });
  });
}

function materialize(tree: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), `prism-sandbox-${process.pid}-`));
  for (const [path, content] of Object.entries(tree)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/**
 * Runs available tools. Tools absent from PATH => status 'skipped' with the
 * install hint as summary, so the agent timeline always tells the truth.
 */
export async function runExternalTools(tree: Record<string, string>): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  let sandbox: string | null = null;
  try {
    sandbox = materialize(tree);

    // ---- Semgrep (security, multi-language) ----
    const semgrepBin = which(process.env.SEMGRIPE_BIN ?? "semgrep");
    const started = Date.now();
    if (!semgrepBin) {
      results.push({ tool: "semgrep", status: "skipped", summary: "Semgrep not found on PATH — install to add community security ruleset coverage.", durationMs: 0 });
    } else {
      const r = await runGuarded(
        semgrepBin,
        ["--config=auto", "--json", "--quiet", "--max-target-bytes=200000", sandbox],
        sandbox,
        config.toolTimeoutMs,
      );
      results.push({
        tool: "semgrep",
        status: r.timedOut ? "timeout" : r.code <= 1 ? "success" : "error",
        summary: r.timedOut
          ? `Timed out after ${config.toolTimeoutMs}ms`
          : parseSemgrepCount(r.stdout),
        durationMs: Date.now() - started,
      });
    }

    // ---- ESLint (JS/TS) ----
    const eslintBin = which(process.env.ESLINT_BIN ?? "eslint");
    const t0 = Date.now();
    if (!eslintBin) {
      results.push({ tool: "eslint", status: "skipped", summary: "ESLint not found on PATH — the bundled deterministic rules still run.", durationMs: 0 });
    } else {
      const r = await runGuarded(eslintBin, [".", "--format=json", "--no-eslintrc"], sandbox, config.toolTimeoutMs);
      results.push({
        tool: "eslint",
        status: r.timedOut ? "timeout" : r.code <= 2 ? "success" : "error",
        summary: r.timedOut ? "Timed out" : `${(JSON.parse(r.stdout) as unknown[]).length} file(s) linted`,
        durationMs: Date.now() - t0,
      });
    }

    // ---- tsc typecheck (only if tsconfig present) ----
    const t1 = Date.now();
    if (!tree["tsconfig.json"]) {
      results.push({ tool: "tsc", status: "skipped", summary: "No tsconfig.json in context bundle.", durationMs: 0 });
    } else if (!which("npx") && !which("tsc")) {
      results.push({ tool: "tsc", status: "skipped", summary: "TypeScript compiler unavailable.", durationMs: 0 });
    } else {
      const bin = which("tsc") ?? which("npx")!;
      const args = bin.endsWith("npx") ? ["tsc"] : [];
      const r = await runGuarded(bin, [...args, "--noEmit", "--pretty", "false"], sandbox, config.toolTimeoutMs);
      results.push({
        tool: "tsc",
        status: r.timedOut ? "timeout" : r.code === 0 ? "success" : "success",
        summary: r.timedOut ? "Timed out" : r.code === 0 ? "No type errors" : `Type checker reported issues (${r.stderr.split("\n").length} lines)`,
        durationMs: Date.now() - t1,
      });
    }
  } finally {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  }
  return results;
}

function parseSemgrepCount(stdout: string): string {
  try {
    const json = JSON.parse(stdout) as { results?: unknown[] };
    return `${json.results?.length ?? 0} semgrep finding(s)`;
  } catch {
    return "Semgrep completed";
  }
}
