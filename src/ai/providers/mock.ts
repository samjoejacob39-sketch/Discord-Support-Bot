import {
  parseJsonLoose,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIHealth,
  type AIProvider,
  type AIToolCall,
  type JsonSchema,
  type ModelTier,
} from '../provider.js';

export interface MockScriptEntry {
  text?: string;
  toolCalls?: AIToolCall[];
  json?: unknown;
  /** Throw instead of answering — used to test provider-failure escalation. */
  error?: Error;
}

/**
 * Deterministic provider for tests and offline runs (`AI_PROVIDER=mock`).
 * Queue exact turns with `enqueue()`; when the queue is empty it falls back to a safe,
 * schema-aware default so nothing crashes.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly requests: AIGenerateRequest[] = [];
  private readonly queue: MockScriptEntry[] = [];

  constructor(private readonly defaultReply = 'I can help with that. Could you share a bit more detail?') {}

  enqueue(...entries: MockScriptEntry[]): this {
    this.queue.push(...entries);
    return this;
  }

  reset(): void {
    this.queue.length = 0;
    this.requests.length = 0;
  }

  modelFor(tier: ModelTier): string {
    return tier === 'fast' ? 'mock-fast' : 'mock-main';
  }

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    this.requests.push(request);
    const entry = this.queue.shift();
    if (entry?.error) throw entry.error;

    if (entry) {
      return {
        text: entry.text ?? (entry.json !== undefined ? JSON.stringify(entry.json) : ''),
        toolCalls: entry.toolCalls ?? [],
        usage: { inputTokens: 100, outputTokens: 40 },
        model: this.modelFor(request.tier ?? 'main'),
        finishReason: 'STOP',
      };
    }

    if (request.responseSchema) {
      return {
        text: JSON.stringify(defaultForSchema(request.responseSchema, request)),
        toolCalls: [],
        usage: { inputTokens: 80, outputTokens: 20 },
        model: this.modelFor(request.tier ?? 'fast'),
      };
    }

    const canRespond = request.tools?.some((tool) => tool.name === 'respond_to_user');
    return {
      text: canRespond ? '' : this.defaultReply,
      toolCalls: canRespond
        ? [{ name: 'respond_to_user', args: { message: this.defaultReply, confidence: 'medium' } }]
        : [],
      usage: { inputTokens: 120, outputTokens: 30 },
      model: this.modelFor(request.tier ?? 'main'),
      finishReason: 'STOP',
    };
  }

  async generateJson<T = unknown>(request: AIGenerateRequest & { responseSchema: JsonSchema }): Promise<T> {
    const result = await this.generate(request);
    return parseJsonLoose<T>(result.text);
  }

  async health(): Promise<AIHealth> {
    return { ok: true, detail: 'mock provider (no network calls)' };
  }
}

/** Build a minimally valid object for a schema so callers always get usable JSON. */
function defaultForSchema(schema: JsonSchema, request: AIGenerateRequest): unknown {
  switch (schema.type) {
    case 'object': {
      const output: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        output[key] = defaultForSchema(value, request);
      }
      return output;
    }
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'number':
    case 'integer':
      return schema.minimum ?? 0;
    case 'string':
      if (schema.enum && schema.enum.length > 0) return schema.enum[0];
      return lastUserText(request).slice(0, 60) || 'unknown';
    default:
      return null;
  }
}

function lastUserText(request: AIGenerateRequest): string {
  for (let index = request.turns.length - 1; index >= 0; index -= 1) {
    const turn = request.turns[index];
    if (turn?.kind === 'user') return turn.text;
  }
  return '';
}
