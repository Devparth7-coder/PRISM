/**
 * Live-GitHub side of ingestion: installation discovery (org + repositories)
 * and PR ingestion jobs. All network calls happen in the worker, never in the
 * webhook request. Repository credentials are the installation's token,
 * minted and cached by the GitHub App layer.
 */
import {
  fetchPullRequest,
  getInstallationToken,
} from "../github/app";
import {
  upsertInstallation,
  upsertRepository,
  getRepositoryByFullName,
} from "../db/repo/repositories";
import { upsertOrg } from "../db/repo/identity";
import { ingestFromGitHub } from "./ingest";
import type { InstallationRow } from "../db/repo/repositories";
import { log } from "../logger";

const API = "https://api.github.com";

async function ghGet(token: string, path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PRISM-review-bot",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  return res.json();
}

/** Mirror an installation and its repositories into PRISM tenancy. */
export async function discoverInstallation(input: {
  installationId: number;
  action?: string;
  payload: {
    installation?: { app_id?: number; account?: { login?: string; type?: string }; permissions?: unknown };
    repositories_added?: { full_name: string; default_branch?: string; language?: string }[];
    repositories?: { full_name: string; default_branch?: string; language?: string }[];
  };
}): Promise<void> {
  const token = await getInstallationToken(input.installationId);

  const account =
    input.payload.installation?.account?.login ??
    ((await ghGet(token, `/app/installations/${input.installationId}`)) as { account?: { login?: string } }).account?.login;
  if (!account) throw new Error("installation has no account login");

  const org = upsertOrg({ login: account, name: account });
  const installation = upsertInstallation({
    githubInstallationId: input.installationId,
    orgId: org.id,
    appId: input.payload.installation?.app_id,
    accountLogin: account,
    permissions: input.payload.installation?.permissions ?? {},
  });

  // Repositories explicitly attached to the event, else enumerate them.
  const listed = [
    ...(input.payload.repositories_added ?? []),
    ...(input.payload.repositories ?? []),
  ];
  let repos = listed;
  if (repos.length === 0) {
    for (let page = 1; page <= 5; page++) {
      const data = (await ghGet(token, `/installation/repositories?per_page=100&page=${page}`)) as {
        repositories: { full_name: string; default_branch?: string; language?: string }[];
      };
      repos.push(...data.repositories);
      if (data.repositories.length < 100) break;
    }
  }
  for (const r of repos) {
    const [owner, name] = r.full_name.split("/");
    if (!owner || !name) continue;
    upsertRepository({
      installationId: installation.id,
      orgId: org.id,
      owner,
      name,
      defaultBranch: r.default_branch ?? "main",
      language: r.language ?? undefined,
    });
  }
  // The installing org gets an admin membership derived from the event.
  // (User-level membership syncs via OAuth login.)
  log.info("installation discovered", { installationId: input.installationId, repos: repos.length });
}

export async function ingestLivePullRequest(input: {
  installationId: number;
  owner: string;
  repo: string;
  number: number;
  mode?: string;
}): Promise<{ prId: string; snapshotId: string }> {
  let repository = getRepositoryByFullName(`${input.owner}/${input.repo}`);
  if (!repository) {
    // Repository selection may predate an installation event; mirror now.
    const token = await getInstallationToken(input.installationId);
    const meta = (await ghGet(token, `/repos/${input.owner}/${input.repo}`)) as {
      id: number;
      default_branch: string;
      language: string | null;
      owner: { login: string };
    };
    let installation: InstallationRow | undefined;
    const existing = await fetchPullRequest(input.installationId, input.owner, input.repo, input.number).catch(() => null);
    void existing;
    const account = meta.owner.login;
    const org = upsertOrg({ login: account, name: account });
    installation = upsertInstallation({
      githubInstallationId: input.installationId,
      orgId: org.id,
      accountLogin: account,
    });
    repository = upsertRepository({
      installationId: installation.id,
      orgId: org.id,
      owner: input.owner,
      name: input.repo,
      defaultBranch: meta.default_branch,
      language: meta.language ?? undefined,
    });
  }
  return ingestFromGitHub({
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
    number: input.number,
    repository,
    mode: input.mode,
  });
}
