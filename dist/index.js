import { Events } from 'discord.js';
import { loadEnv, validateRuntimeEnv } from './config/env.js';
import { initDatabase, closeDatabase } from './db/client.js';
import { initStore } from './db/repositories/index.js';
import { initProvider } from './ai/registry.js';
import { attachHandlers, createClient } from './discord/client.js';
import { createBotContext } from './discord/context.js';
import { createScheduler } from './jobs/scheduler.js';
import { printBanner } from './logging/banner.js';
import { child } from './logging/logger.js';
import { initRedaction } from './security/redaction.js';
import { errorMessage } from './util/async.js';
import { fatalLines, finishExit } from './util/exit.js';
const log = child('bootstrap');
async function main() {
    const env = loadEnv();
    // Secret values are registered first so nothing can leak through a log line or a reply.
    initRedaction();
    const { errors, warnings } = validateRuntimeEnv(env);
    for (const warning of warnings)
        log.warn(warning);
    if (errors.length > 0) {
        for (const error of errors)
            log.fatal(error);
        log.fatal('Fix the configuration in .env (see .env.example) and start again.');
        finishExit(1);
        return;
    }
    const db = initDatabase(env.DATABASE_PATH);
    const store = initStore(db);
    const provider = initProvider(env);
    const ctx = createBotContext(env, store, provider);
    const client = createClient();
    attachHandlers(client, ctx);
    const scheduler = createScheduler(ctx);
    client.once(Events.ClientReady, (ready) => {
        printBanner({
            botTag: ready.user.tag,
            guildCount: ready.guilds.cache.size,
            provider: env.AI_PROVIDER,
            model: env.AI_PROVIDER === 'mock' ? 'canned replies' : env.GEMINI_MODEL,
            webSearch: env.WEB_SEARCH_PROVIDER,
            webFetch: env.WEB_FETCH_ENABLED,
            database: env.DATABASE_PATH,
            environment: env.NODE_ENV,
            degraded: env.AI_PROVIDER === 'mock' ? 'AI_PROVIDER=mock — replies are canned, not real answers.' : undefined,
        });
        scheduler.runOnce(ready);
        scheduler.start(ready);
    });
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        log.info({ signal }, 'shutting down');
        scheduler.stop();
        void client
            .destroy()
            .catch((error) => log.warn({ err: errorMessage(error) }, 'client shutdown failed'))
            .finally(() => {
            closeDatabase();
            finishExit(0);
        });
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason) => log.error({ err: errorMessage(reason) }, 'unhandled rejection'));
    process.on('uncaughtException', (error) => {
        log.fatal({ err: errorMessage(error) }, 'uncaught exception');
        shutdown('uncaughtException');
    });
    try {
        await client.login(env.DISCORD_TOKEN);
    }
    catch (error) {
        // Overwhelmingly the first-run failure: a token that was pasted wrong or has been reset.
        log.fatal({ err: errorMessage(error) }, 'could not sign in to Discord — check DISCORD_TOKEN in .env (Developer Portal → Bot → Reset Token)');
        scheduler.stop();
        await client.destroy().catch(() => undefined);
        closeDatabase();
        finishExit(1);
    }
}
main().catch((error) => {
    fatalLines(log, 'startup failed', errorMessage(error));
    finishExit(1);
});
//# sourceMappingURL=index.js.map