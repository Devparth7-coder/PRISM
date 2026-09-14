import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { queryFindings } from "@/lib/db/repo/reviews";
import { listRepositoriesForUser } from "@/lib/db/repo/repositories";
import { Card } from "@/components/ui";
import { SeverityBadge, DetectorBadge, CriticBadge, FindingStatusBadge } from "@/components/badges";
import { relTime, titleCase } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const CATEGORIES = ["SECURITY", "CORRECTNESS", "PERFORMANCE", "MAINTAINABILITY", "TESTS", "API_CONTRACT", "DEPENDENCIES"];
const STATUSES = ["OPEN", "FIXED", "DISMISSED", "ACCEPTED_RISK", "STALE"];

export default function FindingsPage({
  searchParams,
}: {
  searchParams: { severity?: string; category?: string; status?: string; repo?: string; q?: string };
}) {
  const user = requireUser();
  const { findings, total } = queryFindings({
    userId: user.id,
    severity: searchParams.severity,
    category: searchParams.category,
    status: searchParams.status as never,
    repositoryId: searchParams.repo,
    q: searchParams.q,
    limit: 200,
  });
  const repos = listRepositoriesForUser(user.id);

  const chip = (key: string, value?: string) => {
    const sp = new URLSearchParams({ ...searchParams } as Record<string, string>);
    if (value) sp.set(key, value);
    else sp.delete(key);
    return `/findings?${sp.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Findings</h1>
        <p className="text-xs text-graphite-400">{total} findings match — every finding carries structured evidence and provenance.</p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-500" />
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search title, description, file…" className="input h-8 w-72 pl-8 text-xs" />
        </div>
        <input type="hidden" name="severity" value={searchParams.severity ?? ""} />
        <input type="hidden" name="category" value={searchParams.category ?? ""} />
        <input type="hidden" name="status" value={searchParams.status ?? ""} />
        <select name="repo" defaultValue={searchParams.repo ?? ""} className="input h-8 w-56 text-xs">
          <option value="">All repositories</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </select>
        <button className="btn-secondary h-8 text-xs">Filter</button>
        <Link href="/findings" className="text-[11px] text-graphite-400 hover:text-graphite-200">Clear</Link>
      </form>

      <FilterRow label="Severity" options={SEVERITIES} active={searchParams.severity} href={(v) => chip("severity", v)} />
      <FilterRow label="Category" options={CATEGORIES.map((c) => ({ value: c, label: titleCase(c.replace(/_/g, " ")) }))} active={searchParams.category} href={(v) => chip("category", v)} />
      <FilterRow label="Status" options={STATUSES} active={searchParams.status} href={(v) => chip("status", v)} />

      <Card className="divide-y divide-graphite-800 p-0">
        {findings.length === 0 && <div className="px-4 py-10 text-center text-xs text-graphite-500">No findings match these filters.</div>}
        {findings.map((f) => (
          <Link
            key={f.id}
            href={`/reviews/${f.reviewId}#finding-${f.id}`}
            className="block px-4 py-3 hover:bg-graphite-900/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={f.severity} />
              <DetectorBadge detector={f.detector} />
              {f.criticVerdict && <CriticBadge verdict={f.criticVerdict} />}
              {f.regression && <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase", f.regression === "FIXED" ? "border-green-800 text-green-300" : f.regression === "PERSISTENT" ? "border-amber-800 text-amber-300" : "border-red-800 text-red-300")}>{f.regression}</span>}
              <FindingStatusBadge status={f.status} />
              <span className="ml-auto font-mono text-[10px] text-graphite-500">
                {f.repo_full_name} #{f.pr_number}
              </span>
            </div>
            <div className="mt-1.5 text-xs font-medium text-graphite-100">{f.title}</div>
            <div className="mt-0.5 text-[11px] text-graphite-500">
              <span className="font-mono">{f.file}:{f.lineStart}</span> · {titleCase(f.category.replace(/_/g, " "))} · {relTime(f.createdAt)}
            </div>
          </Link>
        ))}
      </Card>
    </div>
  );
}

function FilterRow({
  label,
  options,
  active,
  href,
}: {
  label: string;
  options: (string | { value: string; label: string })[];
  active?: string;
  href: (v?: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="w-16 text-[10px] uppercase tracking-wider text-graphite-500">{label}</span>
      <Link href={href()} className={cn("rounded-full border px-2.5 py-0.5", !active ? "border-graphite-500 text-graphite-100" : "border-graphite-700 text-graphite-400 hover:text-graphite-200")}>
        All
      </Link>
      {options.map((o) => {
        const value = typeof o === "string" ? o : o.value;
        const text = typeof o === "string" ? o.toLowerCase() : o.label;
        return (
          <Link key={value} href={href(value)} className={cn("rounded-full border px-2.5 py-0.5 capitalize", active === value ? "border-prism-red text-prism-red" : "border-graphite-700 text-graphite-400 hover:text-graphite-200")}>
            {text}
          </Link>
        );
      })}
    </div>
  );
}
