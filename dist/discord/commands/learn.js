import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { categoryChoices, categoryLabel } from '../../knowledge/categories.js';
import { MAX_KNOWLEDGE_LENGTH } from '../../knowledge/service.js';
import { injectionWarning } from '../../security/injection.js';
import { errorMessage } from '../../util/async.js';
import { formatDuration, parseDuration, preview } from '../../util/text.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
const data = new SlashCommandBuilder()
    .setName('learn')
    .setDescription('Teach the bot something about this server (staff only).')
    .addStringOption((option) => option
    .setName('content')
    .setDescription('What should the bot know? Write it as a normal sentence.')
    .setRequired(true)
    .setMaxLength(MAX_KNOWLEDGE_LENGTH))
    .addStringOption((option) => option
    .setName('category')
    .setDescription('Override the automatically inferred category.')
    .addChoices(...categoryChoices().slice(0, 25)))
    .addStringOption((option) => option
    .setName('duration')
    .setDescription('Make it temporary, e.g. 30m, 6h, 3d. Leave empty for permanent knowledge.'))
    .toJSON();
/**
 * `/learn <free text>` — the primary teaching surface (§4). The content is classified into a
 * structured entry rather than appended to one giant blob, and it is stored as *policy data*:
 * it can never become an instruction that overrides the bot's safety rules.
 */
export const learnCommand = {
    name: 'learn',
    access: 'shin_admin',
    category: 'knowledge',
    summary: 'Teach the bot a fact, policy, FAQ answer or known issue.',
    usage: [
        '`/learn Refunds are only issued within 14 days of purchase.`',
        '`/learn duration:6h The store is down for maintenance.` → temporary knowledge',
    ],
    data,
    async execute({ interaction, ctx }) {
        const content = interaction.options.getString('content', true);
        const category = interaction.options.getString('category') ?? undefined;
        const durationInput = interaction.options.getString('duration');
        let durationMs;
        if (durationInput) {
            const parsed = parseDuration(durationInput);
            if (parsed === null) {
                await interaction.reply({
                    embeds: [
                        errorEmbed('I could not read that duration', 'Use something like `45m`, `12h`, `7d` or `2 weeks` (maximum one year).'),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            durationMs = parsed;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const result = await ctx.knowledge.learn({
                guildId: interaction.guildId,
                actorId: interaction.user.id,
                content,
                category,
                durationMs,
            });
            const { entry, classification } = result;
            const lines = [
                `**${entry.title}**`,
                `> ${preview(entry.content, 300)}`,
                '',
                `Category: ${categoryLabel(entry.category)}${category ? ' (you set this)' : ' (inferred)'}`,
                `Kind: ${entry.kind}${entry.expiresAt ? ` · expires in ${formatDuration(entry.expiresAt - Date.now())}` : ''}`,
                entry.visibility === 'staff' ? 'Visibility: 🔒 staff only — the bot uses it but never quotes it to members.' : 'Visibility: public',
                `Reference: \`#${entry.id}\` · manage it with \`/knowledge show id:${entry.id}\``,
            ];
            if (classification.source === 'heuristic') {
                lines.push('_Categorised locally because the AI classifier was unavailable._');
            }
            const embeds = [successEmbed('Learned', lines.join('\n'))];
            if (result.injection.suspicious) {
                embeds.push(warningEmbed('Stored, with a note', injectionWarning(result.injection.labels)));
            }
            await interaction.editReply({ embeds });
        }
        catch (error) {
            await interaction.editReply({
                embeds: [errorEmbed('I could not save that', errorMessage(error))],
            });
        }
    },
};
//# sourceMappingURL=learn.js.map