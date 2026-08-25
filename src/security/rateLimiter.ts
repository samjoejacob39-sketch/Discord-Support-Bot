import { TIMINGS } from '../config/constants.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Milliseconds until the caller may retry. */
  retryAfterMs: number;
  scope?: 'user' | 'guild';
}

/**
 * Fixed-window counters, in memory. Large communities generate bursts, so the guild
 * window is generous while the per-user window stops one member from monopolising the AI.
 * A single process is the deployment target; swapping in Redis means replacing this class
 * only.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly perUserPerMinute: number,
    private readonly perGuildPerMinute: number,
    private readonly windowMs: number = TIMINGS.rateLimitWindowMs,
  ) {}

  private hit(key: string, limit: number, now: number): RateDecision {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (bucket.count >= limit) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Consume one AI request for a user in a guild; both windows must allow it. */
  check(guildId: string, userId: string, now = Date.now()): RateDecision {
    const guild = this.hit(`g:${guildId}`, this.perGuildPerMinute, now);
    if (!guild.allowed) return { ...guild, scope: 'guild' };

    const user = this.hit(`u:${guildId}:${userId}`, this.perUserPerMinute, now);
    if (!user.allowed) return { ...user, scope: 'user' };

    return { allowed: true, retryAfterMs: 0 };
  }

  /** Generic named limiter, e.g. one `/learn` classification per admin per few seconds. */
  checkCustom(key: string, limit: number, windowMs: number, now = Date.now()): RateDecision {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (bucket.count >= limit) return { allowed: false, retryAfterMs: bucket.resetAt - now };
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Drop expired buckets so the map cannot grow without bound. */
  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }
}
