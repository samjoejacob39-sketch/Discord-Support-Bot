import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { SUPPORT_MODES, SUPPORT_MODE_HELP } from '../../config/constants.js';
import { AUDIT_ACTIONS } from '../../db/repositories/audit.js';
import type { GuildSettingsPatch } from '../../db/repositories/guilds.js';
import type { GuildSettings, SupportMode } from '../../db/types.js';
import { errorEmbed, infoEmbed, successEmbed } from '../ui/embeds.js';
import type { CommandInvocation, CommandModule } from './types.js';

const MAX_SUPPORT_SURFACES = 25;
const MAX_PERSONA_NOTE = 400;

const TEXT_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
] as const;

const data = new SlashCommandBuilder()
  .setName('shinconfig')
  .setDescription('Configure Shinchat Helper for this server (server managers only).')
  .addSubcommand((sub) => sub.setName('view').setDescription('Show the current configuration.'))
  .addSubcommand((sub) =>
    sub
      .setName('mode')
      .setDescription('Choose where the bot answers on its own.')
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('Where automatic answers are allowed.')
          .setRequired(true)
          .addChoices(...SUPPORT_MODES.map((mode) => ({ name: mode, value: mode }))),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Add or remove a support channel.')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('The channel to add or remove.')
          .setRequired(true)
          .addChannelTypes(...TEXT_CHANNEL_TYPES),
      )
      .addBooleanOption((option) => option.setName('remove').setDescription('True removes it instead of adding.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('category')
      .setDescription('Add or remove a support category.')
      .addChannelOption((option) =>
        option
          .setName('category')
          .setDescription('The category to add or remove.')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addBooleanOption((option) => option.setName('remove').setDescription('True removes it instead of adding.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('escalation-channel')
      .setDescription('Where staff briefings are posted. Leave empty to clear.')
      .addChannelOption((option) =>
        option.setName('channel').setDescription('Staff channel.').addChannelTypes(...TEXT_CHANNEL_TYPES),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('trusted-role')
      .setDescription('Role that counts as a server manager here. Leave empty to clear.')
      .addRoleOption((option) => option.setName('role').setDescription('Trusted role.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ping-role')
      .setDescription('Role pinged on escalations. Leave empty to clear.')
      .addRoleOption((option) => option.setName('role').setDescription('Role to ping.')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ai')
      .setDescription('Turn AI answering on or off for the whole server.')
      .addBooleanOption((option) => option.setName('enabled').setDescription('False silences the AI.').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('attempts')
      .setDescription('How many failed AI tries before it must call a human.')
      .addIntegerOption((option) =>
        option.setName('value').setDescription('1–5 attempts.').setRequired(true).setMinValue(1).setMaxValue(5),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('persona')
      .setDescription('Extra tone guidance for replies. Leave empty to clear.')
      .addStringOption((option) =>
        option.setName('note').setDescription('E.g. "Be brief and mention our EU hours."').setMaxLength(MAX_PERSONA_NOTE),
      ),
  )
  .addSubcommand((sub) => sub.setName('reset').setDescription('Restore every setting to its default.'))
  .toJSON();

function describe(settings: GuildSettings): string {
  const list = (ids: string[], render: (id: string) => string): string =>
    ids.length > 0 ? ids.map(render).join(', ') : '_none_';
  return [
    `**Support mode:** \`${settings.supportMode}\` — ${SUPPORT_MODE_HELP[settings.supportMode]}`,
    `**AI answering:** ${settings.aiEnabled ? 'on' : '**off**'}`,
    `**Support channels:** ${list(settings.supportChannelIds, (id) => `<#${id}>`)}`,
    `**Support categories:** ${list(settings.supportCategoryIds, (id) => `<#${id}>`)}`,
    `**Escalation channel:** ${settings.escalationChannelId ? `<#${settings.escalationChannelId}>` : '_the ticket channel_'}`,
    `**Trusted role:** ${settings.trustedRoleId ? `<@&${settings.trustedRoleId}>` : '_none_'}`,
    `**Escalation ping role:** ${settings.adminPingRoleId ? `<@&${settings.adminPingRoleId}>` : '_admins only_'}`,
    `**Attempts before hand-off:** ${settings.maxAiAttempts}`,
    `**Persona note:** ${settings.personaNote ? `_${settings.personaNote}_` : '_default voice_'}`,
  ].join('\n');
}

/** Apply a patch, audit it, and reply with the fresh configuration. */
async function apply(
  invocation: CommandInvocation,
  patch: GuildSettingsPatch,
  title: string,
  detail: string,
): Promise<void> {
  const { interaction, ctx } = invocation;
  const updated = ctx.store.guilds.update(interaction.guildId, patch);
  ctx.store.audit.record(interaction.guildId, interaction.user.id, AUDIT_ACTIONS.settingsUpdate, null, {
    fields: Object.keys(patch),
  });
  await interaction.reply({
    embeds: [successEmbed(title, detail), infoEmbed('Configuration', describe(updated))],
    flags: MessageFlags.Ephemeral,
  });
}

/** Add or remove one id from a support-surface list, with a hard cap and duplicate handling. */
async function editSurface(
  invocation: CommandInvocation,
  kind: 'channel' | 'category',
  id: string,
  remove: boolean,
): Promise<void> {
  const { interaction, ctx, settings } = invocation;
  const current = kind === 'channel' ? settings.supportChannelIds : settings.supportCategoryIds;
  const mention = `<#${id}>`;

  if (remove) {
    if (!current.includes(id)) {
      await interaction.reply({
        embeds: [infoEmbed('Not configured', `${mention} was not on the ${kind} list.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const next = current.filter((entry) => entry !== id);
    await apply(
      invocation,
      kind === 'channel' ? { supportChannelIds: next } : { supportCategoryIds: next },
      `Support ${kind} removed`,
      `${mention} is no longer a support ${kind}.`,
    );
    return;
  }

  if (current.includes(id)) {
    await interaction.reply({
      embeds: [infoEmbed('Already configured', `${mention} is already a support ${kind}.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (current.length >= MAX_SUPPORT_SURFACES) {
    await interaction.reply({
      embeds: [
        errorEmbed('List is full', `Keep it to ${MAX_SUPPORT_SURFACES} support ${kind}s. Remove one before adding another.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const next = [...current, id];
  const hint =
    kind === 'channel' && settings.supportMode !== 'channels'
      ? ' Set `/shinconfig mode mode:channels` so it is actually used.'
      : kind === 'category' && settings.supportMode !== 'categories'
        ? ' Set `/shinconfig mode mode:categories` so it is actually used.'
        : '';
  await apply(
    invocation,
    kind === 'channel' ? { supportChannelIds: next } : { supportCategoryIds: next },
    `Support ${kind} added`,
    `${mention} is now a support ${kind}.${hint}`,
  );
}

/**
 * `/shinconfig …` — the whole configuration surface lives in Discord (§2, §61): no web panel,
 * no dashboard, and only server managers can change it (§8).
 */
export const shinconfigCommand: CommandModule = {
  name: 'shinconfig',
  access: 'guild_manager',
  category: 'config',
  summary: 'View and change where the bot answers, who it pings and how it sounds.',
  usage: ['`/shinconfig view`', '`/shinconfig mode mode:channels`', '`/shinconfig channel channel:#support`'],
  data,

  async execute(invocation) {
    const { interaction, ctx, settings } = invocation;
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      await interaction.reply({
        embeds: [
          infoEmbed('Shinchat Helper configuration', describe(settings)),
          infoEmbed(
            'Support modes',
            Object.entries(SUPPORT_MODE_HELP)
              .map(([mode, help]) => `\`${mode}\` — ${help}`)
              .join('\n'),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'mode') {
      const mode = interaction.options.getString('mode', true) as SupportMode;
      const missing =
        (mode === 'channels' && settings.supportChannelIds.length === 0) ||
        (mode === 'categories' && settings.supportCategoryIds.length === 0);
      await apply(
        invocation,
        { supportMode: mode },
        'Support mode updated',
        [
          SUPPORT_MODE_HELP[mode],
          missing ? `⚠️ No ${mode} configured yet, so I still only answer when invoked. Add one with \`/shinconfig ${mode === 'channels' ? 'channel' : 'category'}\`.` : null,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      return;
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      await editSurface(invocation, 'channel', channel.id, interaction.options.getBoolean('remove') ?? false);
      return;
    }

    if (sub === 'category') {
      const category = interaction.options.getChannel('category', true);
      await editSurface(invocation, 'category', category.id, interaction.options.getBoolean('remove') ?? false);
      return;
    }

    if (sub === 'escalation-channel') {
      const channel = interaction.options.getChannel('channel');
      await apply(
        invocation,
        { escalationChannelId: channel?.id ?? null },
        channel ? 'Escalation channel set' : 'Escalation channel cleared',
        channel
          ? `Staff briefings go to <#${channel.id}>. Make sure I can send messages and embeds there.`
          : 'Briefings will be posted in the ticket’s own channel again.',
      );
      return;
    }

    if (sub === 'trusted-role') {
      const role = interaction.options.getRole('role');
      await apply(
        invocation,
        { trustedRoleId: role?.id ?? null },
        role ? 'Trusted role set' : 'Trusted role cleared',
        role
          ? `<@&${role.id}> can now use every configuration command, like a server manager. Grant it carefully.`
          : 'Only the owner, **Administrator** and **Manage Server** count as managers now.',
      );
      return;
    }

    if (sub === 'ping-role') {
      const role = interaction.options.getRole('role');
      await apply(
        invocation,
        { adminPingRoleId: role?.id ?? null },
        role ? 'Ping role set' : 'Ping role cleared',
        role ? `<@&${role.id}> will be pinged with every escalation.` : 'Only the listed admins will be pinged.',
      );
      return;
    }

    if (sub === 'ai') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await apply(
        invocation,
        { aiEnabled: enabled },
        enabled ? 'AI answering enabled' : 'AI answering disabled',
        enabled
          ? 'I will answer again where your support mode allows it.'
          : 'I will stay silent everywhere, but I keep recording tickets so staff still have context.',
      );
      return;
    }

    if (sub === 'attempts') {
      const value = interaction.options.getInteger('value', true);
      await apply(
        invocation,
        { maxAiAttempts: value },
        'Attempt limit updated',
        `After ${value} unsuccessful ${value === 1 ? 'try' : 'tries'} in one ticket I hand it to a human instead of guessing again.`,
      );
      return;
    }

    if (sub === 'persona') {
      const note = interaction.options.getString('note')?.trim();
      await apply(
        invocation,
        { personaNote: note && note.length > 0 ? note : null },
        note ? 'Persona note saved' : 'Persona note cleared',
        note
          ? 'It shapes tone and wording only — it can never override my safety, privacy or honesty rules.'
          : 'Back to the default friendly-professional voice.',
      );
      return;
    }

    const fresh = ctx.store.guilds.reset(interaction.guildId);
    ctx.store.audit.record(interaction.guildId, interaction.user.id, AUDIT_ACTIONS.settingsReset);
    await interaction.reply({
      embeds: [
        successEmbed('Configuration reset', 'Every setting is back to default. Admins and knowledge were **not** touched.'),
        infoEmbed('Configuration', describe(fresh)),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};


