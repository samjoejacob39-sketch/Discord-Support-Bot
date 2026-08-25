import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { AUDIT_ACTIONS } from '../../db/repositories/audit.js';
import { isGuildManager } from '../../security/permissions.js';
import { relativeTimestamp } from '../../util/text.js';
import { errorEmbed, infoEmbed, successEmbed } from '../ui/embeds.js';
const data = new SlashCommandBuilder()
    .setName('shinadmin')
    .setDescription('Manage who may teach and control the bot (server managers only).')
    .addSubcommand((sub) => sub
    .setName('add')
    .setDescription('Grant Shinchat Helper admin rights.')
    .addUserOption((option) => option.setName('user').setDescription('The member to promote.').setRequired(true)))
    .addSubcommand((sub) => sub
    .setName('remove')
    .setDescription('Revoke Shinchat Helper admin rights.')
    .addUserOption((option) => option.setName('user').setDescription('The member to demote.').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the current Shinchat Helper admins.'))
    .toJSON();
/**
 * `/shinadmin` — stores real user IDs so escalation pings actually notify someone (§9), and is
 * itself restricted to guild managers so no member can promote themselves (§8).
 */
export const shinadminCommand = {
    name: 'shinadmin',
    access: 'guild_manager',
    category: 'config',
    summary: 'Add, remove or list the bot’s admins.',
    usage: ['`/shinadmin add user:@Mod`', '`/shinadmin list`'],
    data,
    async execute({ interaction, ctx, settings }) {
        const guildId = interaction.guildId;
        const sub = interaction.options.getSubcommand();
        if (sub === 'list') {
            const admins = ctx.store.admins.list(guildId);
            const lines = admins.map((admin) => `• <@${admin.userId}> — added by <@${admin.addedBy}> ${relativeTimestamp(admin.addedAt)}`);
            await interaction.reply({
                embeds: [
                    infoEmbed('Shinchat Helper admins', [
                        lines.length > 0 ? lines.join('\n') : '_Nobody has been added yet._',
                        '',
                        'Server managers (owner, **Administrator**, **Manage Server**' +
                            (settings.trustedRoleId ? `, <@&${settings.trustedRoleId}>` : '') +
                            ') always have access.',
                    ].join('\n')),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const target = interaction.options.getUser('user', true);
        if (target.bot) {
            await interaction.reply({
                embeds: [errorEmbed('Not a person', 'Bots cannot be Shinchat Helper admins.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (sub === 'add') {
            const added = ctx.store.admins.add(guildId, target.id, interaction.user.id);
            if (added) {
                ctx.store.audit.record(guildId, interaction.user.id, AUDIT_ACTIONS.adminAdd, target.id);
            }
            await interaction.reply({
                embeds: [
                    added
                        ? successEmbed('Admin added', `<@${target.id}> can now use \`/learn\`, \`/knowledge\`, \`/ticket\` and \`/shin-continue\`, and will be pinged on escalations.`)
                        : infoEmbed('Already an admin', `<@${target.id}> already had access.`),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const removed = ctx.store.admins.remove(guildId, target.id);
        if (removed)
            ctx.store.audit.record(guildId, interaction.user.id, AUDIT_ACTIONS.adminRemove, target.id);
        const stillManager = await interaction.guild.members
            .fetch(target.id)
            .then((member) => isGuildManager(member, settings))
            .catch(() => false);
        await interaction.reply({
            embeds: [
                removed
                    ? successEmbed('Admin removed', `<@${target.id}> no longer has bot admin rights.` +
                        (stillManager ? '\n\n_They still manage this server, so they keep access that way._' : ''))
                    : infoEmbed('Nothing to do', `<@${target.id}> was not on the list.`),
            ],
            flags: MessageFlags.Ephemeral,
        });
    },
};
//# sourceMappingURL=shinadmin.js.map