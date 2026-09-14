/**
 * Ingestion service: turns either a live GitHub PR or a bundled fixture into an
 * immutable PR snapshot pinned to a head SHA. Both base and head file trees are
 * captured, diffs are computed locally, and a review job is enqueued (the
 * webhook request itself does no analysis work).
 */
import {
  ingestPullRequest,
  storeBlobs,
  type RepositoryRow,
} from "../db/repo/repositories";
import { diffFiles } from "../code/diff";
import { languageForPath } from "../code/language";
import { discoverProfile } from "../code/profile";
import { enqueueJob } from "../db/repo/jobs";
import { setRepositoryProfile } from "../db/repo/repositories";
import {
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchTree,
  fetchFileAtSha,
  type GitHubPrFile,
} from "../github/app";
import { parseUnifiedPatch } from "../code/diff";
import { log } from "../logger";

export interface TreeIngestInput {
  repository: RepositoryRow;
  number: number;
  title: string;
  body?: string;
  author: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  baseTree: Record<string, string>;
  headTree: Record<string, string>;
  demoKind?: string;
  isDemo?: boolean;
  enqueue?: boolean;
  mode?: string;
}

function diffTrees(base: Record<string, string>, head: Record<string, string>) {
  const paths = new Set([...Object.keys(base), ...Object.keys(head)]);
  const changed = [];
  for (const path of paths) {
    const d = diffFiles(path, base[path], head[path]);
    if (d) changed.push(d);
  }
  return changed.sort((a, b) => a.path.localeCompare(b.path));
}

export function ingestFromTrees(input: TreeIngestInput): { prId: string; snapshotId: string } {
  storeBlobs(input.repository.id, input.baseSha, input.baseTree);
  storeBlobs(input.repository.id, input.headSha, input.headTree);

  const profile = discoverProfile(input.headTree);
  setRepositoryProfile(input.repository.id, profile);

  const changedFiles = diffTrees(input.baseTree, input.headTree);
  const { pr, snapshotId } = ingestPullRequest({
    repositoryId: input.repository.id,
    number: input.number,
    title: input.title,
    body: input.body,
    author: input.author,
    baseRef: input.baseRef,
    headRef: input.headRef,
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedFiles,
    state: "open",
    demoKind: input.demoKind,
    demoFlag: input.isDemo,
  });

  if (input.enqueue !== false) {
    enqueueJob(
      "review-pr",
      { prId: pr.id, snapshotId, headSha: input.headSha, mode: input.mode ?? "standard" },
      { dedupeKey: `review:${pr.id}:${input.headSha}` },
    );
  }
  log.info("PR ingested from trees", { pr: input.number, files: changedFiles.length, head: input.headSha.slice(0, 7) });
  return { prId: pr.id, snapshotId };
}

/** Live GitHub path: API → trees → diffs → snapshot → job. */
export async function ingestFromGitHub(input: {
  installationId: number;
  owner: string;
  repo: string;
  number: number;
  repository: RepositoryRow;
  mode?: string;
}): Promise<{ prId: string; snapshotId: string }> {
  const [pr, files] = await Promise.all([
    fetchPullRequest(input.installationId, input.owner, input.repo, input.number),
    fetchPullRequestFiles(input.installationId, input.owner, input.repo, input.number),
  ]);

  // Head tree (bounded) + base versions of changed files for true diffs.
  const headTree = await fetchTree(input.installationId, input.owner, input.repo, pr.headSha);
  for (const f of files) {
    if (!(f.filename in headTree) && f.status !== "removed") {
      const content = await fetchFileAtSha(input.installationId, input.owner, input.repo, f.filename, pr.headSha);
      if (content !== undefined) headTree[f.filename] = content;
    }
  }
  const baseTree: Record<string, string> = {};
  for (const f of files) {
    if (f.status === "added") continue;
    const content = await fetchFileAtSha(input.installationId, input.owner, input.repo, f.filename, pr.baseSha);
    if (content !== undefined) baseTree[f.filename] = content;
  }

  // Compute changed files locally from the two trees; fall back to API patches.
  const changedFiles = diffTrees(baseTree, headTree);
  const knownPaths = new Set(changedFiles.map((c) => c.path));
  for (const f of files as GitHubPrFile[]) {
    if (knownPaths.has(f.filename)) continue;
    if (f.patch) changedFiles.push({ ...parseUnifiedPatch(f.filename, f.patch), status: f.status, language: languageForPath(f.filename) });
  }

  storeBlobs(input.repository.id, pr.baseSha, baseTree);
  storeBlobs(input.repository.id, pr.headSha, headTree);

  const profile = discoverProfile(headTree);
  setRepositoryProfile(input.repository.id, profile);

  const { pr: prRow, snapshotId } = ingestPullRequest({
    repositoryId: input.repository.id,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.userLogin,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    changedFiles:
      changedFiles.length > 0
        ? changedFiles
        : files.map((f) => ({
            path: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            hunks: [],
            language: languageForPath(f.filename),
          })),
    state: pr.state,
  });

  enqueueJob(
    "review-pr",
    { prId: prRow.id, snapshotId, headSha: pr.headSha, mode: input.mode ?? "standard" },
    { dedupeKey: `review:${prRow.id}:${pr.headSha}` },
  );
  log.info("PR ingested from GitHub", { repo: `${input.owner}/${input.repo}`, number: input.number });
  return { prId: prRow.id, snapshotId };
}
