import { createAdminRepository } from './admins.js';
import { createAuditRepository } from './audit.js';
import { createConversationRepository } from './conversation.js';
import { createEscalationRepository } from './escalations.js';
import { createGuildRepository } from './guilds.js';
import { createKnowledgeRepository } from './knowledge.js';
import { createTelemetryRepository } from './telemetry.js';
import { createTicketRepository } from './tickets.js';
export function createStore(db) {
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
let singleton;
export function initStore(db) {
    singleton = createStore(db);
    return singleton;
}
export function getStore() {
    if (!singleton)
        throw new Error('Store not initialised — call initStore() during bootstrap.');
    return singleton;
}
//# sourceMappingURL=index.js.map