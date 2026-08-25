import { TIMINGS } from '../config/constants.js';
/**
 * Fixed-window counters, in memory. Large communities generate bursts, so the guild
 * window is generous while the per-user window stops one member from monopolising the AI.
 * A single process is the deployment target; swapping in Redis means replacing this class
 * only.
 */
export class RateLimiter {
    perUserPerMinute;
    perGuildPerMinute;
    windowMs;
    buckets = new Map();
    constructor(perUserPerMinute, perGuildPerMinute, windowMs = TIMINGS.rateLimitWindowMs) {
        this.perUserPerMinute = perUserPerMinute;
        this.perGuildPerMinute = perGuildPerMinute;
        this.windowMs = windowMs;
    }
    hit(key, limit, now) {
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
    check(guildId, userId, now = Date.now()) {
        const guild = this.hit(`g:${guildId}`, this.perGuildPerMinute, now);
        if (!guild.allowed)
            return { ...guild, scope: 'guild' };
        const user = this.hit(`u:${guildId}:${userId}`, this.perUserPerMinute, now);
        if (!user.allowed)
            return { ...user, scope: 'user' };
        return { allowed: true, retryAfterMs: 0 };
    }
    /** Generic named limiter, e.g. one `/learn` classification per admin per few seconds. */
    checkCustom(key, limit, windowMs, now = Date.now()) {
        const bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            this.buckets.set(key, { count: 1, resetAt: now + windowMs });
            return { allowed: true, retryAfterMs: 0 };
        }
        if (bucket.count >= limit)
            return { allowed: false, retryAfterMs: bucket.resetAt - now };
        bucket.count += 1;
        return { allowed: true, retryAfterMs: 0 };
    }
    /** Drop expired buckets so the map cannot grow without bound. */
    prune(now = Date.now()) {
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now)
                this.buckets.delete(key);
        }
    }
    reset() {
        this.buckets.clear();
    }
}
//# sourceMappingURL=rateLimiter.js.map