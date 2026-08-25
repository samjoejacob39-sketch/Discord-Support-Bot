/**
 * Global test setup. Runs before any `src/` module is loaded, which matters because
 * `logging/logger.ts` and `config/env.ts` both read the environment at import time.
 *
 * No real credentials, no network, no Discord: the suite is fully offline.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.AI_PROVIDER = 'mock';
process.env.WEB_SEARCH_PROVIDER = 'none';
process.env.WEB_FETCH_ENABLED = 'false';
process.env.DATABASE_PATH = ':memory:';

// Anything a real `.env` may have set is irrelevant here and must never reach a test double.
delete process.env.DISCORD_TOKEN;
delete process.env.DISCORD_APPLICATION_ID;
delete process.env.DISCORD_DEV_GUILD_ID;
delete process.env.GEMINI_API_KEY;
delete process.env.BRAVE_SEARCH_API_KEY;
delete process.env.TAVILY_API_KEY;
