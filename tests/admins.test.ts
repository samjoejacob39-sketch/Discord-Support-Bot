import { PermissionFlagsBits } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/db/repositories/audit.js';
import { shinadminCommand } from '../src/discord/commands/shinadmin.js';
import { requireGuildManager, requireShinAdmin } from '../src/security/permissions.js';
import { createHarness, seedGuild, type Harness } from './helpers/harness.js';
import { fakeInteraction, fakeMember } from './helpers/discord.js';

const GUILD = 'guild-admins';
const MANAGER = 'u-manager';

let h: Harness;

beforeEach(() => {
  h = createHarness();
  seedGuild(h.store, GUILD, 'Admin Test');
});

afterEach(() => h.close());

function settings() {
  return h.store.guilds.getSettings(GUILD)!;
}

/** Run `/shinadmin <sub>` as a guild manager and hand back what the invoker was told. */
async function run(
  subcommand: 'add' | 'remove' | 'list',
  target?: { id: string; bot?: boolean },
  extra: { guildMembers?: Record<string, ReturnType<typeof fakeMember>> } = {},
) {
  const fake = fakeInteraction({
    guildId: GUILD,
    userId: MANAGER,
    subcommand,
    users: target ? { user: target } : undefined,
    guildMembers: extra.guildMembers,
  });
  await shinadminCommand.execute({
    interaction: fake.interaction,
    ctx: h.ctx,
    member: fakeMember({ guildId: GUILD, userId: MANAGER, permissions: [PermissionFlagsBits.ManageGuild] }),
    settings: settings(),
    level: 'guild_manager',
  });
  return fake;
}

describe('/shinadmin storage (§7, §9)', () => {
  it('stores the user ID, not a display name, so pings actually notify', async () => {
    await run('add', { id: '123456789012345678' });

    const admins = h.store.admins.list(GUILD);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.userId).toBe('123456789012345678');
    expect(admins[0]?.addedBy).toBe(MANAGER);
    expect(admins[0]?.addedAt).toBeGreaterThan(0);
    // The escalation path consumes plain IDs, ready for `<@id>`.
    expect(h.store.admins.listIds(GUILD)).toEqual(['123456789012345678']);
  });

  it('is idempotent: adding twice reports it instead of duplicating the row', async () => {
    const first = await run('add', { id: 'u-mod' });
    expect(first.reply()?.embeds[0]?.title).toContain('Admin added');

    const second = await run('add', { id: 'u-mod' });
    expect(second.reply()?.embeds[0]?.title).toContain('Already an admin');
    expect(h.store.admins.count(GUILD)).toBe(1);
  });

  it('removes an admin and says so honestly when there was nothing to remove', async () => {
    await run('add', { id: 'u-mod' });

    const removed = await run('remove', { id: 'u-mod' });
    expect(removed.reply()?.embeds[0]?.title).toContain('Admin removed');
    expect(h.store.admins.isAdmin(GUILD, 'u-mod')).toBe(false);

    const again = await run('remove', { id: 'u-mod' });
    expect(again.reply()?.embeds[0]?.title).toContain('Nothing to do');
  });

  it('points out when a removed admin still has access as a server manager', async () => {
    await run('add', { id: 'u-boss' });
    const stillManager = fakeMember({
      guildId: GUILD,
      userId: 'u-boss',
      permissions: [PermissionFlagsBits.Administrator],
    });

    const reply = (await run('remove', { id: 'u-boss' }, { guildMembers: { 'u-boss': stillManager } })).reply();
    expect(reply?.embeds[0]?.description).toContain('still manage this server');
  });

  it('refuses to promote a bot', async () => {
    const reply = (await run('add', { id: 'u-bot', bot: true })).reply();
    expect(reply?.embeds[0]?.title).toContain('Not a person');
    expect(h.store.admins.count(GUILD)).toBe(0);
  });

  it('lists admins with who added them, and says so plainly when empty', async () => {
    const empty = (await run('list')).reply();
    expect(empty?.embeds[0]?.description).toContain('Nobody has been added yet');

    await run('add', { id: 'u-a' });
    const listed = (await run('list')).reply();
    expect(listed?.embeds[0]?.description).toContain('<@u-a>');
    expect(listed?.embeds[0]?.description).toContain(`added by <@${MANAGER}>`);
  });

  it('keeps every reply ephemeral so the admin list is not broadcast', async () => {
    const added = await run('add', { id: 'u-a' });
    const listed = await run('list');
    for (const reply of [...added.replies, ...listed.replies]) expect(reply.ephemeral).toBe(true);
  });

  it('mentions the configured trusted role in the list so the trust root is visible', async () => {
    h.store.guilds.update(GUILD, { trustedRoleId: 'role-trusted' });
    const reply = (await run('list')).reply();
    expect(reply?.embeds[0]?.description).toContain('<@&role-trusted>');
  });
});

describe('/shinadmin auditing (§33)', () => {
  it('records who promoted whom, and when, scoped to this server', async () => {
    await run('add', { id: 'u-mod' });

    const audit = h.store.audit.list(GUILD, 10);
    const row = audit.find((entry) => entry.action === AUDIT_ACTIONS.adminAdd);
    expect(row).toBeDefined();
    expect(row?.actorId).toBe(MANAGER);
    expect(row?.target).toBe('u-mod');
    expect(row?.guildId).toBe(GUILD);
    expect(row?.createdAt).toBeGreaterThan(0);
  });

  it('records removals and writes nothing for a no-op', async () => {
    await run('add', { id: 'u-mod' });
    await run('remove', { id: 'u-mod' });
    await run('remove', { id: 'u-mod' });

    const removals = h.store.audit.list(GUILD, 20).filter((row) => row.action === AUDIT_ACTIONS.adminRemove);
    expect(removals).toHaveLength(1);

    // A duplicate add is not a change either, so it leaves no trail.
    await run('add', { id: 'u-mod' });
    await run('add', { id: 'u-mod' });
    expect(h.store.audit.list(GUILD, 20).filter((row) => row.action === AUDIT_ACTIONS.adminAdd)).toHaveLength(2);
  });

  it('never lets the audit log of one server leak into another', async () => {
    seedGuild(h.store, 'guild-admins-b');
    await run('add', { id: 'u-mod' });

    expect(h.store.audit.count(GUILD)).toBeGreaterThan(0);
    expect(h.store.audit.count('guild-admins-b')).toBe(0);
    expect(h.store.admins.list('guild-admins-b')).toEqual([]);
  });
});

describe('promotion cannot be self-service (§8)', () => {
  it('gates the command itself at guild-manager level', () => {
    expect(shinadminCommand.access).toBe('guild_manager');

    const member = fakeMember({ guildId: GUILD, userId: 'u-plain' });
    expect(requireGuildManager(h.store, member, settings()).allowed).toBe(false);

    // Even after being promoted, a shin admin still cannot run /shinadmin.
    h.store.admins.add(GUILD, 'u-plain', MANAGER);
    expect(requireShinAdmin(h.store, member, settings()).allowed).toBe(true);
    expect(requireGuildManager(h.store, member, settings()).allowed).toBe(false);
  });
});
