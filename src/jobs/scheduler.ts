import type { Client } from 'discord.js';
import { TIMINGS } from '../config/constants.js';
import { child } from '../logging/logger.js';
import { errorMessage } from '../util/async.js';
import type { BotContext } from '../discord/context.js';
import { refreshPresence } from '../discord/presence.js';

const log = child('jobs');

const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface Scheduler {
  start(client: Client<true>): void;
  stop(): void;
  /** Run every job once — used by tests and on boot. */
  runOnce(client?: Client<true>): void;
}

/**
 * Background maintenance. Everything here is cheap, local and idempotent: expiring temporary
 * knowledge (§19), trimming the duplicate-answer cache and rate-limit buckets (§55), and
 * refreshing presence (§57).
 */
export function createScheduler(ctx: BotContext): Scheduler {
  const timers: NodeJS.Timeout[] = [];

  const safely = (name: string, job: () => void): void => {
    try {
      job();
    } catch (error) {
      log.warn({ job: name, err: errorMessage(error) }, 'job failed');
    }
  };

  const expiry = (): void =>
    safely('knowledge-expiry', () => {
      ctx.knowledge.expireDue();
    });

  const cachePrune = (): void =>
    safely('cache-prune', () => {
      const removed = ctx.store.telemetry.pruneCache(CACHE_MAX_AGE_MS);
      ctx.limiter.prune();
      if (removed > 0) log.debug({ removed }, 'pruned response cache');
    });

  const presence = (client?: Client<true>): void => {
    if (!client) return;
    safely('presence', () => refreshPresence(client, ctx));
  };

  return {
    start(client) {
      timers.push(setInterval(expiry, TIMINGS.expirySweepMs));
      timers.push(setInterval(cachePrune, TIMINGS.cachePruneMs));
      timers.push(setInterval(() => presence(client), TIMINGS.presenceRefreshMs));
      for (const timer of timers) timer.unref?.();
      log.info('background jobs started');
    },

    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },

    runOnce(client) {
      expiry();
      cachePrune();
      presence(client);
    },
  };
}
