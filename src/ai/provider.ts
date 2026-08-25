/**
 * Provider-agnostic AI surface. Nothing outside `src/ai/providers/` may import a vendor
 * SDK, which is what makes swapping Gemini for another model a one-file change.
 */

export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
}

export interface AIToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AIToolResult {
  name: string;
  /** Serialised tool output handed back to the model. */
  response: Record<string, unknown>;
}

export type AITurn =
  | { kind: 'user'; text: string }
  | { kind: 'model'; text?: string; toolCalls?: AIToolCall[] }
  | { kind: 'tool'; results: AIToolResult[] };

export interface AIToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type ModelTier = 'main' | 'fast';

export interface AIGenerateRequest {
  /** System instruction. Assembled by `promptBuilder`, never by callers. */
  system?: string;
  turns: AITurn[];
  tools?: AIToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
  tier?: ModelTier;
  /** When set the provider must return JSON matching this schema (and no tools). */
  responseSchema?: JsonSchema;
  signal?: AbortSignal;
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AIGenerateResult {
  text: string;
  toolCalls: AIToolCall[];
  usage: AIUsage;
  model: string;
  finishReason?: string;
}

export interface AIHealth {
  ok: boolean;
  detail?: string;
}

export interface AIProvider {
  readonly name: string;
  /** Model id used for a tier, for logging and telemetry. */
  modelFor(tier: ModelTier): string;
  generate(request: AIGenerateRequest): Promise<AIGenerateResult>;
  /** Structured output helper: validates nothing, only guarantees parsed JSON. */
  generateJson<T = unknown>(request: AIGenerateRequest & { responseSchema: JsonSchema }): Promise<T>;
  health(): Promise<AIHealth>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Extract the first JSON object/array from a model reply that may include prose or fences. */
export function parseJsonLoose<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    throw new AIProviderError('Model did not return parseable JSON');
  }
}
