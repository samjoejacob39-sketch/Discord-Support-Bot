import { MessageFlags, SlashCommandBuilder, type GuildTextBasedChannel } from 'discord.js';
import { errorEmbed, infoEmbed, successEmbed, ticketEmbed } from '../ui/embeds.js';
import { STATE_LABELS } from '../../tickets/stateMachine.js';
import type { CommandModule } from './types.js';

const data = new SlashCommandBuilder()
  .setName('shin-continue')
  .setDescription('Hand a ticket back to the AI after a human took over.')
  .addStringOption((option) =>
    option.setName('note').setDescription('Optional context for the AI, e.g. what you already fixed.').setMaxLength(500),
  )
  .addIntegerOption((option) =>
    option.setName('ticket').setDescription('Ticket id, if you are not in its channel.').setMinValue(1),
  )
  .toJSON();

/** `/shin-continue` — the only way out of WAITING_FOR_ADMIN (§11). */
export const shinContinueCommand: CommandModule = {
  name: 'shin-continue',
  access: 'shin_admin',
  category: 'tickets',
  summary: 'Resume AI support in an escalated ticket, keeping all context.',
  usage: ['`/shin-continue`', '`/shin-continue note:Reset their password already`'],
  data,

  async execute({ interaction, ctx }) {
    const guildId = interaction.guildId;
    const explicitId = interaction.options.getInteger('ticket');
    const channel = interaction.channel as GuildTextBasedChannel | null;

    const ticket = explicitId
      ? ctx.tickets.get(guildId, explicitId)
      : channel
        ? ctx.tickets.openInChannel(guildId, channel.id)
        : undefined;

    if (!ticket) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'No ticket here',
            'Run this in the ticket’s channel, or pass `ticket:<id>` (find ids with `/ticket status`).',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (ticket.state === 'AI_ACTIVE' || ticket.state === 'NEW') {
      await interaction.reply({
        embeds: [infoEmbed('Already mine', `Ticket #${ticket.id} is ${STATE_LABELS[ticket.state]} — I am still handling it.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (ticket.state === 'CLOSED') {
      await interaction.reply({
        embeds: [errorEmbed('Ticket closed', `Ticket #${ticket.id} is archived. Use \`/ticket reopen\` first.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const note = interaction.options.getString('note') ?? undefined;
    const resumed = ctx.tickets.resume(guildId, ticket.id, interaction.user.id, note);
    if (!resumed) {
      await interaction.reply({
        embeds: [errorEmbed('Could not resume', `Ticket #${ticket.id} cannot move from ${STATE_LABELS[ticket.state]}.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        successEmbed(
          'AI support resumed',
          [
            `I am handling ticket #${resumed.id} again, with everything said so far still in context.`,
            note ? `Your note was recorded: _${note}_` : null,
            'Ask your next question here and I will pick it up.',
          ]
            .filter(Boolean)
            .join('\n\n'),
        ),
        ticketEmbed(resumed, { messageCount: ctx.tickets.messageCount(guildId, resumed.id) }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};
