/**
 * Provider routing: selects a configured provider based on PRISM_AI_PROVIDER
 * preference (auto picks the first configured). When NO provider has
 * credentials, agents transparently run in LOCAL deterministic mode — the
 * pipeline still executes end to end with rule-based findings.
 */
import { config } from "../config";
import type { AIProvider } from "./types";
import { LOCAL_PROVIDER_ID } from "./types";
import { createOpenAIProviderIfConfigured } from "./providers/openai";
import { createGeminiProviderIfConfigured } from "./providers/gemini";
import { createAnthropicProviderIfConfigured } from "./providers/anthropic";
import { LocalDeterministicProvider } from "./providers/local";

export interface ProviderChoice {
  provider: AIProvider;
  isLocal: boolean;
  /** Names of providers that had no credentials. */
  unavailable: string[];
}

export function selectProvider(): ProviderChoice {
  const unavailable: string[] = [];
  const candidates: Record<string, AIProvider | null> = {
    openai: createOpenAIProviderIfConfigured(),
    gemini: createGeminiProviderIfConfigured(),
    anthropic: createAnthropicProviderIfConfigured(),
  };
  for (const [name, p] of Object.entries(candidates)) if (!p) unavailable.push(name);

  const pref = config.ai.preference;
  let chosen: AIProvider | null = null;
  if (pref !== "auto" && candidates[pref]) chosen = candidates[pref];
  if (!chosen) chosen = Object.values(candidates).find((c): c is AIProvider => Boolean(c)) ?? null;

  if (!chosen) {
    return { provider: new LocalDeterministicProvider(), isLocal: true, unavailable };
  }
  return { provider: chosen, isLocal: false, unavailable };
}

export { LOCAL_PROVIDER_ID };
