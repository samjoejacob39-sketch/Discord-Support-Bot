import { PermissionFlagsBits } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TimeoutError,
  errorMessage,
  errorStatus,
  isRetryableHttpError,
  retry,
  withTimeout,
} from '../src/util/async.js';
import { RateLimiter } from '../src/security/rateLimiter.js';
import { handleInteraction } from '../src/discord/events/interactionCreate.js';
import { createHarness, seedGuild, type Harness } from './helpers/harness.js';
import { fakeInteraction, fakeMember } from './helpers/discord.js';

const GUILD = 'guild-resilience';

let h: Harness;

beforeEach(() => {
  h = createHarness();
  seedGuild(h.store, GUILD, 'Resilience Test');
});

afterEach(() => {
  h.provider.reset();
  try {
    h.close();
  } catch {
    /* a test may have closed it already */
  }
});

describe('AI provider failures degrade instead of breaking (§53)', () => {
  it('falls back to heuristic classification when /learn cannot reach the model', async () => {
    h.provider.enqueue({ error: new Error('503 model overloaded') });

    const { entry, classification } = await h.ctx.knowledge.learn({
      guildId: GUILD,
      actorId: 'admin-1',
      content: 'Refunds are available within 14 days of purchase.',
    });

    // The teaching still succeeded, with the deterministic classifier behind it.
    expect(classification.source).toBe('heuristic');
    expect(entry.category).toBe('policies');
    expect(h.store.knowledge.count(GUILD)).toBe(1);
  });

  it('retries transient failures with backoff and gives up cleanly', async () => {
    let calls = 0;
    const value = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('rate limited'), { status: 429 });
        return 'ok';
      },
      { attempts: 4, baseDelayMs: 1, retryable: isRetryableHttpError },
    );
    expect(value).toBe('ok');
    expect(calls).toBe(3);

    let fatalCalls = 0;
    await expect(
      retry(
        async () => {
          fatalCalls += 1;
          throw Object.assign(new Error('bad api key'), { status: 401 });
        },
        { attempts: 4, baseDelayMs: 1, retryable: isRetryableHttpError },
      ),
    ).rejects.toThrow('bad api key');
    // 401 is not retryable: it failed fast rather than hammering the API.
    expect(fatalCalls).toBe(1);
  });

  it('classifies which HTTP failures are worth retrying', () => {
    expect(isRetryableHttpError({ status: 429 })).toBe(true);
    expect(isRetryableHttpError({ status: 500 })).toBe(true);
    expect(isRetryableHttpError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableHttpError({ status: 400 })).toBe(false);
    expect(isRetryableHttpError({ status: 403 })).toBe(false);
    // Unknown/network errors get the benefit of the doubt.
    expect(isRetryableHttpError(new Error('socket hang up'))).toBe(true);
    expect(errorStatus({ code: '502' })).toBe(502);
    expect(errorStatus('nope')).toBeUndefined();
    expect(errorMessage({ weird: true })).toContain('weird');
  });

  it('times out a hung provider call instead of hanging the ticket', async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise((resolve) => setTimeout(resolve, 60_000)), 100);
      const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('database failures are handled, not fatal (§60)', () => {
  it('turns a broken command into an apology, not a crash', async () => {
    const member = fakeMember({
      guildId: GUILD,
      userId: 'u-manager',
      permissions: [PermissionFlagsBits.ManageGuild],
    });
    const fake = fakeInteraction({
      guildId: GUILD,
      userId: 'u-manager',
      commandName: 'shinadmin',
      subcommand: 'list',
      member,
    });

    // Simulate the database dying between the permission check and the command body.
    h.db.close();

    await expect(handleInteraction(fake.interaction, h.ctx)).resolves.toBeUndefined();

    const reply = fake.reply();
    expect(reply?.embeds[0]?.title).toContain('That did not work');
    expect(reply?.embeds[0]?.description).toContain('Nothing was changed');
    expect(reply?.ephemeral).toBe(true);
    // No internal detail leaks to the user.
    expect(JSON.stringify(reply)).not.toMatch(/sqlite|SQL|statement/i);
  });

  it('reports a database error as a normal Error the caller can catch', () => {
    h.db.close();
    expect(() => h.store.knowledge.search(GUILD, 'refunds')).toThrow();
    let caught: unknown;
    try {
      h.store.admins.list(GUILD);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(errorMessage(caught)).not.toHaveLength(0);
  });

  it('refuses commands outside a server before touching the database', async () => {
    const fake = fakeInteraction({
      guildId: GUILD,
      userId: 'u-1',
      commandName: 'learn',
      cachedGuild: false,
    });
    h.db.close();

    await handleInteraction(fake.interaction, h.ctx);
    expect(fake.reply()?.embeds[0]?.title).toContain('Server only');
  });

  it('rejects an unknown command name instead of guessing', async () => {
    const fake = fakeInteraction({ guildId: GUILD, userId: 'u-1', commandName: 'definitely-not-real' });
    await handleInteraction(fake.interaction, h.ctx);
    expect(fake.reply()?.embeds[0]?.title).toContain('Unknown command');
  });

  it('blocks a plain member at the router, before the command body runs', async () => {
    const fake = fakeInteraction({
      guildId: GUILD,
      userId: 'u-plain',
      commandName: 'shinadmin',
      subcommand: 'list',
      member: fakeMember({ guildId: GUILD, userId: 'u-plain' }),
    });

    await handleInteraction(fake.interaction, h.ctx);
    expect(fake.reply()?.embeds[0]?.title).toContain('Not allowed');
    expect(fake.reply()?.ephemeral).toBe(true);
  });
});

describe('rate limiting protects the API budget (§54, §55)', () => {
  it('limits one member without starving the rest of the server', () => {
    const limiter = new RateLimiter(2, 10, 60_000);
    const now = 1_000_000;

    expect(limiter.check(GUILD, 'u-1', now).allowed).toBe(true);
    expect(limiter.check(GUILD, 'u-1', now).allowed).toBe(true);

    const blocked = limiter.check(GUILD, 'u-1', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('user');
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // Someone else is unaffected.
    expect(limiter.check(GUILD, 'u-2', now).allowed).toBe(true);
  });

  it('applies a separate guild-wide ceiling and reports which one tripped', () => {
    const limiter = new RateLimiter(50, 2, 60_000);
    const now = 2_000_000;

    limiter.check(GUILD, 'u-1', now);
    limiter.check(GUILD, 'u-2', now);
    const blocked = limiter.check(GUILD, 'u-3', now);

    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('guild');
    // A different server has its own budget.
    expect(limiter.check('other-guild', 'u-3', now).allowed).toBe(true);
  });

  it('reopens the window when it expires and prunes stale buckets', () => {
    const limiter = new RateLimiter(1, 1, 60_000);
    const now = 3_000_000;

    expect(limiter.check(GUILD, 'u-1', now).allowed).toBe(true);
    expect(limiter.check(GUILD, 'u-1', now).allowed).toBe(false);
    expect(limiter.check(GUILD, 'u-1', now + 60_001).allowed).toBe(true);

    limiter.prune(now + 200_000);
    expect(limiter.check(GUILD, 'u-1', now + 200_001).allowed).toBe(true);
    limiter.reset();
    expect(limiter.check(GUILD, 'u-1', now).allowed).toBe(true);
  });

  it('supports a named limiter for expensive admin actions', () => {
    const limiter = new RateLimiter(10, 100, 60_000);
    const now = 4_000_000;

    expect(limiter.checkCustom('learn:admin-1', 1, 5000, now).allowed).toBe(true);
    expect(limiter.checkCustom('learn:admin-1', 1, 5000, now).allowed).toBe(false);
    expect(limiter.checkCustom('learn:admin-2', 1, 5000, now).allowed).toBe(true);
    expect(limiter.checkCustom('learn:admin-1', 1, 5000, now + 5001).allowed).toBe(true);
  });
});
