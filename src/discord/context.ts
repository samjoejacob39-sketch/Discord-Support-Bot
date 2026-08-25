import type { Env } from '../config/env.js';
import type { Store } from '../db/repositories/index.js';
import { createSupportAgent, type SupportAgent } from '../ai/supportAgent.js';
import { createSummarizer, type Summarizer } from '../ai/summarizer.js';
import type { AIProvider } from '../ai/provider.js';
import { KnowledgeService } from '../knowledge/service.js';
import { RateLimiter } from '../security/rateLimiter.js';
import { createEscalationService, type EscalationService } from '../tickets/escalation.js';
import { createTicketService, type TicketService } from '../tickets/service.js';
import { createWebService, type WebService } from '../web/service.js';

/**
 * One assembled bot. Everything is constructed once at boot and handed to commands and events,
 * so nothing reaches for globals and tests can build a context with a mock provider.
 */
export interface BotContext {
  env: Env;
  store: Store;
  provider: AIProvider;
  web: WebService;
  knowledge: KnowledgeService;
  tickets: TicketService;
  escalation: EscalationService;
  agent: SupportAgent;
  summarizer: Summarizer;
  limiter: RateLimiter;
  startedAt: number;
}

export function createBotContext(env: Env, store: Store, provider: AIProvider): BotContext {
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
