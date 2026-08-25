import type { Db } from '../client.js';
import { createAdminRepository } from './admins.js';
import { createAuditRepository } from './audit.js';
import { createConversationRepository } from './conversation.js';
import { createEscalationRepository } from './escalations.js';
import { createGuildRepository } from './guilds.js';
import { createKnowledgeRepository } from './knowledge.js';
import { createTelemetryRepository } from './telemetry.js';
import { createTicketRepository } from './tickets.js';

/**
 * The single data-access surface. Every method takes an explicit `guildId`, which is how
 * guild isolation is enforced structurally rather than by convention.
 */
export interface Store {
  db: Db;
  guilds: ReturnType<typeof createGuildRepository>;
  admins: ReturnType<typeof createAdminRepository>;
  knowledge: ReturnType<typeof createKnowledgeRepository>;
  tickets: ReturnType<typeof createTicketRepository>;
  conversation: ReturnType<typeof createConversationRepository>;
  escalations: ReturnType<typeof createEscalationRepository>;
  audit: ReturnType<typeof createAuditRepository>;
  telemetry: ReturnType<typeof createTelemetryRepository>;
}

export function createStore(db: Db): Store {
  return {
    db,
    guilds: createGuildRepository(db),
    admins: createAdminRepository(db),
    knowledge: createKnowledgeRepository(db),
    tickets: createTicketRepository(db),
    conversation: createConversationRepository(db),
    escalations: createEscalationRepository(db),
    audit: createAuditRepository(db),
    telemetry: createTelemetryRepository(db),
  };
}

let singleton: Store | undefined;

export function initStore(db: Db): Store {
  singleton = createStore(db);
  return singleton;
}

export function getStore(): Store {
  if (!singleton) throw new Error('Store not initialised — call initStore() during bootstrap.');
  return singleton;
}
