/** Anthropic Messages API provider. */
import { config } from "../../config";
import { costFor, type AIProvider, type ChatMessage, type GenerateResult, type StructuredRequest, type Usage } from "../types";
import { structuredWithRetry } from "../validate";

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<GenerateResult> {
    // Anthropic requires the first message to be user; fold the system prompt out.
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages.filter((m) => m.role !== "system");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts?.maxTokens ?? 2000,
        temperature: opts?.temperature ?? 0.1,
        system,
        messages: convo.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
    const usage: Usage = {
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      model: this.model,
      provider: this.id,
      costUsd: costFor(this.model, json.usage?.input_tokens ?? 0, json.usage?.output_tokens ?? 0),
    };
    return { text, usage };
  }

  structuredOutput<T>(req: StructuredRequest<T>) {
    return structuredWithRetry(this, req);
  }
}

export function createAnthropicProviderIfConfigured(): AnthropicProvider | null {
  const { apiKey, model } = config.ai.anthropic;
  return apiKey ? new AnthropicProvider(apiKey, model) : null;
}
