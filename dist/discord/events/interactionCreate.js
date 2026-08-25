import { MessageFlags, } from 'discord.js';
import { child } from '../../logging/logger.js';
import { requireGuildManager, requireShinAdmin, resolveAccess } from '../../security/permissions.js';
import { errorMessage } from '../../util/async.js';
import { findCommand } from '../commandRegistry.js';
import { errorEmbed } from '../ui/embeds.js';
const log = child('discord:interactions');
/** Ephemeral failure reply that works before or after a defer. */
async function fail(interaction, title, detail) {
    const embeds = [errorEmbed(title, detail)];
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds });
        }
        else {
            await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
        }
    }
    catch (error) {
        log.warn({ err: errorMessage(error) }, 'could not deliver failure reply');
    }
}
/**
 * The one place command access is enforced (§8, §33). Commands declare a level; nothing runs
 * until it is verified against live server state, so a member can never reach a staff command
 * even if Discord's own gating is misconfigured.
 */
export async function handleInteraction(interaction, ctx) {
    if (interaction.isAutocomplete()) {
        if (!interaction.inCachedGuild())
            return;
        const command = findCommand(interaction.commandName);
        if (!command?.autocomplete)
            return;
        try {
            await command.autocomplete(interaction, ctx);
        }
        catch (error) {
            log.warn({ command: interaction.commandName, err: errorMessage(error) }, 'autocomplete failed');
        }
        return;
    }
    if (!interaction.isChatInputCommand())
        return;
    if (!interaction.inCachedGuild()) {
        await fail(interaction, 'Server only', 'Shinchat Helper works inside a server, not in direct messages. Use the commands in your community.');
        return;
    }
    const command = findCommand(interaction.commandName);
    if (!command) {
        log.warn({ command: interaction.commandName }, 'unknown command');
        await fail(interaction, 'Unknown command', 'That command is no longer available. Try `/help`.');
        return;
    }
    // Everything below reads live server state, so a database failure must still produce a reply
    // rather than leaving the member staring at "the application did not respond".
    try {
        const settings = ctx.store.guilds.settingsOrDefault(interaction.guildId);
        const member = interaction.member;
        if (command.access !== 'member') {
            const decision = command.access === 'guild_manager'
                ? requireGuildManager(ctx.store, member, settings)
                : requireShinAdmin(ctx.store, member, settings);
            if (!decision.allowed) {
                await interaction.reply({
                    embeds: [errorEmbed('Not allowed', decision.reason ?? 'You cannot use this command.')],
                    flags: MessageFlags.Ephemeral,
                });
                log.info({ guildId: interaction.guildId, userId: member.id, command: command.name }, 'access denied');
                return;
            }
        }
        const level = resolveAccess(ctx.store, member, settings);
        await command.execute({ interaction, ctx, member, settings, level });
    }
    catch (error) {
        log.error({ guildId: interaction.guildId, command: command.name, err: errorMessage(error) }, 'command failed');
        await fail(interaction, 'That did not work', 'Something broke on my side. Nothing was changed. Please try again — if it keeps failing, tell a server manager.');
    }
}
//# sourceMappingURL=interactionCreate.js.map