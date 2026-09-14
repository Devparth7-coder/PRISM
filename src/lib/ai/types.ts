/**
 * AIProvider abstraction. Business logic depends ONLY on this interface —
 * OpenAI-compatible APIs, Gemini, Anthropic, or the local deterministic
 * analyzer can back it. Credentials come exclusively from environment config.
 */
import type { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  costUsd: number;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
}

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  /** Context label for logs (never contains secrets). */
  task: string;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  /** False when credentials are absent — callers must fall back, never fake. */
  readonly available: boolean;
  generate(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<GenerateResult>;
  structuredOutput<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: Usage }>;
}

/** Rough per-model USD pricing per 1M tokens (in, out). Keep conservative. */
export const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4-turbo": { in: 10, out: 30 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
  "gemini-1.5-pro": { in: 1.25, out: 5 },
  "claude-3-5-sonnet-latest": { in: 3, out: 15 },
  "claude-3-5-haiku-latest": { in: 0.8, out: 4 },
};

export function costFor(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICING).find((k) => model.includes(k)) ?? Object.keys(PRICING)[0]!;
  const p = PRICING[key]!;
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
}

export const LOCAL_PROVIDER_ID = "local-deterministic";
