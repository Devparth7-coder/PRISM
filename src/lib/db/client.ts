/**
 * SQLite data access. A single better-sqlite3 connection (synchronous,
 * file-backed, WAL). The DAL lives behind typed functions in ./repo so a
 * PostgreSQL swap touches only this layer. Schema is applied on first open —
 * safe & idempotent (IF NOT EXISTS), so `npm run dev` needs no manual step.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Database as DB } from "better-sqlite3";
import { config } from "../config";
import { log } from "../logger";

declare global {
  // eslint-disable-next-line no-var
  var __prismDb: DB | undefined;
}

function openDb(): DB {
  const path = resolve(process.cwd(), config.databasePath);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const schema = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  db.exec(schema);
  log.info("database ready", { path: config.databasePath });
  return db;
}

export function db(): DB {
  if (!globalThis.__prismDb) globalThis.__prismDb = openDb();
  return globalThis.__prismDb;
}

/** Test/CLI entrypoint: open an arbitrary path without server-only guard. */
export function openDbAt(path: string): DB {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const instance = new Database(path);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  const schema = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  instance.exec(schema);
  return instance;
}

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
