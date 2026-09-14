import type { ZodType } from "zod";
import { log } from "../logger";
import type { AIProvider, ChatMessage, Usage } from "./types";

/** Extract the first balanced JSON object/array from a model response. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("No JSON object in model response");
  let depth = 0;
  const open = body[start]!;
  const close = open === "{" ? "}" : "]";
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    if (body[i] === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(body.slice(start, i + 1));
      }
    }
  }
  throw new Error("Unbalanced JSON in model response");
}

/**
 * Structured output with validation + ONE repair retry. Malformed model output
 * is rejected and retried with the validation error; repeated failure throws
 * so the orchestrator can degrade to deterministic results rather than
 * persisting hallucinated shapes.
 */
export async function structuredWithRetry<T>(
  provider: AIProvider,
  req: { system: string; user: string; schema: ZodType<T>; maxTokens?: number; temperature?: number; task: string },
): Promise<{ data: T; usage: Usage }> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${req.system}\n\nRespond with a single JSON value and nothing else. It MUST satisfy this TypeScript schema:\n${zodToHint(req.schema)}` },
    { role: "user", content: req.user },
  ];
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.generate(messages, {
      maxTokens: req.maxTokens ?? 4000,
      temperature: req.temperature ?? 0.1,
    });
    try {
      const parsed = extractJson(result.text);
      const data = req.schema.parse(parsed);
      return { data, usage: result.usage };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      log.warn("structured output validation failed; retrying", {
        task: req.task,
        attempt,
        error: lastErr.slice(0, 300),
      });
      messages.push({ role: "assistant", content: result.text.slice(0, 4000) });
      messages.push({
        role: "user",
        content: `Your previous response was invalid: ${lastErr.slice(0, 800)}. Respond again with corrected JSON only.`,
      });
    }
  }
  throw new Error(`Model output failed schema validation for task "${req.task}": ${lastErr.slice(0, 300)}`);
}

/** Crude schema hint rendered into the prompt (keeps providers honest). */
function zodToHint(schema: ZodType<unknown>): string {
  try {
    const shape = (schema as unknown as { _def?: { shape?: Record<string, unknown> } })._def?.shape;
    if (shape) {
      return `{ ${Object.keys(shape).join(", ")} }`;
    }
  } catch {
    /* ignore */
  }
  return "(validated by server-side schema; malformed responses are rejected)";
}
