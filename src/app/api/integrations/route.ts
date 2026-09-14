import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listWebhooks } from "@/lib/db/repo/governance";
import { listDeadJobs, listRecentJobs, retryDeadJob } from "@/lib/db/repo/jobs";
import { config, hasGitHubApp, hasWebhookSecret } from "@/lib/config";
import { selectProvider } from "@/lib/ai/router";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireUser();
    const provider = selectProvider();
    return NextResponse.json({
      mode: config.mode,
      github: {
        appConfigured: hasGitHubApp(),
        webhookSecretConfigured: hasWebhookSecret(),
        oauthConfigured: Boolean(config.github.oauthClientId),
        callbackUrl: `${config.baseUrl}/api/webhooks/github`,
        requiredPermissions: [
          "Pull requests: Read & Write",
          "Contents: Read-only",
          "Metadata: Read-only",
          "Commit statuses: Read & Write (optional, checks)",
        ],
        requiredEvents: ["pull_request", "pull_request_review", "pull_request_review_comment", "installation", "installation_repositories"],
      },
      ai: {
        activeProvider: provider.provider.id,
        activeLabel: provider.provider.label,
        model: provider.provider.model,
        isLocal: provider.isLocal,
        unavailable: provider.unavailable,
        providers: {
          openai: Boolean(config.ai.openai.apiKey),
          gemini: Boolean(config.ai.gemini.apiKey),
          anthropic: Boolean(config.ai.anthropic.apiKey),
        },
      },
      jobs: listRecentJobs(30),
      deadJobs: listDeadJobs(),
      webhooks: listWebhooks(30),
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: Request) {
  try {
    requireUser();
    const body = (await req.json().catch(() => ({}))) as { retryDeadJob?: string };
    if (body.retryDeadJob) {
      retryDeadJob(body.retryDeadJob);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return apiError(err);
  }
}
