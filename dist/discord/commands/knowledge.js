import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { categoryChoices, categoryLabel } from '../../knowledge/categories.js';
import { pluralize } from '../../util/text.js';
import { errorEmbed, infoEmbed, knowledgeEmbed, knowledgeListEmbed, successEmbed } from '../ui/embeds.js';
import { paginate } from '../ui/pagination.js';
const PAGE_SIZE = 5;
const data = new SlashCommandBuilder()
    .setName('knowledge')
    .setDescription('Manage what the bot has been taught (staff only).')
    .addSubcommand((sub) => sub
    .setName('list')
    .setDescription('Browse stored knowledge.')
    .addStringOption((option) => option.setName('category').setDescription('Only this category.').addChoices(...categoryChoices().slice(0, 25)))
    .addStringOption((option) => option
    .setName('kind')
    .setDescription('Only this kind.')
    .addChoices({ name: 'permanent', value: 'permanent' }, { name: 'temporary', value: 'temporary' }, { name: 'incident', value: 'incident' }))
    .addStringOption((option) => option
    .setName('status')
    .setDescription('Default: active only.')
    .addChoices({ name: 'active', value: 'active' }, { name: 'inactive', value: 'inactive' }, { name: 'expired', value: 'expired' }, { name: 'any', value: 'any' })))
    .addSubcommand((sub) => sub
    .setName('search')
    .setDescription('Find knowledge by keyword.')
    .addStringOption((option) => option.setName('query').setDescription('Keywords.').setRequired(true)))
    .addSubcommand((sub) => sub
    .setName('show')
    .setDescription('Show one entry in full.')
    .addIntegerOption((option) => option.setName('id').setDescription('Entry id.').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub
    .setName('remove')
    .setDescription('Delete an entry permanently.')
    .addIntegerOption((option) => option.setName('id').setDescription('Entry id.').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub
    .setName('disable')
    .setDescription('Keep the entry but stop using it.')
    .addIntegerOption((option) => option.setName('id').setDescription('Entry id.').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub
    .setName('enable')
    .setDescription('Start using a disabled entry again.')
    .addIntegerOption((option) => option.setName('id').setDescription('Entry id.').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('stats').setDescription('Counts per category and kind.'))
    .toJSON();
async function runList({ interaction, ctx }) {
    const category = interaction.options.getString('category') ?? undefined;
    const kind = interaction.options.getString('kind') ?? undefined;
    const status = interaction.options.getString('status') ?? undefined;
    const guildId = interaction.guildId;
    const total = ctx.knowledge.count(guildId, { category, kind, status });
    if (total === 0) {
        await interaction.reply({
            embeds: [infoEmbed('Nothing stored yet', 'Teach the bot with `/learn <what it should know>`.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const filters = [category ? categoryLabel(category) : null, kind, status && status !== 'active' ? status : null]
        .filter(Boolean)
        .join(' · ');
    await paginate({
        interaction,
        pageCount,
        render: (page) => knowledgeListEmbed({
            entries: ctx.knowledge.list(guildId, {
                category,
                kind,
                status,
                limit: PAGE_SIZE,
                offset: (page - 1) * PAGE_SIZE,
            }),
            page,
            pageCount,
            total,
            heading: filters ? `Knowledge · ${filters}` : 'Knowledge',
        }),
    });
}
async function runSearch({ interaction, ctx }) {
    const query = interaction.options.getString('query', true);
    const entries = ctx.knowledge.search(interaction.guildId, query, 10);
    if (entries.length === 0) {
        await interaction.reply({
            embeds: [infoEmbed('No matches', `Nothing stored matches **${query}**.`)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const pageCount = Math.ceil(entries.length / PAGE_SIZE);
    await paginate({
        interaction,
        pageCount,
        render: (page) => knowledgeListEmbed({
            entries: entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
            page,
            pageCount,
            total: entries.length,
            heading: `Search · ${query}`,
        }),
    });
}
/** `/knowledge …` — management verbs live here because `/learn` takes free text (§4 vs §20). */
export const knowledgeCommand = {
    name: 'knowledge',
    access: 'shin_admin',
    category: 'knowledge',
    summary: 'List, search, inspect, disable or delete stored knowledge.',
    usage: ['`/knowledge list category:policies`', '`/knowledge search query:refund`', '`/knowledge remove id:12`'],
    data,
    async execute(invocation) {
        const { interaction, ctx } = invocation;
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        if (sub === 'list')
            return runList(invocation);
        if (sub === 'search')
            return runSearch(invocation);
        if (sub === 'stats') {
            const stats = ctx.knowledge.stats(guildId);
            const byCategory = stats.byCategory
                .map((row) => `${categoryLabel(row.category)} — ${row.count}`)
                .join('\n');
            await interaction.reply({
                embeds: [
                    infoEmbed('Knowledge overview', [
                        `**${stats.active}** active of ${stats.total} total`,
                        `🚨 ${pluralize(stats.incidents, 'incident')} · ⏳ ${stats.temporary} temporary`,
                        '',
                        byCategory || '_No categories yet._',
                    ].join('\n')),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const id = interaction.options.getInteger('id', true);
        const entry = ctx.knowledge.get(guildId, id);
        if (!entry) {
            await interaction.reply({
                embeds: [errorEmbed('Not found', `No knowledge entry \`#${id}\` in this server.`)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (sub === 'show') {
            await interaction.reply({ embeds: [knowledgeEmbed(entry)], flags: MessageFlags.Ephemeral });
            return;
        }
        if (sub === 'remove') {
            ctx.knowledge.remove(guildId, id, interaction.user.id);
            await interaction.reply({
                embeds: [successEmbed('Deleted', `\`#${id}\` **${entry.title}** is gone. The bot will no longer use it.`)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const enable = sub === 'enable';
        ctx.knowledge.setEnabled(guildId, id, enable, interaction.user.id);
        await interaction.reply({
            embeds: [
                successEmbed(enable ? 'Enabled' : 'Disabled', `\`#${id}\` **${entry.title}** is now ${enable ? 'active again' : 'ignored, but kept'}.`),
            ],
            flags: MessageFlags.Ephemeral,
        });
    },
};
//# sourceMappingURL=knowledge.js.map