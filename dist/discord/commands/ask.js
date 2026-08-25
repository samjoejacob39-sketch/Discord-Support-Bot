import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { isShinAdmin } from '../../security/permissions.js';
import { formatDuration } from '../../util/text.js';
import { runSupportTurn } from '../aiPipeline.js';
import { errorEmbed, warningEmbed } from '../ui/embeds.js';
const data = new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the support assistant a question.')
    .addStringOption((option) => option
    .setName('question')
    .setDescription('What do you need help with?')
    .setRequired(true)
    .setMaxLength(1500))
    .addBooleanOption((option) => option.setName('private').setDescription('Answer only to you (default: visible to the channel).'))
    .toJSON();
/** `/ask` works in every support mode, including the quiet default (§14). */
export const askCommand = {
    name: 'ask',
    access: 'member',
    category: 'general',
    summary: 'Ask a question and get an answer based on this server’s knowledge.',
    usage: ['`/ask How do I link my account?`'],
    data,
    async execute({ interaction, ctx, member, settings }) {
        const question = interaction.options.getString('question', true).trim();
        const isPrivate = interaction.options.getBoolean('private') ?? false;
        if (!settings.aiEnabled) {
            await interaction.reply({
                embeds: [warningEmbed('AI support is off', 'A server manager disabled it with `/shinconfig ai`.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const channel = interaction.channel;
        if (!channel) {
            await interaction.reply({
                embeds: [errorEmbed('Unsupported channel', 'I cannot hold a support conversation here.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: isPrivate ? MessageFlags.Ephemeral : undefined });
        let first = true;
        const result = await runSupportTurn({
            ctx,
            guild: interaction.guild,
            channel,
            asker: member,
            settings,
            question,
            askerIsStaff: isShinAdmin(ctx.store, member, settings),
            botUserId: interaction.client.user.id,
            deliver: async (content) => {
                if (first) {
                    first = false;
                    const sent = await interaction.editReply({ content, allowedMentions: { parse: [] } });
                    return sent.id;
                }
                const sent = await interaction.followUp({
                    content,
                    allowedMentions: { parse: [] },
                    flags: isPrivate ? MessageFlags.Ephemeral : undefined,
                });
                return sent.id;
            },
        });
        if (result.status === 'rate_limited') {
            await interaction.editReply({
                embeds: [
                    warningEmbed('Slow down a moment', result.scope === 'guild'
                        ? `This server has hit its shared AI limit. Try again in ${formatDuration(result.retryAfterMs)}.`
                        : `You have asked a lot in a short time. Try again in ${formatDuration(result.retryAfterMs)}.`),
                ],
            });
            return;
        }
        if (result.status === 'silent') {
            await interaction.editReply({
                embeds: [
                    warningEmbed('A human is handling this', 'This conversation is with the staff team right now, so I am staying out of it. An admin can hand it back to me with `/shin-continue`.'),
                ],
            });
        }
    },
};
//# sourceMappingURL=ask.js.map