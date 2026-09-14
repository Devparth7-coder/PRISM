/** Google Gemini provider using the Generative Language REST API. */
import { config } from "../../config";
import { costFor, type AIProvider, type ChatMessage, type GenerateResult, type StructuredRequest, type Usage } from "../types";
import { structuredWithRetry } from "../validate";

export class GeminiProvider implements AIProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<GenerateResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent` +
      `?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          maxOutputTokens: opts?.maxTokens ?? 2000,
          temperature: opts?.temperature ?? 0.1,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const usage: Usage = {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      model: this.model,
      provider: this.id,
      costUsd: costFor(this.model, json.usageMetadata?.promptTokenCount ?? 0, json.usageMetadata?.candidatesTokenCount ?? 0),
    };
    return { text, usage };
  }

  structuredOutput<T>(req: StructuredRequest<T>) {
    return structuredWithRetry(this, req);
  }
}

export function createGeminiProviderIfConfigured(): GeminiProvider | null {
  const { apiKey, model } = config.ai.gemini;
  return apiKey ? new GeminiProvider(apiKey, model) : null;
}
