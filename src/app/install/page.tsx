import Link from "next/link";
import type { Metadata } from "next";
import { config, hasGitHubApp, hasWebhookSecret } from "@/lib/config";
import { DemoButton } from "@/components/DemoButton";
import { LogoMark } from "@/components/Logo";
import { Check, ExternalLink, Copy } from "lucide-react";
import { CopyBox } from "@/components/CopyBox";

export const metadata: Metadata = { title: "Install" };

const PERMISSIONS = [
  { area: "Repository administration", perms: "Contents: Read-only", reason: "Read files, manifests and diffs at a pinned SHA" },
  { area: "Pull requests", perms: "Pull requests: Read & Write", reason: "Post inline review comments and the summary review" },
  { area: "Metadata", perms: "Metadata: Read-only", reason: "Required with every GitHub App" },
  { area: "Checks (optional)", perms: "Commit statuses / Checks: Read & Write", reason: "Required only if you want merge-blocking checks" },
];

const EVENTS = ["pull_request", "pull_request_review", "pull_request_review_comment", "installation", "installation_repositories"];

export default function InstallPage() {
  const webhookUrl = `${config.baseUrl}/api/webhooks/github`;
  const configured = hasGitHubApp();
  const secretSet = hasWebhookSecret();

  const manifest = {
    name: "PRISM",
    url: config.baseUrl,
    hook_attributes: { url: webhookUrl },
    redirect_url: `${config.baseUrl}/install`,
    callback_urls: [`${config.baseUrl}/api/auth/github/callback`],
    public: false,
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "write",
      statuses: "write",
    },
    default_events: EVENTS,
  };

  return (
    <div className="min-h-screen bg-graphite-950">
      <header className="border-b border-graphite-800">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-[0.18em]">
            <LogoMark className="h-6 w-6" /> PRISM
          </Link>
          <Link href="/docs" className="text-xs text-graphite-300 hover:text-graphite-100">
            Docs
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight text-graphite-50">Install the PRISM GitHub App</h1>
        <p className="mt-2 text-sm text-graphite-300">
          First review in under five minutes: create the app, configure the webhook, select a repository, open a PR.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Status ok={configured} label="GitHub App credentials" detail={configured ? "App ID + private key configured" : "Not configured yet"} />
          <Status ok={secretSet} label="Webhook secret" detail={secretSet ? "HMAC verification active" : "Required — unsigned deliveries are rejected"} />
        </div>

        <ol className="mt-10 space-y-8">
          <Step n={1} title="Create the GitHub App">
            <p className="text-xs leading-relaxed text-graphite-400">
              Create the app from the manifest below (GitHub pre-fills permissions and events) at{" "}
              <Link className="text-graphite-100 underline decoration-graphite-600" href="https://github.com/settings/apps/new?type=organization">
                github.com/settings/apps/new
              </Link>
              , then note the <strong className="text-graphite-100">App ID</strong> and download the private key.
            </p>
            <CopyBox label="app-manifest.json" value={JSON.stringify(manifest, null, 2)} />
          </Step>

          <Step n={2} title="Configure environment variables">
            <CopyBox
              label=".env"
              value={[
                "PRISM_MODE=live",
                "PRISM_BASE_URL=https://your-prism.example.com",
                "GITHUB_APP_ID=123456",
                'GITHUB_APP_PRIVATE_KEY_PATH="/secrets/prism.private-key.pem"',
                "GITHUB_WEBHOOK_SECRET=paste-the-webhook-secret",
                "GITHUB_OAUTH_CLIENT_ID=Iv1....",
                "GITHUB_OAUTH_CLIENT_SECRET=....",
                "# At least one AI provider (omit all to run deterministic-only):",
                "OPENAI_API_KEY=sk-...",
              ].join("\n")}
            />
            <p className="mt-2 text-[11px] text-graphite-500">
              Private keys are read from env or disk, never stored in the database. Tokens are never logged or
              passed to PR code.
            </p>
          </Step>

          <Step n={3} title="Set the webhook URL & events">
            <CopyBox label="Webhook URL" value={webhookUrl} />
            <ul className="mt-3 space-y-1.5">
              {EVENTS.map((e) => (
                <li key={e} className="flex items-center gap-2 text-xs text-graphite-300">
                  <Check className="h-3.5 w-3.5 text-prism-green" /> <code className="font-mono text-graphite-200">{e}</code>
                </li>
              ))}
            </ul>
          </Step>

          <Step n={4} title="Permissions (least privilege)">
            <div className="overflow-hidden rounded-md border border-graphite-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-graphite-900 text-[10px] uppercase tracking-wider text-graphite-400">
                  <tr>
                    <th className="th">Area</th>
                    <th className="th">Permission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-graphite-800">
                  {PERMISSIONS.map((p) => (
                    <tr key={p.area}>
                      <td className="td align-top font-medium text-graphite-100">{p.area}</td>
                      <td className="td text-graphite-300">{p.perms}<div className="text-[11px] text-graphite-500">{p.reason}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Step>

          <Step n={5} title="Install & open a pull request">
            <p className="text-xs leading-relaxed text-graphite-400">
              Install the app on selected repositories. On the next PR event PRISM verifies the signature, persists the
              event, enqueues a review and streams progress to the dashboard. Re-running on synchronize compares fixed,
              persistent and new findings.
            </p>
          </Step>
        </ol>

        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-lg border border-amber-900/50 bg-amber-950/20 p-5">
          <ExternalLink className="h-4 w-4 text-amber-400" />
          <p className="flex-1 text-xs text-amber-200/90">
            No GitHub to hand? The demo runs the identical pipeline (webhook → queue → context → agents → critic →
            evidence → risk → simulated GitHub payload) against a seeded repository, fully labeled DEMO.
          </p>
          <DemoButton label="Launch demo" variant="primary" />
        </div>
      </main>
    </div>
  );
}

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-lg border p-4 ${ok ? "border-green-900/60 bg-green-950/20" : "border-graphite-700 bg-graphite-900"}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-graphite-100">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-prism-green" : "bg-graphite-500"}`} />
        {label}
      </div>
      <div className="mt-1 text-[11px] text-graphite-400">{detail}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-prism-red/60 bg-red-950/50 text-xs font-bold text-prism-red">{n}</span>
        <h2 className="pt-0.5 text-sm font-semibold text-graphite-100">{title}</h2>
      </div>
      <div>{children}</div>
    </li>
  );
}
