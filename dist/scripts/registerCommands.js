import { REST, Routes } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { commandPayload, COMMANDS } from '../discord/commandRegistry.js';
import { child } from '../logging/logger.js';
import { initRedaction } from '../security/redaction.js';
import { errorMessage, errorStatus } from '../util/async.js';
import { fatalLines, finishExit } from '../util/exit.js';
const log = child('scripts:register');
/**
 * Publish the slash commands. With DISCORD_DEV_GUILD_ID set they land in that one server
 * instantly, which is what you want while developing; without it they are global.
 */
async function main() {
    const env = loadEnv();
    initRedaction();
    if (!env.DISCORD_TOKEN || !env.DISCORD_APPLICATION_ID) {
        log.fatal('DISCORD_TOKEN and DISCORD_APPLICATION_ID are required to register commands.');
        finishExit(1);
        return;
    }
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    const body = commandPayload();
    const route = env.DISCORD_DEV_GUILD_ID
        ? Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_DEV_GUILD_ID)
        : Routes.applicationCommands(env.DISCORD_APPLICATION_ID);
    await rest.put(route, { body });
    log.info({ count: body.length, scope: env.DISCORD_DEV_GUILD_ID ? `guild ${env.DISCORD_DEV_GUILD_ID}` : 'global' }, 'commands registered');
    for (const command of COMMANDS)
        log.info(`  /${command.name} — ${command.summary}`);
    if (!env.DISCORD_DEV_GUILD_ID)
        log.info('Global commands can take up to an hour to appear everywhere.');
}
main().catch((error) => {
    fatalLines(log, 'registration failed', errorMessage(error));
    // The two mistakes that account for nearly every failure here.
    const status = errorStatus(error);
    if (status === 401)
        log.fatal('401 means DISCORD_TOKEN is wrong or was reset. Copy it again from the Bot tab.');
    if (status === 404)
        log.fatal('404 usually means DISCORD_APPLICATION_ID is wrong, or the bot is not in that guild.');
    finishExit(1);
});
//# sourceMappingURL=registerCommands.js.map