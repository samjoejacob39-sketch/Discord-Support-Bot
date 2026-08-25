import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { child } from '../logging/logger.js';
import { errorMessage } from '../util/async.js';
import type { BotContext } from './context.js';
import { handleGuildCreate, handleGuildDelete } from './events/guilds.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMessage } from './events/messageCreate.js';
import { refreshPresence } from './presence.js';

const log = child('discord:client');

/**
 * Least-privilege gateway configuration (§56): three intents, no Administrator, no privileged
 * presence or member intents. `MessageContent` is the one privileged intent the product needs —
 * without it the bot cannot read the questions it is meant to answer.
 */
export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

/** Wire every gateway event to its handler. Handlers never throw into the event loop. */
export function attachHandlers(client: Client, ctx: BotContext): void {
  client.once(Events.ClientReady, (ready) => {
    log.info(
      { user: ready.user.tag, guilds: ready.guilds.cache.size, provider: ctx.provider.name },
      'Shinchat Helper is online',
    );
    for (const guild of ready.guilds.cache.values()) {
      ctx.store.guilds.ensure(guild.id, guild.name);
    }
    refreshPresence(ready, ctx);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, ctx).catch((error: unknown) =>
      log.error({ err: errorMessage(error) }, 'interaction handler crashed'),
    );
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message, ctx).catch((error: unknown) =>
      log.error({ err: errorMessage(error) }, 'message handler crashed'),
    );
  });

  client.on(Events.GuildCreate, (guild) => {
    void handleGuildCreate(guild, ctx).catch((error: unknown) =>
      log.error({ guildId: guild.id, err: errorMessage(error) }, 'guild join handler crashed'),
    );
  });

  client.on(Events.GuildDelete, (guild) => {
    try {
      handleGuildDelete(guild, ctx);
    } catch (error) {
      log.error({ guildId: guild.id, err: errorMessage(error) }, 'guild leave handler crashed');
    }
  });

  client.on(Events.Error, (error) => log.error({ err: errorMessage(error) }, 'gateway error'));
  client.on(Events.Warn, (warning) => log.warn({ warning }, 'gateway warning'));
}
