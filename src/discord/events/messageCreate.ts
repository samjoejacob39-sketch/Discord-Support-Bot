import { PermissionFlagsBits, type GuildTextBasedChannel, type Message } from 'discord.js';
import { TIMINGS } from '../../config/constants.js';
import { child } from '../../logging/logger.js';
import { isShinAdmin } from '../../security/permissions.js';
import { cleanContent, evaluateMessage } from '../../tickets/detection.js';
import { errorMessage } from '../../util/async.js';
import { formatDuration } from '../../util/text.js';
import { runSupportTurn } from '../aiPipeline.js';
import type { BotContext } from '../context.js';

const log = child('discord:messages');

/** The bot needs to be able to read and answer before it starts a support turn. */
function canOperate(channel: GuildTextBasedChannel, botId: string): boolean {
  const permissions = channel.permissionsFor(botId);
  if (!permissions) return false;
  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(PermissionFlagsBits.SendMessages) &&
    permissions.has(PermissionFlagsBits.ReadMessageHistory)
  );
}

/** Keep the typing indicator alive for as long as the model takes. */
function startTyping(channel: GuildTextBasedChannel): () => void {
  void channel.sendTyping().catch(() => undefined);
  const timer = setInterval(() => void channel.sendTyping().catch(() => undefined), TIMINGS.typingRefreshMs);
  return () => clearInterval(timer);
}

/**
 * Automatic message handling (§14). Engagement is decided by `evaluateMessage`, so the bot is
 * silent outside configured support surfaces unless someone mentions it.
 */
export async function handleMessage(message: Message, ctx: BotContext): Promise<void> {
  if (!message.inGuild()) return;
  const botUser = message.client.user;
  if (message.author.id === botUser.id) return;

  const settings = ctx.store.guilds.settingsOrDefault(message.guildId);
  const decision = evaluateMessage(message, settings, botUser.id);
  if (!decision.record) return;

  const channel = message.channel as GuildTextBasedChannel;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const question = cleanContent(message, botUser.id);
  const staff = isShinAdmin(ctx.store, member, settings);
  const existing = ctx.tickets.openInChannel(message.guildId, channel.id);

  // Staff talking to the member (not to the bot) means a human has taken over: record it as
  // admin context and let the ticket move to ADMIN_ACTIVE so the AI stops interrupting (§12).
  if (staff && !decision.invoked) {
    if (existing) ctx.tickets.recordAdminMessage(existing, member.id, question, message.id);
    return;
  }

  if (!decision.respond) {
    const ticket =
      existing ??
      ctx.tickets.ensure({
        guildId: message.guildId,
        channelId: channel.id,
        parentId: channel.isThread() ? channel.parentId : null,
        openerUserId: member.id,
        subject: question.slice(0, 140),
      });
    ctx.tickets.recordUserMessage(ticket, member.id, question, message.id);
    log.debug({ guildId: message.guildId, reason: decision.reason }, 'recorded without answering');
    return;
  }

  if (question.length === 0) {
    if (decision.invoked) {
      await message
        .reply({
          content: 'I am here — tell me what you need, or use `/ask` and `/help`.',
          allowedMentions: { repliedUser: false, parse: [] },
        })
        .catch(() => undefined);
    }
    return;
  }

  if (!canOperate(channel, botUser.id)) {
    log.warn({ guildId: message.guildId, channelId: channel.id }, 'missing channel permissions');
    return;
  }

  const stopTyping = startTyping(channel);
  try {
    let first = true;
    const result = await runSupportTurn({
      ctx,
      guild: message.guild,
      channel,
      asker: member,
      settings,
      question,
      askerIsStaff: staff,
      botUserId: botUser.id,
      sourceMessageId: message.id,
      deliver: async (content) => {
        const sent = first
          ? await message.reply({ content, allowedMentions: { repliedUser: true, parse: [] } })
          : await channel.send({ content, allowedMentions: { parse: [] } });
        first = false;
        return sent.id;
      },
    });

    if (result.status === 'rate_limited' && decision.invoked) {
      await message
        .reply({
          content:
            result.scope === 'guild'
              ? `The server has hit its shared AI limit — try again in ${formatDuration(result.retryAfterMs)}.`
              : `You are asking faster than I can keep up. Try again in ${formatDuration(result.retryAfterMs)}.`,
          allowedMentions: { repliedUser: false, parse: [] },
        })
        .catch(() => undefined);
      return;
    }

    if (result.status === 'silent') {
      log.debug({ guildId: message.guildId, reason: result.reason }, 'stayed quiet');
    }
  } catch (error) {
    log.error({ guildId: message.guildId, channelId: channel.id, err: errorMessage(error) }, 'support turn failed');
    if (decision.invoked) {
      await message
        .reply({
          content: 'Something went wrong on my side and I could not finish that. Please try again in a moment.',
          allowedMentions: { repliedUser: false, parse: [] },
        })
        .catch(() => undefined);
    }
  } finally {
    stopTyping();
  }
}
