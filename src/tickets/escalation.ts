import { EmbedBuilder, type Guild, type GuildTextBasedChannel } from 'discord.js';
import { COLORS, DISCORD_LIMITS } from '../config/constants.js';
import type { Store } from '../db/repositories/index.js';
import type { EscalationTrigger, GuildSettings, Ticket } from '../db/types.js';
import { child } from '../logging/logger.js';
import { truncate } from '../util/text.js';
import type { StaffBrief } from '../ai/supportAgent.js';
import { STATE_LABELS } from './stateMachine.js';
import type { TicketService } from './service.js';

const log = child('escalation');

const TRIGGER_LABELS: Record<EscalationTrigger, string> = {
  ai_low_confidence: 'AI not confident enough',
  ai_requested: 'AI asked for a human',
  user_requested: 'Member asked for a human',
  attempt_limit: 'Repeated AI attempts failed',
  provider_failure: 'AI provider failure',
  admin_forced: 'Escalated by staff',
};

const URGENCY_COLOR: Record<StaffBrief['urgency'], number> = {
  low: COLORS.neutral,
  normal: COLORS.escalation,
  high: COLORS.danger,
};

export interface EscalationRequest {
  guild: Guild;
  channel: GuildTextBasedChannel;
  ticket: Ticket;
  settings: GuildSettings;
  trigger: EscalationTrigger;
  brief: StaffBrief;
  /** Public, member-facing text. Already sanitised by the agent. */
  userMessage: string;
  /** Bot id for AI-driven escalations, admin id for `/ticket escalate`. */
  actorId: string;
  /** Skip the public message when a command already replied to the member. */
  announceToMember?: boolean;
}

export interface EscalationResult {
  escalationId: number;
  ticket: Ticket;
  notifiedUserIds: string[];
  staffChannelId: string | null;
}

/** Build the staff briefing embed (§29). Never shown to the member. */
export function buildStaffEmbed(input: {
  guildName: string;
  ticket: Ticket;
  brief: StaffBrief;
  trigger: EscalationTrigger;
  channelId: string;
}): EmbedBuilder {
  const { brief, ticket } = input;
  const embed = new EmbedBuilder()
    .setColor(URGENCY_COLOR[brief.urgency])
    .setTitle(`🚨 Human needed · ticket #${ticket.id}`)
    .setDescription(
      truncate(
        [
          `**Member:** <@${ticket.openerUserId}>`,
          `**Channel:** <#${input.channelId}>`,
          `**Status:** ${STATE_LABELS.WAITING_FOR_ADMIN} · AI is now silent here`,
          `**Trigger:** ${TRIGGER_LABELS[input.trigger]}`,
        ].join('\n'),
        DISCORD_LIMITS.embedDescription,
      ),
    )
    .setFooter({ text: `Resume the AI with /shin-continue · urgency: ${brief.urgency}` })
    .setTimestamp(new Date());

  const field = (name: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    embed.addFields({ name, value: truncate(trimmed, DISCORD_LIMITS.embedFieldValue) });
  };

  field('Problem', brief.problem);
  field('Why escalated', brief.whyEscalated);
  if (brief.keyFacts.length > 0) field('Key facts', brief.keyFacts.map((fact) => `• ${fact}`).join('\n'));
  if (brief.attempted.length > 0) field('Already tried', brief.attempted.map((item) => `• ${item}`).join('\n'));
  if (brief.suspectedCause) field('Suspected cause (unverified)', brief.suspectedCause);
  if (brief.recommendedAction) field('Recommended action', brief.recommendedAction);
  if (brief.knowledgeUsed.length > 0) {
    field('Server knowledge used', brief.knowledgeUsed.map((title) => `• ${title}`).join('\n'));
  }
  if (brief.sources.length > 0) field('Web sources consulted', [...new Set(brief.sources)].join(', '));
  return embed;
}

/**
 * Escalation orchestrator: records the escalation, silences the AI in that ticket, tells the
 * member calmly, and pings the configured admins where staff will actually see it.
 */
export class EscalationService {
  constructor(
    private readonly store: Store,
    private readonly tickets: TicketService,
  ) {}

  async escalate(request: EscalationRequest): Promise<EscalationResult | undefined> {
    const { guild, settings, ticket } = request;
    const adminIds = this.store.admins.listIds(guild.id);
    const roleId = settings.adminPingRoleId;

    const recorded = this.tickets.escalate({
      guildId: guild.id,
      ticketId: ticket.id,
      trigger: request.trigger,
      reason: request.brief.whyEscalated,
      summary: request.brief.problem,
      recommendedAction: request.brief.recommendedAction,
      notifiedUserIds: adminIds,
      actorId: request.actorId,
    });
    if (!recorded) return undefined;

    if (request.announceToMember !== false && request.userMessage.trim().length > 0) {
      await request.channel
        .send({ content: truncate(request.userMessage, DISCORD_LIMITS.messageLength), allowedMentions: { parse: [] } })
        .catch((error: unknown) => log.warn({ guildId: guild.id, err: String(error) }, 'member notice failed'));
    }

    const embed = buildStaffEmbed({
      guildName: guild.name,
      ticket: recorded.ticket,
      brief: request.brief,
      trigger: request.trigger,
      channelId: request.channel.id,
    });

    const mentions = [
      ...(roleId ? [`<@&${roleId}>`] : []),
      ...adminIds.slice(0, 10).map((id) => `<@${id}>`),
    ].join(' ');
    const content = mentions.length > 0 ? mentions : '_No Shinchat admins configured yet — use `/shinadmin add`._';

    const staffChannel = await this.resolveStaffChannel(guild, settings, request.channel);
    try {
      await staffChannel.send({
        content,
        embeds: [embed],
        // Only the specific admins and the one configured role may be pinged from here.
        allowedMentions: { users: adminIds.slice(0, 10), roles: roleId ? [roleId] : [] },
      });
    } catch (error) {
      log.error({ guildId: guild.id, ticketId: ticket.id, err: String(error) }, 'staff notice failed');
    }

    return {
      escalationId: recorded.escalationId,
      ticket: recorded.ticket,
      notifiedUserIds: adminIds,
      staffChannelId: staffChannel.id === request.channel.id ? null : staffChannel.id,
    };
  }

  /** Prefer the configured escalation channel; fall back to the ticket channel. */
  private async resolveStaffChannel(
    guild: Guild,
    settings: GuildSettings,
    fallback: GuildTextBasedChannel,
  ): Promise<GuildTextBasedChannel> {
    if (!settings.escalationChannelId) return fallback;
    try {
      const channel = await guild.channels.fetch(settings.escalationChannelId);
      if (channel?.isTextBased() && !channel.isDMBased()) return channel as GuildTextBasedChannel;
    } catch {
      // Deleted or invisible channel: fall through to the ticket channel.
    }
    return fallback;
  }
}

export function createEscalationService(store: Store, tickets: TicketService): EscalationService {
  return new EscalationService(store, tickets);
}
