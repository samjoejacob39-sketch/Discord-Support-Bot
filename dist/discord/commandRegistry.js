import { PermissionFlagsBits } from 'discord.js';
import { askCommand } from './commands/ask.js';
import { createHelpCommand } from './commands/help.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { learnCommand } from './commands/learn.js';
import { shinadminCommand } from './commands/shinadmin.js';
import { shinconfigCommand } from './commands/shinconfig.js';
import { shinContinueCommand } from './commands/shincontinue.js';
import { shinstatusCommand } from './commands/shinstatus.js';
import { ticketCommand } from './commands/ticket.js';
/**
 * The single list of commands. Registration, the interaction router and `/help` all read from
 * here, so a new command cannot be half-wired.
 */
const MODULES = [
    askCommand,
    learnCommand,
    knowledgeCommand,
    ticketCommand,
    shinContinueCommand,
    shinadminCommand,
    shinconfigCommand,
    shinstatusCommand,
];
export const COMMANDS = [
    ...MODULES,
    // Built last and given a getter so it can list itself without a circular import.
    createHelpCommand(() => COMMANDS),
];
export const COMMAND_MAP = new Map(COMMANDS.map((command) => [command.name, command]));
export function findCommand(name) {
    return COMMAND_MAP.get(name);
}
/**
 * Payload for Discord's API. Guild-only everywhere, and manager-level commands also carry
 * `default_member_permissions` so Discord hides them from ordinary members — the runtime check
 * in the router stays the real gate (§8).
 */
export function commandPayload() {
    return COMMANDS.map((command) => ({
        ...command.data,
        dm_permission: false,
        ...(command.access === 'guild_manager'
            ? { default_member_permissions: String(PermissionFlagsBits.ManageGuild) }
            : {}),
    }));
}
//# sourceMappingURL=commandRegistry.js.map