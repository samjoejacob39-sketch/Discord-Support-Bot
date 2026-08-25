import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  // Log shape is deliberately independent of NODE_ENV: a production box feeding a log
  // aggregator wants "json", but a production box you actually watch in a terminal wants
  // "pretty". "auto" keeps the old behaviour (json in production, pretty everywhere else).
  LOG_FORMAT: z.enum(['auto', 'pretty', 'json']).default('auto'),

  DISCORD_TOKEN: optionalString,
  DISCORD_APPLICATION_ID: optionalString,
  DISCORD_DEV_GUILD_ID: optionalString,

  AI_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_FAST_MODEL: z.string().default('gemini-2.5-flash-lite'),

  WEB_SEARCH_PROVIDER: z.enum(['none', 'brave', 'tavily', 'duckduckgo']).default('none'),
  BRAVE_SEARCH_API_KEY: optionalString,
  TAVILY_API_KEY: optionalString,
  WEB_FETCH_ENABLED: boolish.default(true),

  DATABASE_PATH: z.string().default('./data/shinchat.sqlite'),

  AI_MAX_REQUESTS_PER_USER_PER_MIN: z.coerce.number().int().min(1).max(120).default(6),
  AI_MAX_REQUESTS_PER_GUILD_PER_MIN: z.coerce.number().int().min(1).max(2000).default(40),
  AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(12).default(5),
  AI_CONTEXT_MESSAGE_LIMIT: z.coerce.number().int().min(4).max(60).default(14),
});

export type Env = z.infer<typeof envSchema>;

/** Values that must never appear in logs or in an outgoing Discord message. */
export function collectSecretValues(env: Env): string[] {
  return [env.DISCORD_TOKEN, env.GEMINI_API_KEY, env.BRAVE_SEARCH_API_KEY, env.TAVILY_API_KEY]
    .filter((v): v is string => typeof v === 'string' && v.length >= 12);
}

let cached: Env | undefined;

/** Parse and cache process env. Throws a readable error listing every invalid key. */
export function loadEnv(overrides: Record<string, unknown> = {}): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function getEnv(): Env {
  return cached ?? loadEnv();
}

/** Reset the cache — used by tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Startup validation for things zod cannot express (cross-field requirements).
 * Returns fatal errors (must stop) and warnings (degraded but runnable).
 */
export function validateRuntimeEnv(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!env.DISCORD_TOKEN) errors.push('DISCORD_TOKEN is required to connect to Discord.');
  if (!env.DISCORD_APPLICATION_ID) errors.push('DISCORD_APPLICATION_ID is required to register slash commands.');

  if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    errors.push('AI_PROVIDER=gemini requires GEMINI_API_KEY (create one at https://aistudio.google.com/apikey).');
  }
  if (env.AI_PROVIDER === 'mock' && env.NODE_ENV === 'production') {
    warnings.push('AI_PROVIDER=mock in production: replies will be canned, not intelligent.');
  }
  if (env.WEB_SEARCH_PROVIDER === 'brave' && !env.BRAVE_SEARCH_API_KEY) {
    errors.push('WEB_SEARCH_PROVIDER=brave requires BRAVE_SEARCH_API_KEY.');
  }
  if (env.WEB_SEARCH_PROVIDER === 'tavily' && !env.TAVILY_API_KEY) {
    errors.push('WEB_SEARCH_PROVIDER=tavily requires TAVILY_API_KEY.');
  }
  if (env.WEB_SEARCH_PROVIDER === 'none') {
    warnings.push('Web search is disabled (WEB_SEARCH_PROVIDER=none); answers rely on learned + model knowledge.');
  }
  if (env.WEB_SEARCH_PROVIDER === 'duckduckgo') {
    warnings.push('WEB_SEARCH_PROVIDER=duckduckgo scrapes HTML and may break without notice; prefer brave or tavily.');
  }
  return { errors, warnings };
}
