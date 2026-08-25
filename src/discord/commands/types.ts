import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { GuildSettings } from '../../db/types.js';
import type { AccessLevel } from '../../security/permissions.js';
import type { BotContext } from '../context.js';

/** Everything a command handler is given, resolved once by the interaction router. */
export interface CommandInvocation {
  interaction: ChatInputCommandInteraction<'cached'>;
  ctx: BotContext;
  member: GuildMember;
  settings: GuildSettings;
  level: AccessLevel;
}

export type CommandCategory = 'general' | 'knowledge' | 'tickets' | 'config';

export interface CommandModule {
  name: string;
  /** Minimum access level. Enforced centrally, before `execute` ever runs. */
  access: AccessLevel;
  category: CommandCategory;
  /** One-line description used by `/help`. */
  summary: string;
  /** Extra usage lines for `/help`. */
  usage?: string[];
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(invocation: CommandInvocation): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<'cached'>, ctx: BotContext): Promise<void>;
}
