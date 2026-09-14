import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMANDS = [
  { label: "Go to Dashboard", href: "/dashboard", group: "Navigate", keywords: "home overview" },
  { label: "Go to Repositories", href: "/repositories", group: "Navigate", keywords: "repo" },
  { label: "Go to Pull Requests", href: "/pull-requests", group: "Navigate", keywords: "pr" },
  { label: "Go to Findings", href: "/findings", group: "Navigate", keywords: "issues bugs" },
  { label: "Go to Agents", href: "/agents", group: "Navigate", keywords: "mesh runs" },
  { label: "Go to Analytics", href: "/analytics", group: "Navigate", keywords: "metrics trends" },
  { label: "Go to Policies", href: "/policies", group: "Navigate", keywords: "rules blocking" },
  { label: "Go to Integrations", href: "/integrations", group: "Navigate", keywords: "github app webhook" },
  { label: "Go to Settings", href: "/settings", group: "Navigate", keywords: "config" },
  { label: "Go to Docs", href: "/docs", group: "Navigate", keywords: "help api" },
];

export async function GET(req: NextRequest) {
  try {
    const user = requireUser();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    const commands = COMMANDS.filter(
      (c) => !q || `${c.label} ${c.keywords}`.toLowerCase().includes(q.toLowerCase()),
    ).map((c) => ({ type: "command", label: c.label, href: c.href, group: c.group }));

    if (q.length < 2) return NextResponse.json({ results: commands });
    const like = `%${q}%`;
    const repos = db()
      .prepare(
        `SELECT r.id, r.full_name FROM repositories r
         JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
         WHERE r.full_name LIKE ? LIMIT 6`,
      )
      .all(user.id, like) as { id: string; full_name: string }[];
    const prs = db()
      .prepare(
        `SELECT p.id, p.number, p.title, r.full_name FROM pull_requests p
         JOIN repositories r ON r.id=p.repository_id
         JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
         WHERE p.title LIKE ? OR CAST(p.number AS TEXT) LIKE ? LIMIT 6`,
      )
      .all(user.id, like, like) as { id: string; number: number; title: string; full_name: string }[];
    const findings = db()
      .prepare(
        `SELECT f.id, f.title, f.severity, f.file FROM findings f
         JOIN reviews rv ON rv.id=f.review_id JOIN pull_requests p ON p.id=rv.pr_id
         JOIN repositories r ON r.id=p.repository_id
         JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
         WHERE f.title LIKE ? OR f.file LIKE ? LIMIT 8`,
      )
      .all(user.id, like, like) as { id: string; title: string; severity: string; file: string }[];
    const reviews = db()
      .prepare(
        `SELECT rv.id, p.number, r.full_name, rv.status FROM reviews rv
         JOIN pull_requests p ON p.id=rv.pr_id JOIN repositories r ON r.id=p.repository_id
         JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?
         WHERE CAST(p.number AS TEXT) LIKE ? OR rv.status LIKE ? LIMIT 6`,
      )
      .all(user.id, like, like) as { id: string; number: number; full_name: string; status: string }[];

    return NextResponse.json({
      results: [
        ...commands,
        ...repos.map((r) => ({ type: "repository", label: r.full_name, href: `/repositories/${r.id}`, group: "Repositories" })),
        ...prs.map((p) => ({ type: "pull-request", label: `#${p.number} ${p.title}`, href: `/pull-requests/${p.id}`, group: "Pull Requests" })),
        ...reviews.map((r) => ({ type: "review", label: `Review #${r.number} · ${r.status}`, href: `/reviews/${r.id}`, group: "Reviews" })),
        ...findings.map((f) => ({ type: "finding", label: `${f.severity} · ${f.title}`, href: `/findings?finding=${f.id}`, group: "Findings" })),
      ],
    });
  } catch (err) {
    return apiError(err);
  }
}
