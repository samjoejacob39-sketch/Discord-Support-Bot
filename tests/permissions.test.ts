import { PermissionFlagsBits } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMANDS, COMMAND_MAP, commandPayload, findCommand } from '../src/discord/commandRegistry.js';
import {
  isGuildManager,
  isShinAdmin,
  requireGuildManager,
  requireShinAdmin,
  resolveAccess,
} from '../src/security/permissions.js';
import { createHarness, seedGuild, type Harness } from './helpers/harness.js';
import { fakeMember } from './helpers/discord.js';

const GUILD = 'guild-perm-1';

let h: Harness;

beforeEach(() => {
  h = createHarness();
  seedGuild(h.store, GUILD);
});

afterEach(() => h.close());

describe('access levels (§8)', () => {
  it('treats the server owner as a guild manager', () => {
    const owner = fakeMember({ guildId: GUILD, userId: 'u-owner', ownerId: 'u-owner' });
    expect(isGuildManager(owner, h.store.guilds.getSettings(GUILD))).toBe(true);
    expect(resolveAccess(h.store, owner, h.store.guilds.getSettings(GUILD))).toBe('guild_manager');
  });

  it('accepts Administrator and Manage Server, and nothing weaker', () => {
    const settings = h.store.guilds.getSettings(GUILD);
    const admin = fakeMember({ guildId: GUILD, userId: 'u-a', permissions: [PermissionFlagsBits.Administrator] });
    const manager = fakeMember({ guildId: GUILD, userId: 'u-m', permissions: [PermissionFlagsBits.ManageGuild] });
    const moderator = fakeMember({
      guildId: GUILD,
      userId: 'u-mod',
      permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers],
    });

    expect(isGuildManager(admin, settings)).toBe(true);
    expect(isGuildManager(manager, settings)).toBe(true);
    // A moderator with strong moderation powers is still not a configuration authority.
    expect(isGuildManager(moderator, settings)).toBe(false);
  });

  it('honours the configured trusted role and only that role', () => {
    h.store.guilds.update(GUILD, { trustedRoleId: 'role-trusted' });
    const settings = h.store.guilds.getSettings(GUILD);

    const trusted = fakeMember({ guildId: GUILD, userId: 'u-t', roleIds: ['role-trusted'] });
    const other = fakeMember({ guildId: GUILD, userId: 'u-o', roleIds: ['role-random'] });

    expect(isGuildManager(trusted, settings)).toBe(true);
    expect(isGuildManager(other, settings)).toBe(false);
  });

  it('does not let a plain member reach shin-admin commands', () => {
    const settings = h.store.guilds.getSettings(GUILD);
    const member = fakeMember({ guildId: GUILD, userId: 'u-plain' });

    expect(resolveAccess(h.store, member, settings)).toBe('member');
    expect(requireShinAdmin(h.store, member, settings).allowed).toBe(false);
    expect(requireGuildManager(h.store, member, settings).allowed).toBe(false);
    expect(requireShinAdmin(h.store, member, settings).reason).toContain('/shinadmin add');
  });

  it('promotes a member only when a manager actually added them', () => {
    const settings = h.store.guilds.getSettings(GUILD);
    const member = fakeMember({ guildId: GUILD, userId: 'u-plain' });

    expect(isShinAdmin(h.store, member, settings)).toBe(false);
    h.store.admins.add(GUILD, 'u-plain', 'u-owner');

    expect(isShinAdmin(h.store, member, settings)).toBe(true);
    expect(resolveAccess(h.store, member, settings)).toBe('shin_admin');
    // Being a Shinchat admin never grants configuration authority.
    expect(requireGuildManager(h.store, member, settings).allowed).toBe(false);
  });

  it('cannot be self-granted: a shin admin in one guild is a plain member in another', () => {
    seedGuild(h.store, 'guild-perm-2');
    h.store.admins.add(GUILD, 'u-x', 'u-owner');

    const here = fakeMember({ guildId: GUILD, userId: 'u-x' });
    const there = fakeMember({ guildId: 'guild-perm-2', userId: 'u-x' });

    expect(requireShinAdmin(h.store, here, h.store.guilds.getSettings(GUILD)).allowed).toBe(true);
    expect(requireShinAdmin(h.store, there, h.store.guilds.getSettings('guild-perm-2')).allowed).toBe(false);
  });

  it('a fresh install is never locked out: a manager is implicitly a shin admin', () => {
    const settings = h.store.guilds.getSettings(GUILD);
    const manager = fakeMember({ guildId: GUILD, userId: 'u-m', permissions: [PermissionFlagsBits.ManageGuild] });

    expect(h.store.admins.count(GUILD)).toBe(0);
    expect(requireShinAdmin(h.store, manager, settings).allowed).toBe(true);
  });
});

describe('command registry gating (§33)', () => {
  const restricted = ['learn', 'knowledge', 'shinadmin', 'shin-continue', 'ticket', 'shinconfig', 'shinstatus'];

  it('exposes every command exactly once and keeps the map in sync', () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(COMMAND_MAP.get(name)?.name).toBe(name);
    expect(findCommand('definitely-not-a-command')).toBeUndefined();
  });

  it('restricts every privileged command and leaves only /help and /ask open', () => {
    for (const name of restricted) {
      const command = findCommand(name);
      expect(command, `${name} should exist`).toBeDefined();
      expect(command?.access, `${name} must not be member-accessible`).not.toBe('member');
    }
    expect(findCommand('help')?.access).toBe('member');
    expect(findCommand('ask')?.access).toBe('member');
  });

  it('keeps configuration commands behind Manage Server at the Discord layer too', () => {
    const payload = commandPayload();
    const byName = new Map(payload.map((command) => [command.name, command]));

    const config = byName.get('shinconfig');
    expect(config?.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
    expect(byName.get('shinadmin')?.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));

    // Nothing is usable in DMs: every guard depends on guild state.
    for (const command of payload) expect(command.dm_permission).toBe(false);
  });
});
