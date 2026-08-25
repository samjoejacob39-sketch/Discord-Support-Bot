import pino from 'pino';
import { getEnv } from '../config/env.js';
/**
 * This module is imported before `main()` runs, so a bad `.env` must not surface here as a raw
 * stack trace. `config/env.ts` builds a readable, key-by-key error and the entrypoint reports
 * it as a single fatal line — until then we log at sane defaults.
 */
function loggingConfig() {
    try {
        const env = getEnv();
        return {
            level: env.LOG_LEVEL,
            pretty: env.NODE_ENV !== 'production' && env.LOG_LEVEL !== 'silent',
        };
    }
    catch {
        return { level: 'info', pretty: true };
    }
}
const { level, pretty } = loggingConfig();
export const logger = pino({
    level,
    base: { service: 'shinchat-helper' },
    redact: {
        paths: [
            'token',
            'apiKey',
            'api_key',
            'authorization',
            'headers.authorization',
            'env.DISCORD_TOKEN',
            'env.GEMINI_API_KEY',
            'env.BRAVE_SEARCH_API_KEY',
            'env.TAVILY_API_KEY',
            '*.token',
            '*.apiKey',
        ],
        censor: '[redacted]',
    },
    ...(pretty
        ? {
            transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
            },
        }
        : {}),
});
/** Child logger for a subsystem, e.g. `child('ai')`. */
export function child(component, extra = {}) {
    return logger.child({ component, ...extra });
}
//# sourceMappingURL=logger.js.map