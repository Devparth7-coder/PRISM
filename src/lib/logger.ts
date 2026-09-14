/**
 * Structured JSON logging with correlation IDs and secret redaction.
 * Emits one JSON object per line so logs are aggregator-friendly.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const correlationStore = new AsyncLocalStorage<Map<string, string>>();

const SECRET_KEYS = /(token|secret|password|privatekey|authorization|api[-_]?key)/i;

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") {
    // Redact bearer tokens / PEM bodies even if they appear in a plain string.
    if (/^gh[ps]_[A-Za-z0-9_]{10,}/.test(value)) return "***redacted***" as T;
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "***redacted-private-key***" as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k) && typeof v === "string" && v.length > 0) {
        out[k] = "***redacted***";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[(config.logLevel as Level) || "info"]) return;
  const store = correlationStore.getStore();
  const corr: Record<string, string> = {};
  if (store) for (const [k, v] of store.entries()) corr[k] = v;
  const line = JSON.stringify(
    redact({ ts: new Date().toISOString(), level, msg, ...corr, ...(meta ?? {}) }),
  );
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

export function withCorrelation<T>(fields: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const parent = correlationStore.getStore();
  const merged = new Map(parent ?? []);
  for (const [k, v] of Object.entries(fields)) merged.set(k, v);
  return correlationStore.run(merged, fn);
}

export function correlationId(): string | undefined {
  return correlationStore.getStore()?.get("correlation_id");
}

export function newCorrelationId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
