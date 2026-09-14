import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { Card } from "@/components/ui";
import { Bot, Gauge, ShieldCheck, Cpu, Coins } from "lucide-react";
import { fmtDuration } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface CatalogRow {
  key: string;
  name: string;
  description: string;
  category: string;
  stage: number;
  enabled: number;
}

interface AgentStat {
  runs: number;
  findings: number;
  tokens: number;
  cost: number;
  duration: number | null;
  failures: number;
}

const DETERMINISTIC_ICON: Record<string, boolean> = {
  static: true,
  evidence: true,
  risk: true,
  synthesizer: true,
};

export default function AgentsPage() {
  const user = requireUser();
  const catalog = db().prepare("SELECT * FROM agents ORDER BY stage").all() as CatalogRow[];

  const stats = new Map<string, AgentStat>();
  const rows = db()
    .prepare(
      `SELECT ar.agent_key, ar.status, ar.tokens_in, ar.tokens_out, ar.cost_usd, ar.findings_count, ar.duration_ms
       FROM agent_runs ar
       JOIN reviews rv ON rv.id=ar.review_id
       JOIN pull_requests p ON p.id=rv.pr_id
       JOIN repositories r ON r.id=p.repository_id
       JOIN org_members m ON m.org_id=r.org_id AND m.user_id=?`,
    )
    .all(user.id) as { agent_key: string; status: string; tokens_in: number; tokens_out: number; cost_usd: number; findings_count: number; duration_ms: number | null }[];

  for (const r of rows) {
    const s = stats.get(r.agent_key) ?? { runs: 0, findings: 0, tokens: 0, cost: 0, duration: null, failures: 0, durations: [] } as AgentStat & { durations: number[] };
    s.runs++;
    s.findings += r.findings_count;
    s.tokens += r.tokens_in + r.tokens_out;
    s.cost += r.cost_usd;
    if (r.status === "FAILED") s.failures++;
    if (r.duration_ms != null) (s as AgentStat & { durations: number[] }).durations.push(r.duration_ms);
    stats.set(r.agent_key, s);
  }
  for (const s of stats.values()) {
    const durations = (s as AgentStat & { durations?: number[] }).durations ?? [];
    s.duration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Review mesh</h1>
        <p className="text-xs text-graphite-400">
          Deterministic engines run first; specialist agents receive only grounded repository context, emit structured
          JSON, and their HIGH/CRITICAL findings face an adversarial critic.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {catalog.map((a) => {
          const s = stats.get(a.key);
          const deterministic = DETERMINISTIC_ICON[a.key];
          const Icon = a.key === "critic" ? ShieldCheck : deterministic ? Gauge : Bot;
          return (
            <Card key={a.key} className="p-4">
              <div className="flex items-start gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${deterministic ? "border-amber-800/60 bg-amber-950/40 text-amber-400" : a.key === "critic" ? "border-green-800/60 bg-green-950/40 text-green-400" : "border-blue-900/60 bg-blue-950/40 text-blue-300"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-graphite-100">{a.name}</h3>
                    <span className="rounded border border-graphite-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-graphite-400">
                      {deterministic ? "deterministic" : a.key === "critic" ? "adversarial" : "llm agent"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-graphite-400">{a.description}</p>
                  {s && (
                    <div className="mt-3 grid grid-cols-5 gap-2 border-t border-graphite-800 pt-2.5 text-[10px] text-graphite-400">
                      <Metric icon={<Cpu className="h-3 w-3" />} label="runs" value={String(s.runs)} />
                      <Metric label="findings" value={String(s.findings)} />
                      <Metric label="avg" value={s.duration != null ? fmtDuration(s.duration) : "—"} />
                      <Metric icon={<Coins className="h-3 w-3" />} label="tokens" value={s.tokens ? String(s.tokens) : "—"} />
                      <Metric label="cost" value={s.cost ? `$${s.cost.toFixed(3)}` : "—"} />
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-graphite-500">{icon}{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-graphite-200">{value}</div>
    </div>
  );
}
