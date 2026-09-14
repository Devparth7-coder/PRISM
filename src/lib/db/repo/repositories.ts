import { db, id } from "../client";
import type { ChangedFile, RepoProfile } from "../../types";

export interface InstallationRow {
  id: string;
  github_id: number | null;
  org_id: string | null;
  app_id: number | null;
  account_login: string | null;
  status: string;
  permissions_json: string | null;
}

export interface RepositoryRow {
  id: string;
  installation_id: string | null;
  org_id: string | null;
  github_id: number | null;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  language: string | null;
  profile_json: string | null;
  is_demo: number;
  connected_at: string;
}

export interface PullRequestRow {
  id: string;
  repository_id: string;
  number: number;
  title: string;
  body: string | null;
  author: string;
  base_ref: string;
  head_ref: string;
  base_sha: string;
  head_sha: string;
  additions: number;
  deletions: number;
  changed_files: number;
  state: string;
  demo_kind: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertInstallation(input: {
  githubInstallationId: number;
  orgId: string | null;
  appId?: number;
  accountLogin: string;
  permissions?: unknown;
}): InstallationRow {
  const existing = db()
    .prepare("SELECT * FROM installations WHERE github_id = ?")
    .get(input.githubInstallationId) as InstallationRow | undefined;
  if (existing) {
    db()
      .prepare("UPDATE installations SET status='active', org_id=COALESCE(?, org_id), permissions_json=? WHERE id=?")
      .run(input.orgId, JSON.stringify(input.permissions ?? {}), existing.id);
    return db().prepare("SELECT * FROM installations WHERE id=?").get(existing.id) as InstallationRow;
  }
  const iid = id("ins");
  db()
    .prepare(
      `INSERT INTO installations (id, github_id, org_id, app_id, account_login, status, permissions_json)
       VALUES (?,?,?,?,?, 'active', ?)`,
    )
    .run(iid, input.githubInstallationId, input.orgId, input.appId ?? null, input.accountLogin, JSON.stringify(input.permissions ?? {}));
  return db().prepare("SELECT * FROM installations WHERE id=?").get(iid) as InstallationRow;
}

export function demoInstallation(orgId: string): InstallationRow {
  const existing = db().prepare("SELECT * FROM installations WHERE account_login='demo' AND org_id=?").get(orgId) as
    | InstallationRow
    | undefined;
  if (existing) return existing;
  const iid = id("ins");
  db()
    .prepare("INSERT INTO installations (id, org_id, account_login, status) VALUES (?,?, 'demo', 'demo')")
    .run(iid, orgId);
  return db().prepare("SELECT * FROM installations WHERE id=?").get(iid) as InstallationRow;
}

export function upsertRepository(input: {
  installationId: string | null;
  orgId: string | null;
  githubId?: number;
  owner: string;
  name: string;
  defaultBranch?: string;
  language?: string;
  profile?: RepoProfile;
  isDemo?: boolean;
}): RepositoryRow {
  const full = `${input.owner}/${input.name}`;
  const existing = db().prepare("SELECT * FROM repositories WHERE owner=? AND name=?").get(input.owner, input.name) as
    | RepositoryRow
    | undefined;
  if (existing) {
    db()
      .prepare(
        `UPDATE repositories SET installation_id=COALESCE(?, installation_id), org_id=COALESCE(?, org_id),
         default_branch=COALESCE(?, default_branch), language=COALESCE(?, language), profile_json=COALESCE(?, profile_json)
         WHERE id=?`,
      )
      .run(
        input.installationId,
        input.orgId,
        input.defaultBranch ?? null,
        input.language ?? null,
        input.profile ? JSON.stringify(input.profile) : null,
        existing.id,
      );
    return db().prepare("SELECT * FROM repositories WHERE id=?").get(existing.id) as RepositoryRow;
  }
  const rid = id("rep");
  db()
    .prepare(
      `INSERT INTO repositories (id, installation_id, org_id, github_id, owner, name, full_name, default_branch, language, profile_json, is_demo)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      rid,
      input.installationId,
      input.orgId,
      input.githubId ?? null,
      input.owner,
      input.name,
      full,
      input.defaultBranch ?? "main",
      input.language ?? null,
      input.profile ? JSON.stringify(input.profile) : null,
      input.isDemo ? 1 : 0,
    );
  return db().prepare("SELECT * FROM repositories WHERE id=?").get(rid) as RepositoryRow;
}

export function setRepositoryProfile(repoId: string, profile: RepoProfile): void {
  db().prepare("UPDATE repositories SET profile_json=?, language=? WHERE id=?").run(
    JSON.stringify(profile),
    Object.keys(profile.languages)[0] ?? null,
    repoId,
  );
}

export function listRepositoriesForUser(userId: string): RepositoryRow[] {
  return db()
    .prepare(
      `SELECT r.* FROM repositories r
       JOIN org_members m ON m.org_id = r.org_id WHERE m.user_id = ?
       ORDER BY r.connected_at DESC`,
    )
    .all(userId) as RepositoryRow[];
}

export function getRepositoryById(repoId: string): RepositoryRow | undefined {
  return db().prepare("SELECT * FROM repositories WHERE id=?").get(repoId) as RepositoryRow | undefined;
}

export function getRepositoryByFullName(fullName: string): RepositoryRow | undefined {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return undefined;
  return db().prepare("SELECT * FROM repositories WHERE owner=? AND name=?").get(owner, name) as
    | RepositoryRow
    | undefined;
}

export function assertRepoAccess(userId: string, repoId: string): RepositoryRow {
  const repo = getRepositoryById(repoId);
  if (!repo) throw Object.assign(new Error("Repository not found"), { status: 404 });
  const member = db()
    .prepare("SELECT 1 FROM org_members WHERE org_id=? AND user_id=?")
    .get(repo.org_id, userId);
  if (!member) throw Object.assign(new Error("Not authorized for this repository"), { status: 403 });
  return repo;
}

export function storeBlobs(repoId: string, sha: string, files: Record<string, string>): void {
  const stmt = db().prepare(
    `INSERT OR IGNORE INTO file_blobs (id, repository_id, sha, path, content, truncated) VALUES (?,?,?,?,?,?)`,
  );
  for (const [path, content] of Object.entries(files)) {
    const truncated = content.length > 200_000 ? 1 : 0;
    stmt.run(id("blb"), repoId, sha, path, truncated ? content.slice(0, 200_000) : content, truncated);
  }
}

export function getBlobs(repoId: string, sha: string): Record<string, string> {
  const rows = db()
    .prepare("SELECT path, content FROM file_blobs WHERE repository_id=? AND sha=?")
    .all(repoId, sha) as { path: string; content: string }[];
  return Object.fromEntries(rows.map((r) => [r.path, r.content]));
}

export function getBlob(repoId: string, sha: string, path: string): string | undefined {
  const row = db()
    .prepare("SELECT content FROM file_blobs WHERE repository_id=? AND sha=? AND path=?")
    .get(repoId, sha, path) as { content: string } | undefined;
  return row?.content;
}

export interface SnapshotBundle {
  snapshotId: string;
  pr: PullRequestRow;
  changedFiles: (ChangedFile & { id?: string })[];
}

/**
 * Idempotently ingest a PR at a specific commit. A new head SHA creates a new
 * immutable snapshot and marks existing reviews STALE — reviews are always
 * pinned to a commit, never "whatever the branch looks like now".
 */
export function ingestPullRequest(input: {
  repositoryId: string;
  number: number;
  title: string;
  body?: string;
  author: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  state?: string;
  demoKind?: string;
  changedFiles: ChangedFile[];
  demoFlag?: boolean;
}): SnapshotBundle {
  const additions = input.changedFiles.reduce((s, f) => s + f.additions, 0);
  const deletions = input.changedFiles.reduce((s, f) => s + f.deletions, 0);

  const existing = db()
    .prepare("SELECT * FROM pull_requests WHERE repository_id=? AND number=?")
    .get(input.repositoryId, input.number) as PullRequestRow | undefined;

  let prId: string;
  let newSnapshot = false;
  if (existing) {
    prId = existing.id;
    db()
      .prepare(
        `UPDATE pull_requests SET title=?, body=?, author=?, base_ref=?, head_ref=?, base_sha=?, head_sha=?,
         additions=?, deletions=?, changed_files=?, state=COALESCE(?, state), updated_at=datetime('now') WHERE id=?`,
      )
      .run(
        input.title,
        input.body ?? "",
        input.author,
        input.baseRef,
        input.headRef,
        input.baseSha,
        input.headSha,
        additions,
        deletions,
        input.changedFiles.length,
        input.state ?? null,
        prId,
      );
    if (existing.head_sha !== input.headSha) newSnapshot = true;
  } else {
    prId = id("pr");
    db()
    .prepare(
      `INSERT INTO pull_requests (id, repository_id, number, title, body, author, base_ref, head_ref, base_sha, head_sha,
        additions, deletions, changed_files, state, demo_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      prId,
      input.repositoryId,
      input.number,
      input.title,
      input.body ?? "",
      input.author,
      input.baseRef,
      input.headRef,
      input.baseSha,
      input.headSha,
      additions,
      deletions,
      input.changedFiles.length,
      input.state ?? "open",
      input.demoKind ?? null,
    );
  }

  // Mark previous reviews stale when the commit moved. Status itself is
  // preserved (COMPLETED stays COMPLETED for audit and regression diffs);
  // staleness is expressed solely through is_stale so the previous completed
  // review remains discoverable for NEW/PERSISTENT/FIXED fingerprinting.
  if (existing && existing.head_sha !== input.headSha) {
    db()
      .prepare("UPDATE reviews SET is_stale=1 WHERE pr_id=?")
      .run(prId);
  }

  let snapshotRow = db()
    .prepare("SELECT * FROM pr_snapshots WHERE pr_id=? AND head_sha=?")
    .get(prId, input.headSha) as { id: string } | undefined;
  if (!snapshotRow) {
    newSnapshot = true;
    const snapshotId = id("snp");
    db()
      .prepare("INSERT INTO pr_snapshots (id, pr_id, base_sha, head_sha, additions, deletions) VALUES (?,?,?,?,?,?)")
      .run(snapshotId, prId, input.baseSha, input.headSha, additions, deletions);
    const cfStmt = db().prepare(
      `INSERT INTO changed_files (id, snapshot_id, path, status, additions, deletions, patch_json, language)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const f of input.changedFiles) {
      cfStmt.run(
        id("chf"),
        snapshotId,
        f.path,
        f.status,
        f.additions,
        f.deletions,
        JSON.stringify(f.hunks),
        f.language,
      );
    }
    snapshotRow = { id: snapshotId };
  }

  const pr = db().prepare("SELECT * FROM pull_requests WHERE id=?").get(prId) as PullRequestRow;
  void newSnapshot;
  return { snapshotId: snapshotRow.id, pr, changedFiles: input.changedFiles };
}

export function listPullRequests(repoId: string): PullRequestRow[] {
  return db()
    .prepare("SELECT * FROM pull_requests WHERE repository_id=? ORDER BY updated_at DESC, number DESC")
    .all(repoId) as PullRequestRow[];
}

export function getPullRequest(prId: string): PullRequestRow | undefined {
  return db().prepare("SELECT * FROM pull_requests WHERE id=?").get(prId) as PullRequestRow | undefined;
}

export function getLatestSnapshot(prId: string, headSha: string): { id: string } | undefined {
  return db().prepare("SELECT id FROM pr_snapshots WHERE pr_id=? AND head_sha=? ORDER BY created_at DESC LIMIT 1").get(prId, headSha) as
    | { id: string }
    | undefined;
}

export function getChangedFiles(snapshotId: string): (ChangedFile & { id: string })[] {
  const rows = db()
    .prepare("SELECT * FROM changed_files WHERE snapshot_id=? ORDER BY path")
    .all(snapshotId) as {
    id: string;
    path: string;
    status: string;
    additions: number;
    deletions: number;
    patch_json: string;
    language: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    status: r.status as ChangedFile["status"],
    additions: r.additions,
    deletions: r.deletions,
    hunks: JSON.parse(r.patch_json) as ChangedFile["hunks"],
    language: r.language ?? "plaintext",
  }));
}
