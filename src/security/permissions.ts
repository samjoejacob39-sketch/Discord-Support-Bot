import { PermissionFlagsBits, type GuildMember, type PermissionsBitField } from 'discord.js';
import type { Store } from '../db/repositories/index.js';
import type { GuildSettings } from '../db/types.js';

export type AccessLevel = 'member' | 'shin_admin' | 'guild_manager';

export interface AccessDecision {
  allowed: boolean;
  level: AccessLevel;
  reason?: string;
}

function hasAny(permissions: Readonly<PermissionsBitField>, ...flags: bigint[]): boolean {
  return flags.some((flag) => permissions.has(flag));
}

/**
 * Guild managers are the root of trust: the owner, anyone with Administrator or
 * Manage Server, or a member of the configured trusted role. Only they may promote
 * Shinchat Helper admins or change where the bot operates.
 */
export function isGuildManager(member: GuildMember, settings: GuildSettings | undefined): boolean {
  if (member.guild.ownerId === member.id) return true;
  if (hasAny(member.permissions, PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild)) return true;
  if (settings?.trustedRoleId && member.roles.cache.has(settings.trustedRoleId)) return true;
  return false;
}

/**
 * Shinchat Helper admins may teach knowledge, manage tickets and resume the AI.
 * Guild managers implicitly qualify so a fresh install is never locked out.
 */
export function isShinAdmin(store: Store, member: GuildMember, settings: GuildSettings | undefined): boolean {
  if (isGuildManager(member, settings)) return true;
  return store.admins.isAdmin(member.guild.id, member.id);
}

export function resolveAccess(store: Store, member: GuildMember, settings: GuildSettings | undefined): AccessLevel {
  if (isGuildManager(member, settings)) return 'guild_manager';
  if (store.admins.isAdmin(member.guild.id, member.id)) return 'shin_admin';
  return 'member';
}

export function requireGuildManager(
  store: Store,
  member: GuildMember,
  settings: GuildSettings | undefined,
): AccessDecision {
  const level = resolveAccess(store, member, settings);
  if (level === 'guild_manager') return { allowed: true, level };
  return {
    allowed: false,
    level,
    reason:
      'Only the server owner, members with **Administrator**/**Manage Server**, or the configured trusted role can use this command.',
  };
}

export function requireShinAdmin(
  store: Store,
  member: GuildMember,
  settings: GuildSettings | undefined,
): AccessDecision {
  const level = resolveAccess(store, member, settings);
  if (level !== 'member') return { allowed: true, level };
  return {
    allowed: false,
    level,
    reason:
      'This command is limited to Shinchat Helper admins. Ask a server manager to add you with `/shinadmin add`.',
  };
}

/** Discord permissions the bot itself needs in a channel to run a support conversation. */
export const REQUIRED_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
] as const;
