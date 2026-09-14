/**
 * Centralized, read-only environment configuration.
 * Nothing here is hardcoded with real secrets. Every integration is opt-in
 * via environment variables; absent credentials degrade to clearly-labeled
 * DEMO MODE behavior instead of pretending integrations are live.
 */

function req(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || Number.isNaN(Number(v))) return fallback;
  return Number(v);
}

export type ReviewMode = "fast" | "standard" | "deep" | "security" | "test";

export const config = {
  env: req("NODE_ENV", "development"),
  isProd: req("NODE_ENV") === "production",
  baseUrl: req("PRISM_BASE_URL", "http://localhost:3000"),
  sessionSecret: req("PRISM_SESSION_SECRET", "prism-insecure-dev-secret-change-me"),
  databasePath: req("PRISM_DATABASE_PATH", "./data/prism.sqlite"),
  /** demo = bundled fixtures only; live = connected GitHub repositories */
  mode: (req("PRISM_MODE", "demo") === "live" ? "live" : "demo") as "demo" | "live",
  logLevel: req("LOG_LEVEL", "info"),
  retentionDays: num("PRISM_RETENTION_DAYS", 90),
  toolTimeoutMs: num("PRISM_TOOL_TIMEOUT_MS", 60_000),
  reviewMode: req("PRISM_REVIEW_MODE", "standard") as ReviewMode,
  maxAiTokens: num("PRISM_MAX_AI_TOKENS", 120_000),
  aiCostBudgetUsd: num("PRISM_AI_COST_BUDGET_USD", 2),
  redisUrl: req("REDIS_URL"),
  github: {
    appId: req("GITHUB_APP_ID"),
    privateKey: req("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    privateKeyPath: req("GITHUB_APP_PRIVATE_KEY_PATH"),
    webhookSecret: req("GITHUB_WEBHOOK_SECRET"),
    oauthClientId: req("GITHUB_OAUTH_CLIENT_ID"),
    oauthClientSecret: req("GITHUB_OAUTH_CLIENT_SECRET"),
  },
  ai: {
    preference: req("PRISM_AI_PROVIDER", "auto"),
    openai: {
      apiKey: req("OPENAI_API_KEY"),
      baseUrl: req("OPENAI_BASE_URL", "https://api.openai.com/v1"),
      model: req("OPENAI_MODEL", "gpt-4o-mini"),
    },
    gemini: { apiKey: req("GEMINI_API_KEY"), model: req("GEMINI_MODEL", "gemini-1.5-flash") },
    anthropic: { apiKey: req("ANTHROPIC_API_KEY"), model: req("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest") },
  },
} as const;

export function hasGitHubApp(): boolean {
  return Boolean(config.github.appId && (config.github.privateKey || config.github.privateKeyPath));
}

export function hasWebhookSecret(): boolean {
  return Boolean(config.github.webhookSecret);
}
