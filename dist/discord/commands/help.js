import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BOT_NAME, DISCORD_LIMITS } from '../../config/constants.js';
import { infoEmbed } from '../ui/embeds.js';
const RANK = { member: 0, shin_admin: 1, guild_manager: 2 };
const CATEGORY_TITLES = {
    general: '💬 Getting help',
    knowledge: '📚 Teaching me',
    tickets: '🎫 Tickets & hand-off',
    config: '⚙️ Setup',
};
const CATEGORY_ORDER = ['general', 'knowledge', 'tickets', 'config'];
const LEVEL_LABELS = {
    member: 'member',
    shin_admin: 'Shinchat Helper admin',
    guild_manager: 'server manager',
};
const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('What I can do, and which commands you personally can use.')
    .addStringOption((option) => option.setName('command').setDescription('Show details for one command.').setAutocomplete(true))
    .toJSON();
function visible(level, command) {
    return RANK[level] >= RANK[command.access];
}
/**
 * `/help` — grouped and permission-aware (§3): members never see staff commands, and the
 * `/learn` vs `/knowledge` split is spelled out because that trips people up.
 */
export function createHelpCommand(all) {
    return {
        name: 'help',
        access: 'member',
        category: 'general',
        summary: 'List the commands you can use.',
        usage: ['`/help`', '`/help command:learn`'],
        data,
        async autocomplete(interaction) {
            const typed = interaction.options.getFocused().toLowerCase();
            const choices = all()
                .filter((command) => command.name.includes(typed))
                .slice(0, DISCORD_LIMITS.autocompleteChoices)
                .map((command) => ({ name: `/${command.name}`, value: command.name }));
            await interaction.respond(choices);
        },
        async execute({ interaction, level }) {
            const commands = all();
            const requested = interaction.options.getString('command')?.replace(/^\//, '').toLowerCase();
            if (requested) {
                const command = commands.find((entry) => entry.name === requested);
                if (!command || !visible(level, command)) {
                    await interaction.reply({
                        embeds: [
                            infoEmbed('No such command for you', `I have no \`/${requested}\` you can use. Run \`/help\` to see your list.`),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                await interaction.reply({
                    embeds: [
                        infoEmbed(`/${command.name}`, [
                            command.summary,
                            '',
                            `**Who can use it:** ${LEVEL_LABELS[command.access]}`,
                            command.usage && command.usage.length > 0 ? `**Examples**\n${command.usage.join('\n')}` : null,
                        ]
                            .filter(Boolean)
                            .join('\n')),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const embed = infoEmbed(`${BOT_NAME} — how to use me`, [
                'Ask me anything about this server and I answer from what staff have taught me, plus current information from the web when it matters. If I am not sure, I stop and call a human instead of guessing.',
                '',
                'You can just **mention me** in a support channel, or use `/ask`.',
                `You are seeing this as a **${LEVEL_LABELS[level]}**.`,
            ].join('\n'));
            for (const category of CATEGORY_ORDER) {
                const lines = commands
                    .filter((command) => command.category === category && visible(level, command))
                    .map((command) => `\`/${command.name}\` — ${command.summary}`);
                if (lines.length > 0)
                    embed.addFields({ name: CATEGORY_TITLES[category], value: lines.join('\n') });
            }
            if (RANK[level] > RANK.member) {
                embed.addFields({
                    name: 'Teaching vs managing',
                    value: [
                        '`/learn` takes plain sentences — write what I should know and I file it under the right category.',
                        '`/knowledge` is the management side: list, search, show, disable or delete what I was taught.',
                        'Everything is configured here in Discord with `/shinconfig` — there is no website or dashboard.',
                    ].join('\n'),
                });
            }
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        },
    };
}
//# sourceMappingURL=help.js.map