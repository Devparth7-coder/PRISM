import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { config, hasGitHubApp, hasWebhookSecret } from "@/lib/config";
import { selectProvider } from "@/lib/ai/router";
import { listWebhooks } from "@/lib/db/repo/governance";
import { listDeadJobs, listRecentJobs } from "@/lib/db/repo/jobs";
import { listRepositoriesForUser } from "@/lib/db/repo/repositories";
import { Card } from "@/components/ui";
import { CopyBox } from "@/components/CopyBox";
import { RetryJobButton } from "@/components/jobs/RetryJobButton";
import { CheckCircle2, XCircle, Github, Bot, Webhook, Inbox } from "lucide-react";
import { relTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  const user = requireUser();
  const provider = selectProvider();
  const githubOk = hasGitHubApp();
  const secretOk = hasWebhookSecret();
  const webhooks = listWebhooks(30) as {
    id: string;
    event: string;
    action: string | null;
    signature_valid: number;
    status: string;
    repository_full: string | null;
    error: string | null;
    created_at: string;
  }[];
  const deadJobs = listDeadJobs();
  const recent = listRecentJobs(30);
  const allowedRepos = new Set(listRepositoriesForUser(user.id).map((r) => r.full_name));
  const visibleWebhooks = webhooks.filter((w) => !w.repository_full || allowedRepos.has(w.repository_full));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Integrations</h1>
        <p className="text-xs text-graphite-400">Live configuration status. Secrets are read from environment variables only and are never displayed.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ModeCard
          icon={<Github className="h-4 w-4" />}
          title="GitHub App"
          ok={githubOk}
          okLabel="App ID + private key configured"
          badLabel="Not configured — running in DEMO MODE"
          action={<Link href="/install" className="text-[11px] text-prism-red underline">View install guide</Link>}
        />
        <ModeCard
          icon={<Webhook className="h-4 w-4" />}
          title="Webhook verification"
          ok={secretOk}
          okLabel="HMAC-SHA256 signature verification active"
          badLabel="No GITHUB_WEBHOOK_SECRET — deliveries rejected in live mode"
        />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-graphite-400" /> AI provider</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row k="Active provider" v={provider.isLocal ? "Local deterministic only" : provider.provider.label} />
          <Row k="Model" v={provider.provider.model} />
          <Row k="OpenAI" v={config.ai.openai.apiKey ? "configured" : "—"} ok={Boolean(config.ai.openai.apiKey)} />
          <Row k="Gemini" v={config.ai.gemini.apiKey ? "configured" : "—"} ok={Boolean(config.ai.gemini.apiKey)} />
          <Row k="Anthropic" v={config.ai.anthropic.apiKey ? "configured" : "—"} ok={Boolean(config.ai.anthropic.apiKey)} />
          <Row k="Mode" v={config.mode} />
        </div>
        {provider.isLocal && (
          <p className="mt-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-200/90">
            No AI provider key is set. Deterministic engines still run fully; the specialist LLM agents are skipped and
            their findings simply do not exist — PRISM never fabricates AI results.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">Webhook endpoint</h3>
        <CopyBox label="Webhook URL" value={`${config.baseUrl}/api/webhooks/github`} />
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-2 border-b border-graphite-800 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-graphite-400">
          <Inbox className="h-3.5 w-3.5" /> Recent webhook deliveries
        </div>
        {visibleWebhooks.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-graphite-500">No webhook deliveries recorded. In demo mode the webhook is simulated internally.</p>
        ) : (
          <div className="divide-y divide-graphite-800">
            {visibleWebhooks.map((w) => (
              <div key={w.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2 text-[11px]">
                {w.signature_valid ? <CheckCircle2 className="h-3.5 w-3.5 text-prism-green" /> : <XCircle className="h-3.5 w-3.5 text-prism-red" />}
                <div>
                  <span className="font-mono text-graphite-200">{w.event}</span>
                  {w.action && <span className="text-graphite-500">.{w.action}</span>}
                  <span className="ml-2 text-graphite-500">{w.repository_full ?? "—"} · {w.status}{w.error ? ` · ${w.error}` : ""}</span>
                </div>
                <span className="text-graphite-600">{relTime(w.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {deadJobs.length > 0 && (
        <Card className="border-red-900/50 p-0">
          <div className="border-b border-red-900/40 bg-red-950/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-red-300">
            Dead-letter queue
          </div>
          <div className="divide-y divide-graphite-800">
            {deadJobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[11px]">
                <div className="min-w-0">
                  <span className="font-mono text-graphite-200">{j.type}</span>
                  {j.last_error && <div className="truncate text-red-300/80">{j.last_error}</div>}
                </div>
                <RetryJobButton jobId={j.id} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-center text-[11px] text-graphite-600">
        {recent.length} recent jobs recorded · worker processes one job at a time with exponential backoff and idempotency keys
      </p>
    </div>
  );
}

function ModeCard({ icon, title, ok, okLabel, badLabel, action }: { icon: React.ReactNode; title: string; ok: boolean; okLabel: string; badLabel: string; action?: React.ReactNode }) {
  return (
    <Card className={`p-4 ${ok ? "border-green-900/50" : "border-amber-900/50"}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase ${ok ? "bg-green-950 text-green-300" : "bg-amber-950 text-amber-300"}`}>
          {ok ? "live" : "demo"}
        </span>
      </div>
      <p className={`mt-2 text-[11px] ${ok ? "text-graphite-300" : "text-amber-200/90"}`}>{ok ? okLabel : badLabel}</p>
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-graphite-700/70 px-3 py-2 text-xs">
      <span className="text-graphite-400">{k}</span>
      <span className={ok === undefined ? "font-mono text-graphite-200" : ok ? "text-prism-green" : "text-graphite-500"}>{v}</span>
    </div>
  );
}
