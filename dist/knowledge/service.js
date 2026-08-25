import { AUDIT_ACTIONS } from '../db/repositories/audit.js';
import { scanForInjection } from '../security/injection.js';
import { child } from '../logging/logger.js';
import { stripDiscordMarkup } from '../util/text.js';
import { getCategory, isCategory } from './categories.js';
import { classifyKnowledge, heuristicClassify } from './classifier.js';
const log = child('knowledge');
export const MAX_KNOWLEDGE_LENGTH = 3500;
export class KnowledgeService {
    store;
    provider;
    constructor(store, provider) {
        this.store = store;
        this.provider = provider;
    }
    /** Teach the bot one piece of server knowledge. */
    async learn(input) {
        const content = stripDiscordMarkup(input.content).slice(0, MAX_KNOWLEDGE_LENGTH).trim();
        if (content.length < 3)
            throw new Error('Knowledge content is too short to be useful.');
        const injection = scanForInjection(content);
        const classification = input.offline
            ? heuristicClassify(content)
            : await classifyKnowledge(this.provider, content);
        if (input.category && isCategory(input.category)) {
            classification.category = input.category;
            const defaults = getCategory(input.category).defaultVisibility;
            if (defaults)
                classification.visibility = defaults;
        }
        let kind = classification.kind;
        let expiresAt = null;
        if (input.durationMs && input.durationMs > 0) {
            kind = kind === 'incident' ? 'incident' : 'temporary';
            expiresAt = Date.now() + input.durationMs;
        }
        else if (classification.expiresInHours && kind !== 'permanent') {
            expiresAt = Date.now() + classification.expiresInHours * 3_600_000;
        }
        const entry = this.store.knowledge.create({
            guildId: input.guildId,
            category: classification.category,
            kind,
            visibility: classification.visibility,
            title: classification.title,
            content,
            priority: classification.priority,
            flagged: injection.suspicious,
            expiresAt,
            createdBy: input.actorId,
        });
        this.store.audit.record(input.guildId, input.actorId, AUDIT_ACTIONS.knowledgeAdd, `knowledge:${entry.id}`, {
            category: entry.category,
            kind: entry.kind,
            visibility: entry.visibility,
            flagged: entry.flagged,
            classifier: classification.source,
            length: content.length,
        });
        if (injection.suspicious) {
            log.warn({ guildId: input.guildId, entryId: entry.id, labels: injection.labels }, 'flagged /learn content');
        }
        return { entry, classification, injection };
    }
    list(guildId, options = {}) {
        return this.store.knowledge.list(guildId, options);
    }
    count(guildId, options = {}) {
        return this.store.knowledge.count(guildId, options);
    }
    get(guildId, id) {
        return this.store.knowledge.get(guildId, id);
    }
    search(guildId, query, limit = 8) {
        return this.store.knowledge.search(guildId, query, limit);
    }
    stats(guildId) {
        return {
            total: this.store.knowledge.count(guildId, { status: 'any' }),
            active: this.store.knowledge.count(guildId),
            incidents: this.store.knowledge.count(guildId, { kind: 'incident' }),
            temporary: this.store.knowledge.count(guildId, { kind: 'temporary' }),
            byCategory: this.store.knowledge.countsByCategory(guildId),
        };
    }
    remove(guildId, id, actorId) {
        const entry = this.store.knowledge.get(guildId, id);
        if (!entry)
            return false;
        const removed = this.store.knowledge.delete(guildId, id);
        if (removed) {
            this.store.audit.record(guildId, actorId, AUDIT_ACTIONS.knowledgeRemove, `knowledge:${id}`, {
                category: entry.category,
                title: entry.title,
            });
        }
        return removed;
    }
    setEnabled(guildId, id, enabled, actorId) {
        const changed = this.store.knowledge.setStatus(guildId, id, enabled ? 'active' : 'inactive', actorId);
        if (changed) {
            this.store.audit.record(guildId, actorId, enabled ? AUDIT_ACTIONS.knowledgeEnable : AUDIT_ACTIONS.knowledgeDisable, `knowledge:${id}`);
        }
        return changed;
    }
    /** Sweep expired temporary knowledge. Returns the number of entries retired. */
    expireDue() {
        const changed = this.store.knowledge.expireDue();
        if (changed > 0)
            log.info({ changed }, 'expired temporary knowledge');
        return changed;
    }
}
//# sourceMappingURL=service.js.map