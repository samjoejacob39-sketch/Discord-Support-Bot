import { TIMINGS } from '../config/constants.js';
import { child } from '../logging/logger.js';
import { errorMessage } from '../util/async.js';
import { refreshPresence } from '../discord/presence.js';
const log = child('jobs');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/**
 * Background maintenance. Everything here is cheap, local and idempotent: expiring temporary
 * knowledge (§19), trimming the duplicate-answer cache and rate-limit buckets (§55), and
 * refreshing presence (§57).
 */
export function createScheduler(ctx) {
    const timers = [];
    const safely = (name, job) => {
        try {
            job();
        }
        catch (error) {
            log.warn({ job: name, err: errorMessage(error) }, 'job failed');
        }
    };
    const expiry = () => safely('knowledge-expiry', () => {
        ctx.knowledge.expireDue();
    });
    const cachePrune = () => safely('cache-prune', () => {
        const removed = ctx.store.telemetry.pruneCache(CACHE_MAX_AGE_MS);
        ctx.limiter.prune();
        if (removed > 0)
            log.debug({ removed }, 'pruned response cache');
    });
    const presence = (client) => {
        if (!client)
            return;
        safely('presence', () => refreshPresence(client, ctx));
    };
    return {
        start(client) {
            timers.push(setInterval(expiry, TIMINGS.expirySweepMs));
            timers.push(setInterval(cachePrune, TIMINGS.cachePruneMs));
            timers.push(setInterval(() => presence(client), TIMINGS.presenceRefreshMs));
            for (const timer of timers)
                timer.unref?.();
            log.info('background jobs started');
        },
        stop() {
            for (const timer of timers)
                clearInterval(timer);
            timers.length = 0;
        },
        runOnce(client) {
            expiry();
            cachePrune();
            presence(client);
        },
    };
}
//# sourceMappingURL=scheduler.js.map