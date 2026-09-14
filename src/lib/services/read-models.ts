/**
 * Read models: aggregate, tenant-scoped projections used by both server
 * components and the JSON API. Every repository-scoped query passes through
 * authorizedRepoIds() — there is no unscoped read path for tenant data.
 */
import { db } from "../db/client";
import {
  getReview,
  listFindingsForReview,
  listRunsForReview,
  listEvents,
  getFinding,
  type ReviewRow,
  type AgentRunRow,
  type AgentEventRow,
} from "../db/repo/reviews";
import {
  getPullRequest,
  getRepositoryById,
  listPullRequests,
  listRepositoriesForUser,
  getChangedFiles,
  type PullRequestRow,
  type RepositoryRow,
} from "../db/repo/repositories";
import {
  listArtifacts,
  listToolsForRun,
} from "../db/repo/reviews";
import { listPublicationsForReview } from "../db/repo/governance";
import { authorizedRepoIds } from "../db/repo/identity";
import type { ChangedFile, Finding } from "../types";

export function assertReviewAccess(userId: string, review: ReviewRow): { pr: PullRequestRow; repo: RepositoryRow } {
  const pr = getPullRequest(review.pr_id);
  if (!pr) throw Object.assign(new Error("Pull request not found"), { status: 404 });
  const allowed = authorizedRepoIds(userId);
  if (!allowed.has(pr.repository_id)) {
    throw Object.assign(new Error("Not authorized for this repository"), { status: 403 });
  }
  const repo = getRepositoryById(pr.repository_id)!;
  return { pr, repo };
}

export interface ReviewDetail {
  review: ReviewRow;
  pr: PullRequestRow;
  repo: RepositoryRow;
  files: (ChangedFile & { id: string })[];
  findings: Finding[];
  runs: AgentRunRow[];
  events: AgentEventRow[];
  artifacts: { id: string; kind: string; filename: string; created_at: string }[];
  publications: unknown[];
  previousReview?: ReviewRow & { findings: Finding[] };
  risk: import("../types").RiskResult | null;
  intent: import("../agents/intent").PrIntent | null;
}

export function reviewDetail(reviewId: string, userId: string): ReviewDetail {
  const review = getReview(reviewId);
  if (!review) throw Object.assign(new Error("Review not found"), { status: 404 });
  const { pr, repo } = assertReviewAccess(userId, review);
  const findings = listFindingsForReview(reviewId);
  const runs = listRunsForReview(reviewId);
  const events = listEvents(reviewId);
  const files = getChangedFiles(review.snapshot_id);
  const artifacts = listArtifacts(reviewId);
  const publications = listPublicationsForReview(reviewId);
  const risk = review.risk_json ? (JSON.parse(review.risk_json) as import("../types").RiskResult) : null;

  let intent: import("../agents/intent").PrIntent | null = null;
  if (review.intent_json) {
    try {
      intent = JSON.parse(review.intent_json) as import("../agents/intent").PrIntent;
    } catch {
      intent = null;
    }
  } else {
    const intentArtifact = db().prepare("SELECT content FROM artifacts WHERE review_id=? AND kind='intent' ORDER BY rowid DESC LIMIT 1").get(reviewId) as
      | { content: string }
      | undefined;
    if (intentArtifact) {
      try {
        intent = JSON.parse(intentArtifact.content) as import("../agents/intent").PrIntent;
      } catch {
        intent = null;
      }
    }
  }

  const previousRow = db()
    .prepare("SELECT * FROM reviews WHERE pr_id=? AND status='COMPLETED' AND id<>? ORDER BY created_at DESC LIMIT 1")
    .get(pr.id, reviewId) as ReviewRow | undefined;
  const previous = previousRow
    ? { ...previousRow, findings: listFindingsForReview(previousRow.id) }
    : undefined;

  return { review, pr, repo, files, findings, runs, events, artifacts, publications, previousReview: previous, risk, intent };
}

export function prDetail(prId: string, userId: string) {
  const pr = getPullRequest(prId);
  if (!pr) throw Object.assign(new Error("Pull request not found"), { status: 404 });
  const allowed = authorizedRepoIds(userId);
  if (!allowed.has(pr.repository_id)) throw Object.assign(new Error("Not authorized"), { status: 403 });
  const repo = getRepositoryById(pr.repository_id)!;
  const reviews = db().prepare("SELECT * FROM reviews WHERE pr_id=? ORDER BY created_at DESC").all(pr.id) as ReviewRow[];
  const latest = reviews[0];
  return { pr, repo, reviews, latestReviewId: latest?.id };
}

export function repoDetail(repoId: string, userId: string) {
  const allowed = authorizedRepoIds(userId);
  if (!allowed.has(repoId)) throw Object.assign(new Error("Not authorized for this repository"), { status: 403 });
  const repo = getRepositoryById(repoId)!;
  const prs = listPullRequests(repoId);
  const profile = repo.profile_json ? (JSON.parse(repo.profile_json) as import("../types").RepoProfile) : null;
  const reviewCount = (
    db()
      .prepare(
        `SELECT COUNT(*) c FROM reviews rv JOIN pull_requests p ON p.id=rv.pr_id
         WHERE p.repository_id=? AND rv.status='COMPLETED'`,
      )
      .get(repoId) as { c: number }
  ).c;
  const openFindings = (
    db()
      .prepare(
        `SELECT COUNT(*) c FROM findings f JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
         WHERE p.repository_id=? AND f.status='OPEN' AND rv.is_stale=0`,
      )
      .get(repoId) as { c: number }
  ).c;
  return { repo, prs, profile, reviewCount, openFindings };
}

export function dashboardData(userId: string) {
  const repos = listRepositoriesForUser(userId);
  const recentReviews = db()
    .prepare(
      `SELECT rv.*, p.number AS pr_number, p.title AS pr_title, r.full_name AS repo_full_name
       FROM reviews rv
       JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       ORDER BY rv.created_at DESC LIMIT 12`,
    )
    .all(userId) as (ReviewRow & { pr_number: number; pr_title: string; repo_full_name: string })[];
  const recentPrs = db()
    .prepare(
      `SELECT p.*, r.full_name AS repo_full_name FROM pull_requests p
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       ORDER BY p.updated_at DESC LIMIT 10`,
    )
    .all(userId) as (PullRequestRow & { repo_full_name: string })[];
  return { repos, recentReviews, recentPrs };
}

export { getFinding, listToolsForRun, listFindingsForReview };
