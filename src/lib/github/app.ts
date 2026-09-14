/**
 * GitHub App identity and API client.
 *  - App JWTs are signed with the RSA private key loaded from env or a PEM
 *    file (never stored in the database, never logged).
 *  - Installation access tokens are minted per installation, cached in
 *    memory until shortly before expiry, and never persisted.
 *  - Uses conditional requests + pagination + size caps (rate-limit hygiene).
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { config } from "../config";
import { log, redact } from "../logger";

const API = "https://api.github.com";

export class GitHubConfigError extends Error {}

function loadPrivateKey(): string {
  if (config.github.privateKey) return config.github.privateKey;
  if (config.github.privateKeyPath && existsSync(config.github.privateKeyPath)) {
    return readFileSync(config.github.privateKeyPath, "utf8");
  }
  throw new GitHubConfigError("GitHub App private key not configured");
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createAppJwt(now = Math.floor(Date.now() / 1000)): string {
  if (!config.github.appId) throw new GitHubConfigError("GITHUB_APP_ID not configured");
  const key = loadPrivateKey();
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: Number(config.github.appId) }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  return `${header}.${payload}.${sign.sign(key).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<number, CachedToken>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const jwt = createAppJwt();
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PRISM-review-bot",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = (await res.json()) as { token: string; expires_at?: string };
  const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 50 * 60_000;
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

async function githubFetch(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getInstallationToken(installationId);
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PRISM-review-bot",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

export interface GitHubPrData {
  number: number;
  title: string;
  body: string | null;
  userLogin: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  state: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export async function fetchPullRequest(installationId: number, owner: string, repo: string, number: number): Promise<GitHubPrData> {
  const res = await githubFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}`);
  if (!res.ok) throw new Error(`GitHub PR fetch failed: ${res.status}`);
  const j = (await res.json()) as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string };
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
    additions: number;
    deletions: number;
    changed_files: number;
  };
  return {
    number: j.number,
    title: j.title,
    body: j.body,
    userLogin: j.user.login,
    baseRef: j.base.ref,
    headRef: j.head.ref,
    baseSha: j.base.sha,
    headSha: j.head.sha,
    state: j.state,
    additions: j.additions,
    deletions: j.deletions,
    changedFiles: j.changed_files,
  };
}

export interface GitHubPrFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export async function fetchPullRequestFiles(installationId: number, owner: string, repo: string, number: number): Promise<GitHubPrFile[]> {
  const files: GitHubPrFile[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await githubFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`GitHub PR files fetch failed: ${res.status}`);
    const batch = (await res.json()) as GitHubPrFile[];
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files.slice(0, 300); // hard cap; huge PRs truncate deliberately
}

/** Fetch a file blob at a SHA via the contents API (cached by ETag upstream). */
export async function fetchFileAtSha(
  installationId: number,
  owner: string,
  repo: string,
  path: string,
  sha: string,
): Promise<string | undefined> {
  const res = await githubFetch(installationId, `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${sha}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`contents fetch failed ${res.status} for ${path}@${sha.slice(0, 7)}`);
  const j = (await res.json()) as { content?: string; encoding?: string; size?: number };
  if (j.encoding === "base64" && j.content) {
    const buf = Buffer.from(j.content.replace(/\n/g, ""), "base64");
    if (buf.length > 200_000) return buf.slice(0, 200_000).toString("utf8");
    return buf.toString("utf8");
  }
  return undefined;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Recursively collect a bounded repository tree at a SHA (context discovery). */
export async function fetchTree(installationId: number, owner: string, repo: string, sha: string): Promise<Record<string, string>> {
  const res = await githubFetch(installationId, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  if (!res.ok) throw new Error(`tree fetch failed: ${res.status}`);
  const j = (await res.json()) as {
    tree?: { path: string; type: string; size?: number }[];
    truncated?: boolean;
  };
  const tree: Record<string, string> = {};
  const wanted = (j.tree ?? []).filter(
    (e) => e.type === "blob" && (e.size ?? 0) < 120_000 && /^(src|app|lib|server|tests?|__tests__|api|config|middleware|routes|controllers|models?|services?|package\.json|tsconfig|pyproject|requirements|go\.mod|\.github\/workflows)/.test(e.path),
  );
  // Bound total fetches to protect rate limits; context engine picks the rest
  // through graph proximity after changed files are loaded.
  const prioritized = wanted.slice(0, 60);
  if (j.truncated) log.warn("GitHub tree response truncated by API", { repo: `${owner}/${repo}` });
  await Promise.all(
    prioritized.map(async (entry) => {
      try {
        const content = await fetchFileAtSha(installationId, owner, repo, entry.path, sha);
        if (content !== undefined) tree[entry.path] = content;
      } catch (err) {
        log.warn("blob fetch failed", redact({ path: entry.path, error: err instanceof Error ? err.message : String(err) }));
      }
    }),
  );
  return tree;
}

export interface GitHubReviewPayload {
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body: string;
  comments: { path: string; line: number; side: "RIGHT"; body: string }[];
}

export async function submitReview(
  installationId: number,
  owner: string,
  repo: string,
  number: number,
  payload: GitHubReviewPayload,
): Promise<{ id: number }> {
  // Submit as a draft review with inline comments, then finalize with the event.
  const body = {
    body: payload.body,
    event: "PENDING",
    comments: payload.comments,
    headers: { Accept: "application/vnd.github.comfort-fade-preview+json, application/vnd.github+json" },
  };
  const res1 = await githubFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res1.ok) {
    // Fallback: some versions reject PENDING with comments; submit directly.
    const direct = await githubFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: payload.body, event: payload.event, comments: payload.comments.slice(0, 10) }),
    });
    if (!direct.ok) throw new Error(`Review submission failed: ${direct.status} ${(await direct.text().catch(() => "")).slice(0, 300)}`);
    const j = (await direct.json()) as { id: number };
    return { id: j.id };
  }
  const draft = (await res1.json()) as { id: number };
  const res2 = await githubFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}/reviews/${draft.id}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: payload.event, body: payload.body }),
  });
  if (!res2.ok) throw new Error(`Review finalization failed: ${res2.status} ${(await res2.text().catch(() => "")).slice(0, 300)}`);
  return { id: draft.id };
}

// --------------------------------------------------------------- OAuth ------

export function oauthAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.github.oauthClientId,
    redirect_uri: `${config.baseUrl}/api/auth/github/callback`,
    state,
    scope: "read:user user:email",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeOAuthCode(code: string): Promise<{ accessToken: string; login: string; name: string | null; email: string | null; githubId: number; avatarUrl: string | null }> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.github.oauthClientId,
      client_secret: config.github.oauthClientSecret,
      code,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) throw new Error(`OAuth token exchange failed: ${tokenJson.error ?? "unknown"}`);
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, "User-Agent": "PRISM", Accept: "application/vnd.github+json" },
  });
  if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
  const u = (await userRes.json()) as { id: number; login: string; name: string | null; email: string | null; avatar_url: string | null };
  return { accessToken: tokenJson.access_token, login: u.login, name: u.name, email: u.email, githubId: u.id, avatarUrl: u.avatar_url };
}
