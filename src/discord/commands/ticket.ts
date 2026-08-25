import {
  MessageFlags,
  SlashCommandBuilder,
  type GuildTextBasedChannel,
  type SlashCommandIntegerOption,
} from 'discord.js';
import type { StaffBrief } from '../../ai/supportAgent.js';
import { AUDIT_ACTIONS } from '../../db/repositories/audit.js';
import type { Ticket, TicketState } from '../../db/types.js';
import { STATE_DESCRIPTIONS, STATE_LABELS } from '../../tickets/stateMachine.js';
import { relativeTimestamp, truncate } from '../../util/text.js';
import { errorEmbed, infoEmbed, successEmbed, ticketEmbed } from '../ui/embeds.js';
import type { CommandInvocation, CommandModule } from './types.js';

const LIST_STATES: TicketState[] = ['WAITING_FOR_ADMIN', 'ADMIN_ACTIVE', 'AI_ACTIVE', 'NEW', 'AI_PAUSED', 'RESOLVED'];

const ticketOption = (description: string) => (option: SlashCommandIntegerOption) =>
  option.setName('ticket').setDescription(description).setMinValue(1);

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Inspect and steer support conversations (staff only).')
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Show the ticket in this channel, or one by id.')
      .addIntegerOption(ticketOption('Ticket id.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List tickets by state.')
      .addStringOption((option) =>
        option
          .setName('state')
          .setDescription('Default: waiting for a moderator.')
          .addChoices(...LIST_STATES.map((state) => ({ name: STATE_LABELS[state], value: state }))),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('summary')
      .setDescription('Show the rolling summary and recorded facts.')
      .addIntegerOption(ticketOption('Ticket id.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('escalate')
      .setDescription('Force a hand-off to humans and silence the AI here.')
      .addStringOption((option) =>
        option.setName('reason').setDescription('Why staff need to take over.').setMaxLength(500),
      )
      .addIntegerOption(ticketOption('Ticket id.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('resolve')
      .setDescription('Mark solved. The AI answers again on a follow-up.')
      .addIntegerOption(ticketOption('Ticket id.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Archive the ticket. The bot then ignores this channel.')
      .addIntegerOption(ticketOption('Ticket id.')),
  )
  .addSubcommand((sub) => sub.setName('reopen').setDescription('Start a fresh ticket in this channel after a close.'))
  .addSubcommand((sub) =>
    sub
      .setName('ai')
      .setDescription('Pause or resume AI answers in one ticket.')
      .addBooleanOption((option) =>
        option.setName('enabled').setDescription('False pauses the AI here.').setRequired(true),
      )
      .addIntegerOption(ticketOption('Ticket id.')),
  )
  .toJSON();

/** Resolve the target ticket: explicit id wins, otherwise the open one in this channel. */
function resolveTicket({ interaction, ctx }: CommandInvocation): Ticket | undefined {
  const explicitId = interaction.options.getInteger('ticket');
  if (explicitId) return ctx.tickets.get(interaction.guildId, explicitId);
  const channel = interaction.channel as GuildTextBasedChannel | null;
  return channel ? ctx.tickets.openInChannel(interaction.guildId, channel.id) : undefined;
}

function line(ticket: Ticket): string {
  return [
    `**#${ticket.id}** ${STATE_LABELS[ticket.state]} · <#${ticket.channelId}>`,
    `  ${ticket.subject ? truncate(ticket.subject, 90) : '_no topic recorded_'}`,
    `  <@${ticket.openerUserId}> · ${relativeTimestamp(ticket.lastActivityAt)}`,
  ].join('\n');
}

async function runList({ interaction, ctx }: CommandInvocation): Promise<void> {
  const state = (interaction.options.getString('state') as TicketState | null) ?? 'WAITING_FOR_ADMIN';
  const tickets = ctx.store.tickets.listByState(interaction.guildId, state, 10);
  await interaction.reply({
    embeds: [
      infoEmbed(
        `Tickets · ${STATE_LABELS[state]}`,
        tickets.length > 0
          ? [tickets.map(line).join('\n\n'), '', `_${STATE_DESCRIPTIONS[state]}_`].join('\n')
          : `Nothing here. ${STATE_DESCRIPTIONS[state]}`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function runSummary(invocation: CommandInvocation, ticket: Ticket): Promise<void> {
  const { interaction, ctx } = invocation;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // Fold anything new into the checkpoint first, so staff read the freshest picture.
  await ctx.summarizer.maybeSummarise(interaction.guildId, ticket.id).catch(() => undefined);

  const context = ctx.tickets.context(interaction.guildId, ticket.id, 6);
  const facts = context?.facts ?? [];
  const body = [
    context?.summary
      ? `**Rolling summary**\n${context.summary.summary}`
      : '_No summary yet — the conversation is still short enough to read in full._',
    facts.length > 0
      ? `\n**Recorded facts**\n${facts.map((fact) => `• **${fact.label}:** ${truncate(fact.value, 200)}`).join('\n')}`
      : null,
    context && context.messages.length > 0
      ? `\n**Last messages**\n${context.messages
          .slice(-4)
          .map((message) => `• _${message.authorKind}_ — ${truncate(message.content, 160)}`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  await interaction.editReply({
    embeds: [infoEmbed(`Ticket #${ticket.id} · context`, body), ticketEmbed(ticket)],
  });
}

async function runEscalate(invocation: CommandInvocation, ticket: Ticket): Promise<void> {
  const { interaction, ctx, settings } = invocation;
  const reason = interaction.options.getString('reason') ?? 'A staff member took this over manually.';
  const channel = (await interaction.guild.channels.fetch(ticket.channelId).catch(() => null)) ?? interaction.channel;
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      embeds: [errorEmbed('Channel unavailable', 'I cannot see the ticket’s channel, so I cannot post the hand-off.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const brief: StaffBrief = {
    problem: ticket.subject ?? 'See the ticket channel for the member’s request.',
    keyFacts: [`Escalated manually by <@${interaction.user.id}>.`],
    attempted: [`AI attempts so far: ${ticket.aiAttempts}.`],
    suspectedCause: null,
    whyEscalated: reason,
    recommendedAction: null,
    urgency: 'normal',
    knowledgeUsed: [],
    sources: [],
  };

  const result = await ctx.escalation.escalate({
    guild: interaction.guild,
    channel: channel as GuildTextBasedChannel,
    ticket,
    settings,
    trigger: 'admin_forced',
    brief,
    userMessage: 'A moderator is taking this over personally — they can see everything discussed so far.',
    actorId: interaction.user.id,
    announceToMember: true,
  });

  if (!result) {
    await interaction.editReply({
      embeds: [errorEmbed('Could not escalate', `Ticket #${ticket.id} could not be moved. It may already be closed.`)],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Handed to humans',
        [
          `Ticket #${ticket.id} is now ${STATE_LABELS.WAITING_FOR_ADMIN}. I will not answer there until \`/shin-continue\`.`,
          result.staffChannelId ? `Briefing posted in <#${result.staffChannelId}>.` : 'Briefing posted in the ticket channel.',
        ].join('\n\n'),
      ),
    ],
  });
}

/** `/ticket …` — the staff view of a conversation and the manual controls over it (§10–§13). */
export const ticketCommand: CommandModule = {
  name: 'ticket',
  access: 'shin_admin',
  category: 'tickets',
  summary: 'Status, context, manual escalation and ticket lifecycle controls.',
  usage: ['`/ticket status`', '`/ticket list state:WAITING_FOR_ADMIN`', '`/ticket ai enabled:false`'],
  data,

  async execute(invocation) {
    const { interaction, ctx } = invocation;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') return runList(invocation);

    if (sub === 'reopen') {
      const channel = interaction.channel as GuildTextBasedChannel | null;
      if (!channel) {
        await interaction.reply({
          embeds: [errorEmbed('No channel', 'Run `/ticket reopen` inside the channel you want to reopen.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const existing = ctx.tickets.openInChannel(guildId, channel.id);
      if (existing) {
        await interaction.reply({
          embeds: [
            infoEmbed('Already open', `Ticket #${existing.id} is live here (${STATE_LABELS[existing.state]}).`),
            ticketEmbed(existing),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      // Closed tickets stay closed by design; reopening starts a clean ticket on the same channel.
      const fresh = ctx.tickets.ensure({
        guildId,
        channelId: channel.id,
        parentId: channel.isThread() ? channel.parentId : null,
        openerUserId: interaction.user.id,
        subject: null,
      });
      ctx.store.audit.record(guildId, interaction.user.id, AUDIT_ACTIONS.ticketReopen, String(fresh.id));
      await interaction.reply({
        embeds: [
          successEmbed('Reopened', `Ticket #${fresh.id} is open here and I am listening again.`),
          ticketEmbed(fresh),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticket = resolveTicket(invocation);
    if (!ticket) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'No ticket found',
            'Run this in the ticket’s channel, or pass `ticket:<id>`. `/ticket list` shows the ids.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'status') {
      const open = ctx.store.escalations.latestOpenForTicket(guildId, ticket.id);
      await interaction.reply({
        embeds: [
          ticketEmbed(ticket, {
            openEscalation: Boolean(open),
            messageCount: ctx.tickets.messageCount(guildId, ticket.id),
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'summary') return runSummary(invocation, ticket);
    if (sub === 'escalate') return runEscalate(invocation, ticket);

    if (sub === 'ai') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const moved = ctx.tickets.setAiPaused(guildId, ticket.id, interaction.user.id, !enabled);
      await interaction.reply({
        embeds: [
          moved
            ? successEmbed(
                enabled ? 'AI resumed here' : 'AI paused here',
                enabled
                  ? `I will answer in ticket #${ticket.id} again.`
                  : `I will stay quiet in ticket #${ticket.id} until someone re-enables me.`,
              )
            : errorEmbed('Could not change that', `Ticket #${ticket.id} is ${STATE_LABELS[ticket.state]}.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const closing = sub === 'close';
    const moved = closing
      ? ctx.tickets.close(guildId, ticket.id, interaction.user.id)
      : ctx.tickets.resolve(guildId, ticket.id, interaction.user.id);

    await interaction.reply({
      embeds: [
        moved
          ? successEmbed(
              closing ? 'Ticket closed' : 'Marked resolved',
              closing
                ? `Ticket #${ticket.id} is archived. I will ignore this channel until \`/ticket reopen\`.`
                : `Ticket #${ticket.id} is resolved. If the member follows up, I will pick it up again.`,
            )
          : errorEmbed('Could not update', `Ticket #${ticket.id} is ${STATE_LABELS[ticket.state]}.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

