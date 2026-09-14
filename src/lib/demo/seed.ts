/**
 * Deterministic DEMO MODE bootstrap. Builds the flagship demonstration
 * repository + PR #184 from the bundled fixtures (real files containing
 * deliberately seeded issues), then runs the SAME ingestion pipeline as a
 * live webhook. Findings are never hardcoded — they are produced by running
 * the real analyzers/orchestrator over the fixture code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  addOrgMember,
  upsertOrg,
  upsertUser,
} from "../db/repo/identity";
import {
  demoInstallation,
  getRepositoryByFullName,
  upsertRepository,
} from "../db/repo/repositories";
import { ingestFromTrees } from "../services/ingest";
import { ensureGlobalPolicy } from "../db/repo/governance";
import { ensureAgentCatalog } from "../orchestrator";
import { db } from "../db/client";
import { enqueueJob } from "../db/repo/jobs";

export const DEMO = {
  userLogin: "demo",
  orgLogin: "atlas-platform",
  repoOwner: "atlas",
  repoName: "atlas-org-service",
  prNumber: 184,
  // Fixed, deterministic pseudo-SHAs (40 hex chars — valid Git SHA shape).
  baseSha: "a17e5c9d00000000000000000000000000000001",
  headSha: "b02f9e4100000000000000000000000000000002",
  fixedSha: "c33d71a900000000000000000000000000000003",
  title: "Add organization member management API",
  body: [
    "## Summary",
    "Adds endpoints to list, invite, and update organization members.",
    "",
    "- GET /api/orgs/:orgId/members — list members with profiles",
    "- POST /api/orgs/:orgId/members — invite a member with a role",
    "- PATCH /api/orgs/:orgId/members/:userId — change a member's role",
    "- Adds lodash for utility helpers",
    "",
    "## Test plan",
    "- Manual smoke test via curl",
  ].join("\n"),
  author: "dev-avery",
  baseRef: "main",
  headRef: "feat/org-member-management",
  demoKind: "org-member-management",
};

function walk(dir: string, root = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      Object.assign(out, walk(full, root));
    } else {
      const rel = relative(root, full).split("\\").join("/");
      out[rel] = readFileSync(full, "utf8");
    }
  }
  return out;
}

function readOverlay(dir: string): Record<string, string> {
  try {
    return walk(join(process.cwd(), dir));
  } catch {
    return {};
  }
}

export function fixtureTrees(): { base: Record<string, string>; head: Record<string, string>; fixed: Record<string, string> } {
  const root = "fixtures/demo-repo";
  const base = readOverlay(`${root}/base`);
  const headOverlay = readOverlay(`${root}/head`);
  const fixedOverlay = readOverlay(`${root}/fixed`);
  const head = { ...base, ...headOverlay };
  const fixed = { ...head, ...fixedOverlay };
  return { base, head, fixed };
}

export interface SeedResult {
  userId: string;
  orgId: string;
  repoId: string;
  prId: string;
  snapshotId: string;
  alreadySeeded: boolean;
}

/** Idempotent: safe to call on every demo login. */
export function seedDemo(opts: { enqueue?: boolean; mode?: string } = {}): SeedResult {
  db(); // run migrations
  ensureAgentCatalog();
  ensureGlobalPolicy();

  const user = upsertUser({
    login: DEMO.userLogin,
    name: "Demo Engineer",
    email: "demo@prism.local",
    isDemo: true,
  });
  const org = upsertOrg({ login: DEMO.orgLogin, name: "Atlas Platform", isDemo: true });
  addOrgMember(org.id, user.id, "admin");
  const installation = demoInstallation(org.id);

  let repo = getRepositoryByFullName(`${DEMO.repoOwner}/${DEMO.repoName}`);
  if (!repo) {
    repo = upsertRepository({
      installationId: installation.id,
      orgId: org.id,
      owner: DEMO.repoOwner,
      name: DEMO.repoName,
      defaultBranch: "main",
      language: "TypeScript",
      isDemo: true,
    });
  }

  const existing = db()
    .prepare(
      `SELECT p.id FROM pull_requests p WHERE p.repository_id=? AND p.number=? AND p.head_sha=?`,
    )
    .get(repo.id, DEMO.prNumber, DEMO.headSha) as { id: string } | undefined;

  const { base, head } = fixtureTrees();
  const { prId, snapshotId } = ingestFromTrees({
    repository: repo,
    number: DEMO.prNumber,
    title: DEMO.title,
    body: DEMO.body,
    author: DEMO.author,
    baseRef: DEMO.baseRef,
    headRef: DEMO.headRef,
    baseSha: DEMO.baseSha,
    headSha: DEMO.headSha,
    baseTree: base,
    headTree: head,
    demoKind: DEMO.demoKind,
    isDemo: true,
    enqueue: opts.enqueue ?? true,
    mode: opts.mode ?? "standard",
  });

  return {
    userId: user.id,
    orgId: org.id,
    repoId: repo.id,
    prId,
    snapshotId,
    alreadySeeded: Boolean(existing),
  };
}

/** Simulate the author pushing the fix commit (GitHub `synchronize` event). */
export function ingestFixedCommit(opts: { enqueue?: boolean; mode?: string } = {}): {
  prId: string;
  snapshotId: string;
} {
  const seeded = seedDemo({ enqueue: false });
  const repo = getRepositoryByFullName(`${DEMO.repoOwner}/${DEMO.repoName}`)!;
  const { base, fixed } = fixtureTrees();
  // Snapshot is always base→head; the fixed tree includes all prior files.
  const { prId, snapshotId } = ingestFromTrees({
    repository: repo,
    number: DEMO.prNumber,
    title: DEMO.title,
    body: DEMO.body,
    author: DEMO.author,
    baseRef: DEMO.baseRef,
    headRef: DEMO.headRef,
    baseSha: DEMO.baseSha,
    headSha: DEMO.fixedSha,
    baseTree: base,
    headTree: fixed,
    demoKind: DEMO.demoKind,
    isDemo: true,
    enqueue: opts.enqueue ?? true,
    mode: opts.mode ?? "standard",
  });
  void seeded;
  return { prId, snapshotId };
}

/** Re-queue a fresh review (used by "Run demo review" / manual re-runs). */
export function enqueueDemoReview(prId: string, snapshotId: string, mode = "standard"): { deduped: boolean } {
  const job = enqueueJob(
    "review-pr",
    { prId, snapshotId, headSha: DEMO.headSha, mode },
    { dedupeKey: `review:${prId}:${DEMO.headSha}:${mode}` },
  );
  return { deduped: job.deduped };
}
