import { requireUser } from "@/lib/auth";
import { getUser } from "@/lib/db/repo/identity";
import { config, hasGitHubApp, hasWebhookSecret } from "@/lib/config";
import { Card } from "@/components/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { CheckCircle2, XCircle, KeyRound, ShieldCheck, Github } from "lucide-react";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const session = requireUser();
  const user = getUser(session.id);

  const envRows: { name: string; set: boolean; note: string }[] = [
    { name: "PRISM_MODE", set: config.mode === "live", note: `currently: ${config.mode}` },
    { name: "PRISM_BASE_URL", set: true, note: config.baseUrl },
    { name: "PRISM_SESSION_SECRET", set: config.sessionSecret !== "prism-insecure-dev-secret-change-me", note: "cookie signing secret" },
    { name: "GITHUB_APP_ID", set: hasGitHubApp(), note: "GitHub App identity" },
    { name: "GITHUB_APP_PRIVATE_KEY / _PATH", set: Boolean(config.github.privateKey || config.github.privateKeyPath), note: "PEM, never stored in DB" },
    { name: "GITHUB_WEBHOOK_SECRET", set: hasWebhookSecret(), note: "HMAC-SHA256 verification" },
    { name: "GITHUB_OAUTH_CLIENT_ID / _SECRET", set: Boolean(config.github.oauthClientId && config.github.oauthClientSecret), note: "dashboard login" },
    { name: "OPENAI_API_KEY", set: Boolean(config.ai.openai.apiKey), note: config.ai.openai.model },
    { name: "GEMINI_API_KEY", set: Boolean(config.ai.gemini.apiKey), note: config.ai.gemini.model },
    { name: "ANTHROPIC_API_KEY", set: Boolean(config.ai.anthropic.apiKey), note: config.ai.anthropic.model },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-graphite-50">Settings</h1>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Github className="h-4 w-4 text-graphite-400" /> Account
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" className="h-10 w-10 rounded-full border border-graphite-700" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-graphite-700 bg-graphite-800 text-sm font-semibold">
                {user?.login.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-graphite-100">
                {user?.login}
                {user?.is_demo ? (
                  <span className="rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">demo user</span>
                ) : null}
              </div>
              <div className="text-[11px] text-graphite-500">{user?.name ?? user?.email ?? "GitHub OAuth identity"}</div>
            </div>
          </div>
          <div className="ml-auto"><LogoutButton /></div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-graphite-400" /> Environment configuration
        </h3>
        <p className="mb-3 text-[11px] text-graphite-500">
          Secrets are provided through environment variables only. Values are never displayed, logged, or written to the
          database; tokens are redacted in logs before emission.
        </p>
        <div className="divide-y divide-graphite-800 rounded-md border border-graphite-700">
          {envRows.map((r) => (
            <div key={r.name} className="grid grid-cols-[auto_220px_1fr] items-center gap-3 px-3 py-2 text-xs">
              {r.set ? <CheckCircle2 className="h-4 w-4 text-prism-green" /> : <XCircle className="h-4 w-4 text-graphite-600" />}
              <span className="font-mono text-graphite-200">{r.name}</span>
              <span className="text-graphite-500">{r.note}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-graphite-400" /> Security posture
        </h3>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-graphite-400">
          <li>• Pull-request code is never executed on the PRISM server — analysis is static; there is no sandbox escape surface.</li>
          <li>• Secrets and environment variables are never passed to AI prompts or PR code; detected secrets are redacted in logs.</li>
          <li>• LLM outputs are schema-validated JSON with retries, evidence-verified, and adjudicated before publication.</li>
          <li>• Every webhook is HMAC-verified, every job is idempotent per commit SHA, every read is tenant-scoped.</li>
          <li>• Retention: {config.retentionDays} days · per-review token cap {config.maxAiTokens.toLocaleString()} · daily AI budget ${config.aiCostBudgetUsd}.</li>
        </ul>
      </Card>
    </div>
  );
}
