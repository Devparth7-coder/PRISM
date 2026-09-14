# Security Policy

## Overview

PRISM (Pull Request Intelligence & Review Mesh) reviews untrusted pull request
code for a living. Security is therefore a first-class design constraint, not
an add-on. This document describes the threat model, the guarantees PRISM
makes, and how to report vulnerabilities responsibly.

Maintainer: **Dev Parth**

## Supported versions

| Version | Supported |
|---|---|
| Latest `main` | ✅ |
| Tagged releases | ✅ Latest minor; older on a best-effort basis |
| Forks / modified deployments | ⚠️ Supported only for upstream-reproducible issues |

## Security guarantees by design

### No execution of pull request code

PRISM **never executes, evaluates, `require()`s, `import()`s, or shells out to
code from a reviewed pull request.** Analysis is performed over source text:
parsing, pattern/taint rules, dependency manifest inspection, and model
prompts built from file contents. Consequently, a malicious pull request
cannot compromise the PRISM host through the review path. Optional external
tools (e.g. `semgrep`, `eslint`, `tsc`) are invoked only when explicitly
present on the operator's allow-listed PATH, with bounded timeouts
(`PRISM_TOOL_TIMEOUT_MS`); operators who require hard isolation should run the
worker in a locked-down container.

### Secrets handling

- All credentials (GitHub App key, webhook secret, OAuth secret, AI provider
  keys) are supplied exclusively through environment variables or mounted key
  files (`*_PATH`). PRISM never reads secrets out of the repositories it
  reviews, and a built-in secret scanner flags credentials committed to PRs.
- Secrets are redacted from structured logs; tokens never appear in findings,
  artifacts, Copilot answers, or review comments.
- `.env` files are not committed; `.env.example` contains placeholders only.

### GitHub integration

- Incoming webhooks are verified using the GitHub App **HMAC webhook secret**
  before any processing; requests with invalid or missing signatures are
  rejected.
- Reviews are **pinned to full commit SHAs** with immutable,
  content-addressed snapshots — a force-push cannot retroactively alter a
  published review or its evidence.
- Webhook handling is **idempotent** (`(installation, repo, PR, SHA)` keyed
  with job dedupe), so GitHub retries cannot trigger duplicate reviews.
- The GitHub App private key signs short-lived installation tokens only;
  least-privilege permissions are documented in the README.

### AI / LLM boundary

- AI responses are treated as **untrusted input**: every structured response
  must pass Zod schema validation or it is discarded.
- Model findings cannot become merge-blocking on their own when policy requires
  deterministic corroboration; each claim is bound to file/line evidence.
- Token ceilings (`PRISM_MAX_AI_TOKENS`) and cost budgets
  (`PRISM_AI_COST_BUDGET_USD`) bound spend and prompt size per review.
- Provider keys are sent only to the configured provider endpoint; reviewed
  source is sent to whichever provider the operator explicitly configures.
- PRISM never exposes private chain-of-thought. The observability surfaces
  (and this policy considers anything else a bug) show only decision
  summaries, inputs, outputs, tools invoked, evidence, and status.

### Authorization and tenancy

- Every API route and dashboard page serving tenant data enforces
  authentication and organization/repository-scoped authorization
  (installation → organization → repository membership).
- **DEMO MODE** data (the bundled fixture repository) is hard-partitioned from
  connected repositories and never shares sessions, repositories, or results.
- Dashboard sessions use signed, `httpOnly`, `SameSite=Lax` cookies. Set a
  strong `PRISM_SESSION_SECRET` (`openssl rand -hex 32`) in production.

### Jobs and abuse resistance

- The review pipeline runs through a durable queue with retries, exponential
  backoff + jitter, idempotency keys, stale-job recovery, and a dead-letter
  queue, limiting the impact of malformed events and provider outages.
- Blob and snapshot reads are SHA-keyed and cached; state transitions are safe
  to replay.

## Deployment hardening checklist

- [ ] Run with `NODE_ENV=production` and a unique `PRISM_SESSION_SECRET`.
- [ ] Serve exclusively over HTTPS (required for GitHub webhooks/OAuth).
- [ ] Run the standalone worker (`npm run worker`) under a least-privilege
      service account; keep it off the public network.
- [ ] Use filesystem permissions `0600` for the GitHub App PEM and env files.
- [ ] Pin a supported Node.js LTS release and keep dependencies current
      (`npm audit`).
- [ ] Restrict `PRISM_MODE=live` to deployments with real credentials; leave
      unconfigured environments in DEMO MODE (the default).
- [ ] Back up the database/SQLite file and protect it (it contains review data,
      not credentials).
- [ ] If enabling external static tools, run the worker inside a container
      with no network access to internal systems beyond the AI provider.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately through one of:

1. **GitHub** → repository **Security** tab → **Report a vulnerability**
   (preferred; creates a private advisory), or
2. Email **Dev Parth** via the address shown on the GitHub profile, with
   subject beginning `[PRISM SECURITY]`.

Include:

- A description of the issue and its security impact
- Steps to reproduce (proof-of-concept appreciated, exercised only against your
  own test installations and fixture repositories)
- Affected commit/tag and deployment configuration
- Any suggested remediation

### Response commitment

- Acknowledgement within **72 hours**
- Initial triage and severity assessment within **7 days**
- Credit in the release notes/advisory for reporters who wish to be named
- Coordinated disclosure: fixes are released (or a mitigation published)
  before public details, unless both sides agree otherwise

## Out of scope

- Vulnerabilities in third-party services (GitHub, AI providers) — report to
  those vendors.
- Attacks requiring an already-compromised operator machine, leaked operator
  credentials, or deliberate operator misconfiguration (e.g. committing real
  secrets, running with weak session secrets).
- Self-XSS, missing hardening headers on explicitly local-only development
  servers, and reports from automated scanners without demonstrated impact.
- Theoretical model "jailbreaks" that only alter prose in a Copilot answer
  without bypassing schema validation, evidence binding, or authorization;
  prompt-injection findings that demonstrably change findings, bypass the
  critic, or exfiltrate data **are** in scope.

---

Copyright © 2026 **Dev Parth**.
