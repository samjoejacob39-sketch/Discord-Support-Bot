import { REST, Routes } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { child } from '../logging/logger.js';
import { initRedaction } from '../security/redaction.js';
import { errorMessage } from '../util/async.js';
import { fatalLines, finishExit } from '../util/exit.js';

const log = child('scripts:clear');

/** Remove published commands (guild scope when DISCORD_DEV_GUILD_ID is set, otherwise global). */
async function main(): Promise<void> {
  const env = loadEnv();
  initRedaction();

  if (!env.DISCORD_TOKEN || !env.DISCORD_APPLICATION_ID) {
    log.fatal('DISCORD_TOKEN and DISCORD_APPLICATION_ID are required to clear commands.');
    finishExit(1);
    return;
  }

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const route = env.DISCORD_DEV_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_DEV_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_APPLICATION_ID);

  await rest.put(route, { body: [] });
  log.info({ scope: env.DISCORD_DEV_GUILD_ID ? `guild ${env.DISCORD_DEV_GUILD_ID}` : 'global' }, 'commands cleared');
}

main().catch((error: unknown) => {
  fatalLines(log, 'clearing failed', errorMessage(error));
  finishExit(1);
});
