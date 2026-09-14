import { db } from "../client";

/** All analytics queries are tenant-scoped and computed from stored reviews only. */
export function dashboardMetrics(userId: string) {
  const auth = `JOIN org_members m ON m.org_id = r.org_id AND m.user_id = ?`;
  const repositories = db()
    .prepare(`SELECT COUNT(*) c FROM repositories r ${auth}`)
    .get(userId) as { c: number };
  const prs = db()
    .prepare(`SELECT COUNT(*) c FROM pull_requests p JOIN repositories r ON r.id=p.repository_id ${auth}`)
    .get(userId) as { c: number };
  const reviewedPrs = db()
    .prepare(
      `SELECT COUNT(DISTINCT rv.pr_id) c FROM reviews rv
       JOIN pull_requests p ON p.id=rv.pr_id JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE rv.status='COMPLETED'`,
    )
    .get(userId) as { c: number };
  const openFindings = db()
    .prepare(
      `SELECT COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE f.status='OPEN' AND rv.is_stale=0`,
    )
    .get(userId) as { c: number };
  const criticalFindings = db()
    .prepare(
      `SELECT COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE f.status='OPEN' AND f.severity IN ('CRITICAL','HIGH') AND rv.is_stale=0`,
    )
    .get(userId) as { c: number };
  const avgDuration = db()
    .prepare(
      `SELECT AVG(rv.duration_ms) a FROM reviews rv
       JOIN pull_requests p ON p.id=rv.pr_id JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE rv.status='COMPLETED'`,
    )
    .get(userId) as { a: number | null };
  const dismissed = db()
    .prepare(
      `SELECT COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE f.status IN ('DISMISSED','ACCEPTED_RISK')`,
    )
    .get(userId) as { c: number };
  const totalAdjudicated = db()
    .prepare(
      `SELECT COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE f.critic_verdict IS NOT NULL`,
    )
    .get(userId) as { c: number };
  const falsePositives = db()
    .prepare(
      `SELECT COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id ${auth}
       WHERE f.dismissed_reason='false_positive'`,
    )
    .get(userId) as { c: number };

  return {
    repositories: repositories.c,
    pullRequests: prs.c,
    reviewedPrs: reviewedPrs.c,
    openFindings: openFindings.c,
    criticalFindings: criticalFindings.c,
    avgReviewMs: avgDuration.a ? Math.round(avgDuration.a) : null,
    falsePositiveRate: totalAdjudicated.c > 0 ? falsePositives.c / totalAdjudicated.c : null,
    dismissed: dismissed.c,
  };
}

export function findingsBySeverity(userId: string): { severity: string; c: number }[] {
  return db()
    .prepare(
      `SELECT f.severity AS severity, COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       WHERE f.status='OPEN' AND rv.is_stale=0
       GROUP BY f.severity`,
    )
    .all(userId) as { severity: string; c: number }[];
}

export function findingsByCategory(userId: string): { category: string; c: number }[] {
  return db()
    .prepare(
      `SELECT f.category, COUNT(*) c FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       GROUP BY f.category ORDER BY c DESC`,
    )
    .all(userId) as { category: string; c: number }[];
}

export function findingsTimeline(userId: string, days = 30): { day: string; c: number; critical: number }[] {
  return db()
    .prepare(
      `SELECT date(f.created_at) day, COUNT(*) c,
        SUM(CASE WHEN f.severity IN ('CRITICAL','HIGH') THEN 1 ELSE 0 END) critical
       FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       WHERE f.created_at >= datetime('now', ?)
       GROUP BY day ORDER BY day`,
    )
    .all(userId, `-${days} days`) as { day: string; c: number; critical: number }[];
}

export function riskTrend(userId: string, limit = 20): { created_at: string; risk_score: number; repo: string; pr: number }[] {
  return db()
    .prepare(
      `SELECT rv.created_at, rv.risk_score AS risk_score, r.full_name AS repo, p.number AS pr
       FROM reviews rv
       JOIN pull_requests p ON p.id=rv.pr_id JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       WHERE rv.status='COMPLETED'
       ORDER BY rv.created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as { created_at: string; risk_score: number; repo: string; pr: number }[];
}

export function reviewerEffectiveness(userId: string) {
  return db()
    .prepare(
      `SELECT f.agent, COUNT(*) total,
        SUM(CASE WHEN f.critic_verdict='CONFIRMED' THEN 1 ELSE 0 END) confirmed,
        SUM(CASE WHEN f.critic_verdict='FALSE_POSITIVE' THEN 1 ELSE 0 END) false_positives,
        SUM(CASE WHEN f.status IN ('FIXED','DISMISSED','ACCEPTED_RISK') THEN 1 ELSE 0 END) resolved
       FROM findings f
       JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
       GROUP BY f.agent ORDER BY total DESC`,
    )
    .all(userId) as { agent: string; total: number; confirmed: number; false_positives: number; resolved: number }[];
}

// --------------------------------------------------------------- kv cache ---

export function cacheGet(key: string): string | null {
  const row = db().prepare("SELECT value FROM kv_cache WHERE key=? AND (expires_at IS NULL OR expires_at > datetime('now'))").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function cacheSet(key: string, value: string, ttlSeconds?: number): void {
  const expires = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
  db()
    .prepare("INSERT INTO kv_cache (key, value, expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at")
    .run(key, value, expires);
}
