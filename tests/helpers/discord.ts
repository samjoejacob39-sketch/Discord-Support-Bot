import {
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';

export interface FakeMemberOptions {
  guildId: string;
  userId: string;
  /** Discord permission bits the member holds in the guild. */
  permissions?: bigint[];
  /** Role ids the member has. */
  roleIds?: string[];
  /** User id of the guild owner; defaults to someone else. */
  ownerId?: string;
}

/**
 * Minimal `GuildMember` stand-in — only the surface `security/permissions.ts` reads.
 * A real `PermissionsBitField` is used so the bit checks are the production ones.
 */
export function fakeMember(options: FakeMemberOptions): GuildMember {
  const permissions = new PermissionsBitField(options.permissions ?? []);
  const roles = new Set(options.roleIds ?? []);
  return {
    id: options.userId,
    permissions,
    guild: { id: options.guildId, ownerId: options.ownerId ?? 'owner-somebody-else' },
    roles: { cache: { has: (roleId: string) => roles.has(roleId) } },
  } as unknown as GuildMember;
}

/** A reply captured from a command handler, so tests can assert what the user was told. */
export interface CapturedReply {
  content?: string;
  ephemeral: boolean;
  embeds: { title?: string; description?: string }[];
}

export interface FakeInteractionOptions {
  guildId: string;
  userId: string;
  subcommand?: string;
  /** Values returned by `options.getUser`, keyed by option name. */
  users?: Record<string, { id: string; bot?: boolean; username?: string }>;
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  booleans?: Record<string, boolean | null>;
  channelId?: string;
  /** Members `guild.members.fetch` can resolve; anything else rejects. */
  guildMembers?: Record<string, GuildMember>;
  /** Command name, for tests that go through the interaction router. */
  commandName?: string;
  /** The invoking member, for tests that go through the interaction router. */
  member?: GuildMember;
  /** Simulate a DM: the router must refuse before touching guild state. */
  cachedGuild?: boolean;
}

export interface FakeInteraction {
  interaction: ChatInputCommandInteraction<'cached'>;
  replies: CapturedReply[];
  /** Convenience: the first reply, which is all most commands send. */
  reply(): CapturedReply | undefined;
}

/**
 * Minimal `ChatInputCommandInteraction` stand-in. Only the surface our command modules
 * actually touch is implemented, and every reply is captured instead of sent.
 */
export function fakeInteraction(options: FakeInteractionOptions): FakeInteraction {
  const replies: CapturedReply[] = [];

  const capture = (payload: any): Promise<void> => {
    const embeds = (payload?.embeds ?? []).map((embed: any) => {
      const json = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
      return { title: json?.title, description: json?.description };
    });
    replies.push({
      content: payload?.content,
      // 64 === MessageFlags.Ephemeral
      ephemeral: Boolean(payload?.ephemeral) || (Number(payload?.flags ?? 0) & 64) !== 0,
      embeds,
    });
    return Promise.resolve();
  };

  const interaction = {
    guildId: options.guildId,
    channelId: options.channelId ?? 'chan-cmd',
    commandName: options.commandName ?? 'unnamed',
    user: { id: options.userId, bot: false },
    member:
      options.member ?? fakeMember({ guildId: options.guildId, userId: options.userId }),
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    inCachedGuild: () => options.cachedGuild !== false,
    guild: {
      id: options.guildId,
      name: 'Test Guild',
      members: {
        fetch: (id: string) => {
          const member = options.guildMembers?.[id];
          return member ? Promise.resolve(member) : Promise.reject(new Error('Unknown Member'));
        },
      },
    },
    options: {
      getSubcommand: () => {
        if (!options.subcommand) throw new Error('no subcommand');
        return options.subcommand;
      },
      getUser: (name: string, required?: boolean) => {
        const user = options.users?.[name];
        if (!user && required) throw new Error(`missing required user option "${name}"`);
        return user ? { ...user, bot: user.bot ?? false } : null;
      },
      getString: (name: string) => options.strings?.[name] ?? null,
      getInteger: (name: string) => options.integers?.[name] ?? null,
      getBoolean: (name: string) => options.booleans?.[name] ?? null,
    },
    replied: false,
    deferred: false,
    reply: capture,
    editReply: capture,
    followUp: capture,
    deferReply: () => Promise.resolve(),
  } as unknown as ChatInputCommandInteraction<'cached'>;

  return { interaction, replies, reply: () => replies[0] };
}
