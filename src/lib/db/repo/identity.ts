import { randomBytes } from "node:crypto";
import { db, id } from "../client";

export interface UserRow {
  id: string;
  github_id: number | null;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_demo: number;
  created_at: string;
}

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  isDemo: boolean;
}

export function upsertUser(input: {
  githubId?: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  isDemo?: boolean;
}): UserRow {
  const existing = db()
    .prepare("SELECT * FROM users WHERE github_id = ? OR login = ?")
    .get(input.githubId ?? null, input.login) as UserRow | undefined;
  if (existing) {
    db()
      .prepare("UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), avatar_url = COALESCE(?, avatar_url) WHERE id = ?")
      .run(input.name ?? null, input.email ?? null, input.avatarUrl ?? null, existing.id);
    return db().prepare("SELECT * FROM users WHERE id = ?").get(existing.id) as UserRow;
  }
  const userId = id("usr");
  db()
    .prepare("INSERT INTO users (id, github_id, login, name, email, avatar_url, is_demo) VALUES (?,?,?,?,?,?,?)")
    .run(userId, input.githubId ?? null, input.login, input.name ?? null, input.email ?? null, input.avatarUrl ?? null, input.isDemo ? 1 : 0);
  return db().prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
}

export function getUser(userId: string): UserRow | undefined {
  return db().prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
}

export function createSession(userId: string, ttlDays = 30): string {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  db().prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)").run(token, userId, expires);
  return token;
}

export function getSessionUser(token?: string): SessionUser | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.login, u.name, u.is_demo as isDemo
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as SessionUser | undefined;
  return row ?? null;
}

export function destroySession(token: string): void {
  db().prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

export interface OrgRow {
  id: string;
  github_id: number | null;
  login: string;
  name: string | null;
  is_demo: number;
}

export function upsertOrg(input: { githubId?: number; login: string; name?: string; isDemo?: boolean }): OrgRow {
  const existing = db()
    .prepare("SELECT * FROM organizations WHERE github_id = ? OR login = ?")
    .get(input.githubId ?? null, input.login) as OrgRow | undefined;
  if (existing) return existing;
  const orgId = id("org");
  db()
    .prepare("INSERT INTO organizations (id, github_id, login, name, is_demo) VALUES (?,?,?,?,?)")
    .run(orgId, input.githubId ?? null, input.login, input.name ?? input.login, input.isDemo ? 1 : 0);
  return db().prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as OrgRow;
}

export function addOrgMember(orgId: string, userId: string, role = "admin"): void {
  db().prepare("INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?,?,?)").run(orgId, userId, role);
}

/** Tenant-scoped: returns repository ids the user may access through org membership. */
export function authorizedRepoIds(userId: string): Set<string> {
  const rows = db()
    .prepare(
      `SELECT r.id FROM repositories r
       JOIN org_members m ON m.org_id = r.org_id
       WHERE m.user_id = ?`,
    )
    .all(userId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
