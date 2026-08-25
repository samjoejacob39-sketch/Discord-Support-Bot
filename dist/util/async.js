export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class TimeoutError extends Error {
    constructor(ms) {
        super(`Operation timed out after ${ms}ms`);
        this.name = 'TimeoutError';
    }
}
/** Race a promise against a timeout. The underlying work is not cancelled. */
export async function withTimeout(promise, ms) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/** Exponential backoff with full jitter. */
export async function retry(operation, options = {}) {
    const attempts = options.attempts ?? 3;
    const base = options.baseDelayMs ?? 400;
    const max = options.maxDelayMs ?? 8000;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (attempt === attempts)
                break;
            if (options.retryable && !options.retryable(error))
                break;
            const ceiling = Math.min(max, base * 2 ** (attempt - 1));
            const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
            options.onRetry?.(error, attempt, delay);
            await sleep(delay);
        }
    }
    throw lastError;
}
/** Best-effort HTTP status extraction from provider SDK errors. */
export function errorStatus(error) {
    if (typeof error !== 'object' || error === null)
        return undefined;
    const candidate = error;
    for (const value of [candidate.status, candidate.response?.status, candidate.code]) {
        if (typeof value === 'number')
            return value;
        if (typeof value === 'string' && /^\d{3}$/.test(value))
            return Number(value);
    }
    return undefined;
}
/** 429 and 5xx are worth retrying; 4xx (other than 429) are not. */
export function isRetryableHttpError(error) {
    const status = errorStatus(error);
    if (status === undefined)
        return true; // network/unknown → retry
    if (status === 429)
        return true;
    return status >= 500 && status < 600;
}
export function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
//# sourceMappingURL=async.js.map