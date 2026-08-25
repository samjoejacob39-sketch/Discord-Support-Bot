import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from 'discord.js';

const PREV = 'shin:page:prev';
const NEXT = 'shin:page:next';

export interface PaginateOptions {
  interaction: ChatInputCommandInteraction;
  pageCount: number;
  render: (page: number) => EmbedBuilder;
  ephemeral?: boolean;
  ttlMs?: number;
}

function row(page: number, pageCount: number, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PREV)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 1),
    new ButtonBuilder()
      .setCustomId(NEXT)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= pageCount),
  );
}

/**
 * Reply with a paged embed. Buttons only work for the person who ran the command, and they are
 * disabled when the window expires so nobody clicks a dead control.
 */
export async function paginate({
  interaction,
  pageCount,
  render,
  ephemeral = true,
  ttlMs = 5 * 60_000,
}: PaginateOptions): Promise<void> {
  let page = 1;
  const total = Math.max(1, pageCount);
  const single = total <= 1;

  const message = await interaction.reply({
    embeds: [render(page)],
    components: single ? [] : [row(page, total)],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    withResponse: true,
  });
  if (single) return;

  const resource = message.resource?.message;
  if (!resource) return;

  const collector = resource.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: ttlMs,
  });

  collector.on('collect', async (button) => {
    if (button.user.id !== interaction.user.id) {
      await button.reply({ content: 'These buttons belong to whoever ran the command.', flags: MessageFlags.Ephemeral });
      return;
    }
    page = button.customId === NEXT ? Math.min(total, page + 1) : Math.max(1, page - 1);
    await button.update({ embeds: [render(page)], components: [row(page, total)] });
  });

  collector.on('end', async () => {
    await interaction.editReply({ components: [row(page, total, true)] }).catch(() => undefined);
  });
}
