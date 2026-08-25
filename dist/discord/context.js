import { createSupportAgent } from '../ai/supportAgent.js';
import { createSummarizer } from '../ai/summarizer.js';
import { KnowledgeService } from '../knowledge/service.js';
import { RateLimiter } from '../security/rateLimiter.js';
import { createEscalationService } from '../tickets/escalation.js';
import { createTicketService } from '../tickets/service.js';
import { createWebService } from '../web/service.js';
export function createBotContext(env, store, provider) {
    const web = createWebService(env);
    const tickets = createTicketService(store);
    return {
        env,
        store,
        provider,
        web,
        knowledge: new KnowledgeService(store, provider),
        tickets,
        escalation: createEscalationService(store, tickets),
        agent: createSupportAgent({ store, provider, web, tickets }),
        summarizer: createSummarizer(store, provider),
        limiter: new RateLimiter(env.AI_MAX_REQUESTS_PER_USER_PER_MIN, env.AI_MAX_REQUESTS_PER_GUILD_PER_MIN),
        startedAt: Date.now(),
    };
}
//# sourceMappingURL=context.js.map