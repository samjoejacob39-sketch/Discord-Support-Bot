import { MessageFlags, SlashCommandBuilder, version as djsVersion } from 'discord.js';
import { BOT_NAME } from '../../config/constants.js';
import { STATE_LABELS } from '../../tickets/stateMachine.js';
import { formatDuration, pluralize } from '../../util/text.js';
import { infoEmbed } from '../ui/embeds.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const data = new SlashCommandBuilder()
    .setName('shinstatus')
    .setDescription('Health, activity and cost overview for this server (staff only).')
    .toJSON();
/** `/shinstatus` — the operator's view: is the AI healthy, what is it costing, what is waiting (§54). */
export const shinstatusCommand = {
    name: 'shinstatus',
    access: 'shin_admin',
    category: 'config',
    summary: 'Provider health, ticket load and 24-hour AI usage.',
    usage: ['`/shinstatus`'],
    data,
    async execute({ interaction, ctx, settings }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guildId = interaction.guildId;
        const health = await ctx.provider.health().catch((error) => ({ ok: false, detail: String(error) }));
        const usage = ctx.store.telemetry.usageSince(guildId, Date.now() - DAY_MS);
        const states = ctx.store.tickets.countByState(guildId);
        const knowledge = ctx.knowledge.stats(guildId);
        const openEscalations = ctx.store.escalations.countOpen(guildId);
        const admins = ctx.store.admins.list(guildId).length;
        const ticketLines = Object.entries(states)
            .filter(([, count]) => count > 0)
            .map(([state, count]) => `${STATE_LABELS[state] ?? state} — ${count}`)
            .join('\n');
        const escalationRate = usage.requests > 0 ? `${Math.round((usage.escalations / usage.requests) * 100)}%` : 'n/a';
        const embed = infoEmbed(`${BOT_NAME} status`, [
            `**AI provider:** ${ctx.provider.name} · ${health.ok ? '🟢 reachable' : `🔴 problem${health.detail ? ` — ${health.detail}` : ''}`}`,
            `**Models:** \`${ctx.provider.modelFor('main')}\` main · \`${ctx.provider.modelFor('fast')}\` fast`,
            `**Web search:** ${ctx.web.searchEnabled ? `on (${ctx.web.providerName})` : 'off'} · **page fetch:** ${ctx.web.fetchAllowed ? 'on' : 'off'}`,
            `**AI answering here:** ${settings.aiEnabled ? 'on' : '**off**'} · mode \`${settings.supportMode}\``,
            `**Uptime:** ${formatDuration(Date.now() - ctx.startedAt)} · **servers:** ${ctx.store.guilds.countActive()}`,
        ].join('\n')).addFields({
            name: 'Last 24 hours',
            value: [
                `${pluralize(usage.requests, 'AI reply', 'AI replies')}`,
                `${usage.escalations} escalated (${escalationRate})`,
                `${usage.webCalls} used the web`,
                `${usage.inputTokens.toLocaleString('en-US')} in / ${usage.outputTokens.toLocaleString('en-US')} out tokens`,
            ].join('\n'),
            inline: true,
        }, {
            name: 'Knowledge',
            value: [
                `${knowledge.active} active of ${knowledge.total}`,
                `${pluralize(knowledge.incidents, 'incident')}`,
                `${knowledge.temporary} temporary`,
                `${pluralize(admins, 'bot admin')}`,
            ].join('\n'),
            inline: true,
        }, {
            name: 'Tickets',
            value: ticketLines.length > 0 ? ticketLines : '_None yet._',
            inline: false,
        });
        if (openEscalations > 0) {
            embed.addFields({
                name: '🚨 Waiting for humans',
                value: `${pluralize(openEscalations, 'open escalation')}. See them with \`/ticket list\`, then hand back with \`/shin-continue\`.`,
            });
        }
        embed.setFooter({ text: `discord.js ${djsVersion} · node ${process.version}` });
        await interaction.editReply({ embeds: [embed] });
    },
};
//# sourceMappingURL=shinstatus.js.map