import { ActivityType, type Client } from 'discord.js';
import type { BotContext } from './context.js';

/**
 * Presence is intentionally boring (§57): one line that tells members how to reach the bot,
 * refreshed on a slow timer so it never becomes a rate-limit problem.
 */
export function refreshPresence(client: Client<true>, ctx: BotContext): void {
  const open = ctx.store.tickets.countOpenGlobal();
  const state = open > 0 ? `${open} open ticket${open === 1 ? '' : 's'} · /help` : 'support questions · /help';
  client.user.setPresence({
    status: 'online',
    activities: [{ name: state, type: ActivityType.Listening }],
  });
}
