/**
 * Local "provider" — NOT a fake LLM. It signals that no model credentials are
 * configured; agents then run their deterministic/heuristic analysis paths
 * only (real detector results, clearly labeled DETERMINISTIC). Calling the
 * generation methods here throws so no code path can mistake heuristics for a
 * language model.
 */
import { LOCAL_PROVIDER_ID, type AIProvider, type ChatMessage, type GenerateResult, type StructuredRequest } from "../types";

export class LocalProviderError extends Error {
  constructor() {
    super("No AI provider credentials configured — running local deterministic analysis only.");
    this.name = "LocalProviderError";
  }
}

export class LocalDeterministicProvider implements AIProvider {
  readonly id = LOCAL_PROVIDER_ID;
  readonly label = "Local deterministic analyzer (no LLM)";
  readonly model = "local-rules-v1";
  readonly available = true;

  async generate(_messages: ChatMessage[]): Promise<GenerateResult> {
    throw new LocalProviderError();
  }
  async structuredOutput<T>(_req: StructuredRequest<T>): Promise<{ data: T; usage: never }> {
    throw new LocalProviderError();
  }
}
