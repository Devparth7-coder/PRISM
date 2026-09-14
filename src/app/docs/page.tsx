import Link from "next/link";
import type { Metadata } from "next";
import { LogoMark } from "@/components/Logo";
import { DemoButton } from "@/components/DemoButton";
import { CopyBox } from "@/components/CopyBox";

export const metadata = { title: "Docs" };

const ENV = [
  ["PRISM_MODE", "demo | live", "demo", "live enables real GitHub ingestion; demo labels all simulated data"],
  ["PRISM_BASE_URL", "url", "http://localhost:3000", "Public URL used for webhook and OAuth callbacks"],
  ["PRISM_DATABASE_PATH", "path", "./data/prism.sqlite", "SQLite database location"],
  ["PRISM_SESSION_SECRET", "secret", "dev default (insecure)", "Required in production for signed cookies"],
  ["GITHUB_APP_ID", "string", "—", "From the App settings page"],
  ["GITHUB_APP_PRIVATE_KEY", "PEM", "—", "Full PEM contents (\\n escaped), alternatively use _PATH"],
  ["GITHUB_APP_PRIVATE_KEY_PATH", "path", "—", "Path to the PEM file on disk"],
  ["GITHUB_WEBHOOK_SECRET", "secret", "—", "Reject unsigned webhooks in live mode"],
  ["GITHUB_OAUTH_CLIENT_ID / _SECRET", "string", "—", "Enables Sign in with GitHub for the dashboard"],
  ["OPENAI_API_KEY", "secret", "—", "Enables OpenAI-backed agents"],
  ["GEMINI_API_KEY", "secret", "—", "Enables Gemini-backed agents"],
  ["ANTHROPIC_API_KEY", "secret", "—", "Enables Anthropic-backed agents"],
  ["PRISM_AI_PROVIDER", "auto|openai|gemini|anthropic", "auto", "Provider preference"],
  ["PRISM_AI_COST_BUDGET_USD", "number", "2", "Per-review spend ceiling"],
];

const SECTIONS = [
  ["#architecture", "Architecture"],
  ["#pipeline", "Pipeline stages"],
  ["#finding-schema", "Finding schema & evidence chain"],
  ["#api", "HTTP API"],
  ["#env", "Environment variables"],
  ["#local", "Local development"],
  ["#demo", "Guided demo"],
  ["#limits", "Limitations & roadmap"],
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-graphite-950">
      <header className="sticky top-0 z-10 border-b border-graphite-800 bg-graphite-950/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-[0.18em]">
            <LogoMark className="h-6 w-6" /> PRISM
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/install" className="text-xs text-graphite-300 hover:text-graphite-100">Install</Link>
            <Link href="/login" className="text-xs text-graphite-300 hover:text-graphite-100">Sign in</Link>
            <DemoButton label="Live demo" />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[180px_1fr]">
        <nav className="hidden space-y-1.5 lg:sticky lg:top-24 lg:block lg:self-start">
          {SECTIONS.map(([href, label]) => (
            <a key={href} href={href} className="block text-xs text-graphite-400 hover:text-graphite-100">{label}</a>
          ))}
        </nav>

        <article className="max-w-3xl space-y-12 text-sm leading-relaxed text-graphite-300">
          <header>
            <h1 className="text-3xl font-bold tracking-tight text-graphite-50">PRISM documentation</h1>
            <p className="mt-2">
              Deterministic-first, evidence-grounded AI code review for pull requests. PRISM runs static analysis
              before any LLM, grounds every agent in real repository context, adversarially verifies high-severity
              findings, and shows you the complete chain of evidence for every decision.
            </p>
          </header>

          <Section id="architecture" title="Architecture">
            <ul>
              <li><b>Next.js 14 App Router</b> — dashboard, JSON API, SSE streams, public pages.</li>
              <li><b>SQLite + better-sqlite3</b> — all state (events, findings, jobs, memory, analytics). No external services required.</li>
              <li><b>Background worker</b> — durable job queue with idempotency keys, retries with exponential backoff, stale-job recovery and a dead-letter queue.</li>
              <li><b>GitHub App</b> — webhook ingestion with HMAC verification, installation tokens, inline + summary review publication.</li>
              <li><b>Provider-agnostic AI layer</b> — OpenAI / Gemini / Anthropic via a single interface; with no key set, agents are skipped and deterministic analysis still runs.</li>
            </ul>
            <p>
              Multi-tenancy starts at the database: users belong to organizations that own repositories, and every
              tenant-scoped query is constrained through <code className="mono">authorizedRepoIds()</code>. Requests
              carry a correlation ID that is attached to every log line.
            </p>
          </Section>

          <Section id="pipeline" title="Pipeline stages">
            <ol className="space-y-2">
              <li><b>QUEUED → INGESTING.</b> Webhook verified and persisted; PR metadata, diff hunks and file trees snapshotted at the exact head SHA. Snapshots and analysis are cached by SHA.</li>
              <li><b>CONTEXT.</b> Repository profile (languages, frameworks, CI, test framework, architecture hints), code graph (imports/calls/tests), package manifests, conventions and repository memory.</li>
              <li><b>STATIC_ANALYSIS.</b> Deterministic engines first: AST rules, secret scanning, advisory/vulnerability matching, dependency checks, test-coverage gaps.</li>
              <li><b>AGENTS.</b> Seven specialists (bug, security, performance, maintainability, tests, API contract, dependencies) receive only grounded snippets and graph neighbors, and must return schema-validated JSON. Invalid JSON is retried then rejected — it never becomes a finding.</li>
              <li><b>CRITIC.</b> Every HIGH/CRITICAL finding is adversarially challenged: verdict CONFIRMED, WEAK, FALSE_POSITIVE or UNCERTAIN. Non-confirmed findings are downgraded or dropped.</li>
              <li><b>VERIFICATION.</b> Evidence verifier checks that findings reference changed lines, carry deterministic or graph evidence, and are not duplicates (fingerprint + similarity dedupe).</li>
              <li><b>RISK.</b> Weighted 0–100 risk score across security, correctness, performance, maintainability, testing, dependencies and change scope.</li>
              <li><b>SYNTHESIS.</b> De-duplicated, policy-mapped summary; Markdown and JSON artifacts; generated route tests when gaps are found.</li>
              <li><b>PUBLISHING.</b> Inline comments and the summary review posted to GitHub per policy; in demo mode the payload is stored and shown in the UI instead.</li>
            </ol>
          </Section>

          <Section id="finding-schema" title="Finding schema & evidence chain">
            <p>Each finding is structured JSON: severity, category, title, description, exact file and line range, confidence, evidence items, impact, recommendation, optional suggested patch, detector provenance and owning agent. Every finding page presents the chain:</p>
            <div className="my-3 rounded-lg border border-graphite-700 bg-graphite-900 p-3 font-mono text-[11px] text-graphite-300">
              Finding → changed code → related code → repo context → deterministic evidence → AI analysis → critic verification → recommendation
            </div>
            <p>
              Findings are labeled <code className="mono">DETERMINISTIC</code>, <code className="mono">AI-DETECTED</code> or{" "}
              <code className="mono">HYBRID</code>. Re-reviews fingerprint each finding and mark it{" "}
              <b className="text-green-300">FIXED</b>, <b className="text-amber-300">PERSISTED</b> or <b className="text-red-300">NEW</b>.
              Triage decisions (false positive, accepted risk) are written to repository memory.
            </p>
            <CopyBox label="finding.json (abridged)" value={`{
  "severity": "CRITICAL",
  "category": "SECURITY",
  "title": "SQL injection via raw query interpolation",
  "file": "src/routes/members.ts",
  "lineStart": 51,
  "lineEnd": 56,
  "confidence": 0.97,
  "detector": "hybrid",
  "agent": "security_reviewer",
  "evidence": [
    { "kind": "changed_line", "file": "src/routes/members.ts", "line": 51,
      "label": "user input flows into raw SQL",
      "detail": "db.query(\`SELECT * FROM members WHERE role='\${role}'\`)" },
    { "kind": "static_tool", "label": "rules-engine: sql-interpolation",
      "detail": "Template literal containing request parameter inside db.query()" }
  ],
  "recommendation": "Use parameterized queries; never interpolate request input into SQL."
}`} />
          </Section>

          <Section id="api" title="HTTP API">
            <div className="overflow-hidden rounded-lg border border-graphite-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-graphite-900 text-[10px] uppercase tracking-wider text-graphite-400">
                  <tr><th className="th">Method & path</th><th className="th">Purpose</th></tr>
                </thead>
                <tbody className="divide-y divide-graphite-800">
                  {[
                    ["POST /api/webhooks/github", "Verified GitHub App webhook ingress (HMAC)"],
                    ["GET /api/auth/github · /callback", "OAuth sign-in"],
                    ["POST /api/reviews", "Manual review trigger ({prId,mode,force} or live owner/repo/number)"],
                    ["GET /api/reviews/:id", "Full review detail (findings, evidence, risk, artifacts)"],
                    ["GET /api/reviews/:id/events", "SSE stream of persisted pipeline events"],
                    ["POST /api/reviews/:id/retry", "Re-queue a failed/stale review"],
                    ["GET /api/findings · PATCH /api/findings/:id", "Filtered query; triage (false_positive / accepted_risk / …)"],
                    ["GET /api/artifacts/:id", "Download Markdown summary, JSON report, generated tests"],
                    ["GET/PUT /api/policies", "Severity mapping, gates, path reviewers"],
                    ["GET/POST /api/rules · /api/memory", "Repository rules and learned memory"],
                    ["POST /api/copilot", "Grounded Q&A over real tenant data (rate limited)"],
                    ["GET /api/search", "Command palette index (⌘K)"],
                    ["GET/POST /api/integrations", "Connection status; dead-letter retry"],
                    ["POST /api/demo/bootstrap · /demo/fix", "Seed the demo PR; simulate an author fix push"],
                  ].map(([m, d]) => (
                    <tr key={m}>
                      <td className="td align-top font-mono text-[11px] text-graphite-200">{m}</td>
                      <td className="td text-graphite-400">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="env" title="Environment variables">
            <div className="overflow-x-auto rounded-lg border border-graphite-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-graphite-900 text-[10px] uppercase tracking-wider text-graphite-400">
                  <tr><th className="th">Variable</th><th className="th">Values</th><th className="th">Default</th><th className="th">Notes</th></tr>
                </thead>
                <tbody className="divide-y divide-graphite-800">
                  {ENV.map(([n, v, d, note]) => (
                    <tr key={n}>
                      <td className="td font-mono text-[10.5px] text-graphite-200">{n}</td>
                      <td className="td text-graphite-400">{v}</td>
                      <td className="td font-mono text-[10.5px] text-graphite-500">{d}</td>
                      <td className="td text-graphite-400">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="local" title="Local development">
            <CopyBox label="terminal" value={`cp .env.example .env          # optional: add AI keys later
npm install
npm run db:migrate           # create SQLite schema
npm run demo:seed            # seed the flagship demo PR (optional; the UI can bootstrap it too)
npm run dev                  # dashboard, API and in-process worker on http://localhost:3000
# npm run worker             # standalone worker (alternative to the in-process worker)`} />
            <p>Without AI keys PRISM runs deterministic-only and clearly labels the skipped LLM stages — nothing is fabricated.</p>
          </Section>

          <Section id="demo" title="Guided demo">
            <ol className="space-y-2">
              <li>1. Open <b>Demo login</b> — this bootstraps a demo org, repository and PR #184 “Add organization member management API”.</li>
              <li>2. Watch the pipeline live (SSE): static analysis catches SQL injection, missing auth checks, an always-true role check, password hash exposure, an N+1 query, missing tests and the vulnerable lodash 4.17.20.</li>
              <li>3. Open any finding and follow the evidence chain through to the critic verdict and recommendation.</li>
              <li>4. Click <b>Simulate author fix commit</b> — the re-review fingerprints findings as FIXED / PERSISTED / NEW and the risk score drops.</li>
              <li>5. Export the Markdown/JSON artifacts and the generated route tests.</li>
            </ol>
          </Section>

          <Section id="limits" title="Limitations & roadmap">
            <ul>
              <li>Static analysis targets TypeScript/JavaScript idioms plus manifest scanning; language coverage for other ecosystems is intentionally narrow rather than faked.</li>
              <li>Diff and graph extraction is bounded by context budgets; very large monorepo PRs use file-level summaries.</li>
              <li>SQLite suits single-node deployments; the queue is process-local (one worker). Roadmap: Postgres + Redis-backed horizontal workers.</li>
              <li>Checks API publication and auto-fix PRs; IDE extension; Slack/Teams notifications; policy-as-code import; per-agent custom prompts; and SBOM export.</li>
              <li>PRISM never executes pull-request code. Any future sandboxed execution will be opt-in and isolated from all credentials.</li>
            </ul>
            <div className="mt-6">
              <DemoButton label="Launch the live demo" variant="primary" />
            </div>
          </Section>
        </article>
      </main>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 text-lg font-bold tracking-tight text-graphite-50">{title}</h2>
      <div className="space-y-3 [&_ol]:space-y-2 [&_ul]:space-y-2 [&_code]:rounded [&_code]:bg-graphite-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-graphite-200 [&_b]:text-graphite-100">
        {children}
      </div>
    </section>
  );
}
