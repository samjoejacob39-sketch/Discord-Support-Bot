import { ChannelType, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { GuildSettings } from '../db/types.js';

export interface EngagementDecision {
  /** Persist the message into the ticket transcript (context for later). */
  record: boolean;
  /** Run the AI on it now. */
  respond: boolean;
  reason: string;
  /** True when the user explicitly pinged the bot. */
  invoked: boolean;
}

const IGNORE = (reason: string): EngagementDecision => ({ record: false, respond: false, reason, invoked: false });

/** The channel that owns a ticket: a thread's parent channel, or the channel itself. */
export function supportSurfaceIds(channel: GuildTextBasedChannel): { channelId: string; parentChannelId: string | null; categoryId: string | null } {
  if (channel.isThread()) {
    const parent = channel.parent;
    return {
      channelId: channel.id,
      parentChannelId: parent?.id ?? null,
      categoryId: parent?.parentId ?? null,
    };
  }
  return { channelId: channel.id, parentChannelId: null, categoryId: channel.parentId ?? null };
}

/**
 * Channels a ticket bot opened are support surfaces by their very nature, so the bot answers
 * there without anyone configuring anything and without members needing `/ask`. Ticket systems
 * name their channels and threads predictably — `ticket-0042`, `Ticket #12`, `support-ticket`.
 *
 * A thread inherits its parent's name, so a thread called "billing" under `#tickets` counts too.
 */
export function looksLikeTicketChannel(channel: GuildTextBasedChannel): boolean {
  const names = [channel.name];
  if (channel.isThread() && channel.parent) names.push(channel.parent.name);
  return names.some((name) => /ticket/i.test(name));
}

function isSupportSurface(channel: GuildTextBasedChannel, settings: GuildSettings): boolean {
  // Checked before the mode so a ticket channel works out of the box in any configuration.
  if (looksLikeTicketChannel(channel)) return true;

  const { channelId, parentChannelId, categoryId } = supportSurfaceIds(channel);
  switch (settings.supportMode) {
    case 'all':
      return true;
    case 'channels':
      return (
        settings.supportChannelIds.includes(channelId) ||
        (parentChannelId !== null && settings.supportChannelIds.includes(parentChannelId))
      );
    case 'categories':
      return categoryId !== null && settings.supportCategoryIds.includes(categoryId);
    case 'invoked':
    default:
      return false;
  }
}

/**
 * Decide whether Shinchat Helper should touch a message at all. Defaults are deliberately
 * quiet: without configuration the bot only answers when it is mentioned, so installing it
 * never turns a busy server into an AI chatroom.
 */
export function evaluateMessage(
  message: Message,
  settings: GuildSettings,
  botUserId: string,
): EngagementDecision {
  if (!message.inGuild()) return IGNORE('not a guild message');
  if (message.author.bot || message.webhookId) return IGNORE('authored by a bot');
  if (message.system) return IGNORE('system message');
  if (message.channel.type === ChannelType.GuildStageVoice) return IGNORE('unsupported channel type');

  const content = message.content?.trim() ?? '';
  const invoked = message.mentions.users.has(botUserId);
  if (content.length === 0 && !invoked) return IGNORE('no text content');

  if (!settings.aiEnabled) {
    return { record: isSupportSurface(message.channel, settings) || invoked, respond: false, reason: 'AI disabled for this server', invoked };
  }

  const onSupportSurface = isSupportSurface(message.channel, settings);
  if (!onSupportSurface && !invoked) {
    return IGNORE(`support mode is "${settings.supportMode}" and this channel is not configured`);
  }

  return {
    record: true,
    respond: true,
    reason: invoked
      ? 'bot was mentioned'
      : looksLikeTicketChannel(message.channel)
        ? 'ticket channel'
        : `support surface (${settings.supportMode})`,
    invoked,
  };
}

/** Strip the bot mention so the model sees a clean question. */
export function cleanContent(message: Message, botUserId: string): string {
  return (message.content ?? '')
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}
