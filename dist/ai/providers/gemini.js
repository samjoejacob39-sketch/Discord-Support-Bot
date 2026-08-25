import { GoogleGenAI } from '@google/genai';
import { TIMINGS } from '../../config/constants.js';
import { child } from '../../logging/logger.js';
import { errorStatus, isRetryableHttpError, retry, withTimeout } from '../../util/async.js';
import { AIProviderError, parseJsonLoose, } from '../provider.js';
const log = child('ai:gemini');
function toParts(turn) {
    if (turn.kind === 'user')
        return [{ text: turn.text }];
    if (turn.kind === 'tool') {
        return turn.results.map((result) => ({
            functionResponse: { name: result.name, response: result.response },
        }));
    }
    const parts = [];
    if (turn.text && turn.text.trim().length > 0)
        parts.push({ text: turn.text });
    for (const call of turn.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
    }
    return parts.length > 0 ? parts : [{ text: '' }];
}
function toContents(turns) {
    return turns
        .map((turn) => ({ role: turn.kind === 'model' ? 'model' : 'user', parts: toParts(turn) }))
        .filter((content) => content.parts.length > 0);
}
function toFunctionDeclarations(tools) {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiSchema(tool.parameters),
    }));
}
/** Our JsonSchema uses lowercase types; the Gemini API expects uppercase `Type` values. */
function toGeminiSchema(schema) {
    const output = { type: schema.type.toUpperCase() };
    if (schema.description)
        output.description = schema.description;
    if (schema.enum)
        output.enum = schema.enum;
    if (schema.nullable)
        output.nullable = true;
    if (schema.minimum !== undefined)
        output.minimum = schema.minimum;
    if (schema.maximum !== undefined)
        output.maximum = schema.maximum;
    if (schema.items)
        output.items = toGeminiSchema(schema.items);
    if (schema.properties) {
        output.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]));
    }
    if (schema.required && schema.required.length > 0)
        output.required = schema.required;
    return output;
}
export class GeminiProvider {
    options;
    name = 'gemini';
    client;
    constructor(options) {
        this.options = options;
        this.client = new GoogleGenAI({ apiKey: options.apiKey });
    }
    modelFor(tier) {
        return tier === 'fast' ? this.options.fastModel : this.options.mainModel;
    }
    async generate(request) {
        const model = this.modelFor(request.tier ?? 'main');
        const config = {
            temperature: request.temperature ?? 0.4,
            maxOutputTokens: request.maxOutputTokens ?? 1200,
        };
        if (request.system)
            config.systemInstruction = request.system;
        if (request.responseSchema) {
            config.responseMimeType = 'application/json';
            config.responseSchema = toGeminiSchema(request.responseSchema);
        }
        else if (request.tools && request.tools.length > 0) {
            config.tools = [{ functionDeclarations: toFunctionDeclarations(request.tools) }];
            // The agent loop drives tool execution itself; never let the SDK call functions.
            config.automaticFunctionCalling = { disable: true };
        }
        if (request.signal)
            config.abortSignal = request.signal;
        const call = async () => {
            const response = await withTimeout(this.client.models.generateContent({
                model,
                contents: toContents(request.turns),
                config,
            }), TIMINGS.aiRequestTimeoutMs);
            const toolCalls = (response.functionCalls ?? []).map((fc) => ({
                name: fc.name ?? '',
                args: (fc.args ?? {}),
            }));
            return {
                text: response.text ?? '',
                toolCalls: toolCalls.filter((tc) => tc.name.length > 0),
                usage: {
                    inputTokens: response.usageMetadata?.promptTokenCount,
                    outputTokens: response.usageMetadata?.candidatesTokenCount,
                },
                model,
                finishReason: response.candidates?.[0]?.finishReason,
            };
        };
        try {
            return await retry(call, {
                attempts: 3,
                baseDelayMs: 600,
                retryable: isRetryableHttpError,
                onRetry: (error, attempt, delay) => log.warn({ attempt, delay, status: errorStatus(error) }, 'gemini request failed, retrying'),
            });
        }
        catch (error) {
            throw new AIProviderError('Gemini request failed', error, errorStatus(error));
        }
    }
    async generateJson(request) {
        const result = await this.generate({ ...request, tools: undefined });
        return parseJsonLoose(result.text);
    }
    async health() {
        try {
            const result = await this.generate({
                turns: [{ kind: 'user', text: 'Reply with the single word: ok' }],
                tier: 'fast',
                maxOutputTokens: 16,
                temperature: 0,
            });
            return { ok: result.text.trim().length > 0, detail: this.modelFor('fast') };
        }
        catch (error) {
            return { ok: false, detail: error instanceof Error ? error.message : String(error) };
        }
    }
}
//# sourceMappingURL=gemini.js.map