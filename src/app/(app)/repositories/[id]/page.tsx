import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { repoDetail } from "@/lib/services/read-models";
import { listMemory, listRules } from "@/lib/db/repo/governance";
import { db } from "@/lib/db/client";
import type { ReviewRow } from "@/lib/db/repo/reviews";
import { Card, EmptyState } from "@/components/ui";
import { StatusPill, RecommendationBadge } from "@/components/badges";
import { ToneText } from "@/components/charts";
import { relTime } from "@/lib/utils";
import { FolderTree, Brain, SlidersHorizontal, GitPullRequest } from "lucide-react";

export const dynamic = "force-dynamic";

export default function RepositoryPage({ params }: { params: { id: string } }) {
  const user = requireUser();
  let d;
  try {
    d = repoDetail(params.id, user.id);
  } catch (err) {
    if ((err as { status?: number }).status === 404) notFound();
    throw err;
  }
  const { repo, prs, profile, reviewCount, openFindings } = d;
  const memory = listMemory(repo.id);
  const rules = listRules(repo.id);

  const latestByPr = new Map<string, ReviewRow>();
  for (const p of prs) {
    const r = db()
      .prepare("SELECT * FROM reviews WHERE pr_id=? ORDER BY created_at DESC LIMIT 1")
      .get(p.id) as ReviewRow | undefined;
    if (r) latestByPr.set(p.id, r);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-lg font-semibold tracking-tight text-graphite-50">{repo.full_name}</h1>
            {repo.is_demo ? (
              <span className="rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">demo</span>
            ) : null}
          </div>
          <p className="text-xs text-graphite-400">
            default branch <span className="font-mono">{repo.default_branch}</span> · {reviewCount} completed reviews · {openFindings} open findings
          </p>
        </div>
        <Link href="/policies" className="btn-secondary text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Policy & path reviewers
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FolderTree className="h-4 w-4 text-graphite-400" /> Repository context profile
          </h3>
          {!profile ? (
            <p className="text-xs text-graphite-500">Profile built during the CONTEXT stage of the first review.</p>
          ) : (
            <dl className="space-y-2 text-xs">
              <ProfileRow
                k="Stack"
                v={[profile.framework, profile.packageManager, profile.testFramework, profile.ci, ...profile.linters].filter(Boolean).join(", ") || "—"}
              />
              <ProfileRow k="Architecture" v={profile.architectureHints.join(" · ") || "—"} />
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-graphite-500">Languages</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(profile.languages).map(([lang, pct]) => (
                    <span key={lang} className="rounded border border-graphite-700 px-1.5 py-0.5 font-mono text-[10px] text-graphite-300">
                      {lang} {Math.round(pct * 100)}%
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Brain className="h-4 w-4 text-graphite-400" /> Repository memory
          </h3>
          {memory.length === 0 ? (
            <p className="text-xs leading-relaxed text-graphite-500">
              Memory accrues from triaged findings (false positives, accepted risk) and explicit notes; agents read it before reviewing.
            </p>
          ) : (
            <ul className="space-y-2">
              {memory.slice(0, 8).map((m) => (
                <li key={m.id} className="rounded-md border border-graphite-700/70 bg-graphite-950/60 p-2 text-[11px]">
                  <div className="text-[10px] uppercase tracking-wider text-graphite-500">{m.kind.replace(/_/g, " ")}</div>
                  <p className="mt-1 text-graphite-300">{m.content}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-semibold">Custom path rules</h3>
          {rules.length === 0 ? (
            <p className="text-xs leading-relaxed text-graphite-500">
              No path-specific rules. Configure required reviewers and extra checks under Policies.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {rules.map((r) => (
                <li key={r.id} className="rounded border border-graphite-700/70 px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-graphite-300">{r.path_glob ?? "*"}</span>
                    <span className="uppercase text-graphite-500">{r.kind}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-graphite-400">
                    <span className="font-mono">{r.pattern}</span> — {r.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <GitPullRequest className="h-4 w-4 text-graphite-400" /> Pull requests
        </h3>
        {prs.length === 0 ? (
          <EmptyState title="No pull requests" body="Open a PR against an installed repository — webhook ingestion creates it automatically." />
        ) : (
          <div className="divide-y divide-graphite-800">
            {prs.map((p) => {
              const latest = latestByPr.get(p.id);
              return (
                <Link key={p.id} href={`/pull-requests/${p.id}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 hover:bg-graphite-900/40">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-graphite-100">
                      <span className="font-mono text-graphite-400">#{p.number}</span> {p.title}
                    </div>
                    <div className="mt-0.5 text-[10px] text-graphite-500">
                      {p.base_ref} → {p.head_ref} · updated {relTime(p.updated_at)}
                    </div>
                  </div>
                  <ToneText value={latest?.risk_score ?? null} className="w-10 text-right text-sm font-semibold" />
                  <div className="w-44 text-right">
                    {latest && latest.status === "COMPLETED" ? (
                      <RecommendationBadge rec={latest.recommendation} />
                    ) : latest ? (
                      <StatusPill status={latest.status} />
                    ) : (
                      <StatusPill status="QUEUED" />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function ProfileRow({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-graphite-500">{k}</dt>
      <dd className="mt-0.5 text-graphite-300">{v}</dd>
    </div>
  );
}
