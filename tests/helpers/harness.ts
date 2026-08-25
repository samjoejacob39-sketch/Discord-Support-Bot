import type { Env } from '../../src/config/env.js';
import { loadEnv } from '../../src/config/env.js';
import { createDatabase, type Db } from '../../src/db/client.js';
import { createStore, type Store } from '../../src/db/repositories/index.js';
import { createBotContext, type BotContext } from '../../src/discord/context.js';
import { MockProvider } from '../../src/ai/providers/mock.js';

export interface Harness {
  db: Db;
  store: Store;
  provider: MockProvider;
  ctx: BotContext;
  env: Env;
  close(): void;
}

/** Env for tests: offline provider, no web, no Discord credentials. */
export function testEnv(overrides: Record<string, unknown> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    AI_PROVIDER: 'mock',
    WEB_SEARCH_PROVIDER: 'none',
    WEB_FETCH_ENABLED: false,
    DATABASE_PATH: ':memory:',
    DISCORD_TOKEN: undefined,
    DISCORD_APPLICATION_ID: undefined,
    GEMINI_API_KEY: undefined,
    ...overrides,
  });
}

/**
 * A complete bot wired to an in-memory database and a scripted provider. Every test gets its
 * own harness, so nothing leaks between cases and no test can reach the network.
 */
export function createHarness(overrides: Record<string, unknown> = {}): Harness {
  const env = testEnv(overrides);
  const db = createDatabase(':memory:');
  const store = createStore(db);
  const provider = new MockProvider();
  const ctx = createBotContext(env, store, provider);
  return { db, store, provider, ctx, env, close: () => db.close() };
}

/** Register a guild with default settings and return them. */
export function seedGuild(store: Store, guildId: string, name = `guild-${guildId}`) {
  return store.guilds.ensure(guildId, name);
}
