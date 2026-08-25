/**
 * Provider-agnostic AI surface. Nothing outside `src/ai/providers/` may import a vendor
 * SDK, which is what makes swapping Gemini for another model a one-file change.
 */
export class AIProviderError extends Error {
    cause;
    status;
    constructor(message, cause, status) {
        super(message);
        this.cause = cause;
        this.status = status;
        this.name = 'AIProviderError';
    }
}
/** Extract the first JSON object/array from a model reply that may include prose or fences. */
export function parseJsonLoose(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = (fenced?.[1] ?? text).trim();
    try {
        return JSON.parse(candidate);
    }
    catch {
        const start = candidate.search(/[[{]/);
        const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
        if (start >= 0 && end > start) {
            return JSON.parse(candidate.slice(start, end + 1));
        }
        throw new AIProviderError('Model did not return parseable JSON');
    }
}
//# sourceMappingURL=provider.js.map