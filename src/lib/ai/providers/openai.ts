/**
 * OpenAI-compatible Chat Completions provider. Works with api.openai.com and
 * any compatible endpoint (Together, Groq, OpenRouter, vLLM, Ollama /v1).
 */
import { config } from "../../config";
import { log } from "../../logger";
import { structuredWithRetry } from "../validate";
import { costFor, type AIProvider, type ChatMessage, type GenerateResult, type StructuredRequest, type Usage } from "../types";

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai";
  readonly label = "OpenAI-compatible";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }): Promise<GenerateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    opts?.signal?.addEventListener("abort", () => controller.abort());
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: opts?.maxTokens ?? 2000,
          temperature: opts?.temperature ?? 0.1,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenAI-compatible API ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      const usage: Usage = {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        model: this.model,
        provider: this.id,
        costUsd: costFor(this.model, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0),
      };
      return { text, usage };
    } catch (err) {
      log.error("openai provider call failed", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  structuredOutput<T>(req: StructuredRequest<T>) {
    return structuredWithRetry(this, req);
  }
}

export function createOpenAIProviderIfConfigured(): OpenAICompatibleProvider | null {
  const { apiKey, baseUrl, model } = config.ai.openai;
  if (!apiKey) return null;
  return new OpenAICompatibleProvider(apiKey, baseUrl, model);
}
