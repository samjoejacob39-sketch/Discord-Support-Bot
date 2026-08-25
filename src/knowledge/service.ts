import type { AIProvider } from '../ai/provider.js';
import { AUDIT_ACTIONS } from '../db/repositories/audit.js';
import type { Store } from '../db/repositories/index.js';
import type { KnowledgeEntry, KnowledgeKind, KnowledgeStatus } from '../db/types.js';
import { scanForInjection, type InjectionScan } from '../security/injection.js';
import { child } from '../logging/logger.js';
import { stripDiscordMarkup } from '../util/text.js';
import { getCategory, isCategory } from './categories.js';
import { classifyKnowledge, heuristicClassify, type Classification } from './classifier.js';

const log = child('knowledge');

export const MAX_KNOWLEDGE_LENGTH = 3500;

export interface LearnInput {
  guildId: string;
  actorId: string;
  content: string;
  /** Admin-specified category wins over inference. */
  category?: string;
  /** Explicit lifetime; makes the entry temporary/incident. */
  durationMs?: number;
  /** Skip the AI classifier (used by tests and when the provider is degraded). */
  offline?: boolean;
}

export interface LearnResult {
  entry: KnowledgeEntry;
  classification: Classification;
  injection: InjectionScan;
}

export class KnowledgeService {
  constructor(
    private readonly store: Store,
    private readonly provider: AIProvider,
  ) {}

  /** Teach the bot one piece of server knowledge. */
  async learn(input: LearnInput): Promise<LearnResult> {
    const content = stripDiscordMarkup(input.content).slice(0, MAX_KNOWLEDGE_LENGTH).trim();
    if (content.length < 3) throw new Error('Knowledge content is too short to be useful.');

    const injection = scanForInjection(content);
    const classification = input.offline
      ? heuristicClassify(content)
      : await classifyKnowledge(this.provider, content);

    if (input.category && isCategory(input.category)) {
      classification.category = input.category;
      const defaults = getCategory(input.category).defaultVisibility;
      if (defaults) classification.visibility = defaults;
    }

    let kind: KnowledgeKind = classification.kind;
    let expiresAt: number | null = null;
    if (input.durationMs && input.durationMs > 0) {
      kind = kind === 'incident' ? 'incident' : 'temporary';
      expiresAt = Date.now() + input.durationMs;
    } else if (classification.expiresInHours && kind !== 'permanent') {
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

  list(guildId: string, options: { category?: string; kind?: KnowledgeKind; status?: KnowledgeStatus | 'any'; limit?: number; offset?: number } = {}) {
    return this.store.knowledge.list(guildId, options);
  }

  count(guildId: string, options: { category?: string; kind?: KnowledgeKind; status?: KnowledgeStatus | 'any' } = {}) {
    return this.store.knowledge.count(guildId, options);
  }

  get(guildId: string, id: number) {
    return this.store.knowledge.get(guildId, id);
  }

  search(guildId: string, query: string, limit = 8) {
    return this.store.knowledge.search(guildId, query, limit);
  }

  stats(guildId: string) {
    return {
      total: this.store.knowledge.count(guildId, { status: 'any' }),
      active: this.store.knowledge.count(guildId),
      incidents: this.store.knowledge.count(guildId, { kind: 'incident' }),
      temporary: this.store.knowledge.count(guildId, { kind: 'temporary' }),
      byCategory: this.store.knowledge.countsByCategory(guildId),
    };
  }

  remove(guildId: string, id: number, actorId: string): boolean {
    const entry = this.store.knowledge.get(guildId, id);
    if (!entry) return false;
    const removed = this.store.knowledge.delete(guildId, id);
    if (removed) {
      this.store.audit.record(guildId, actorId, AUDIT_ACTIONS.knowledgeRemove, `knowledge:${id}`, {
        category: entry.category,
        title: entry.title,
      });
    }
    return removed;
  }

  setEnabled(guildId: string, id: number, enabled: boolean, actorId: string): boolean {
    const changed = this.store.knowledge.setStatus(guildId, id, enabled ? 'active' : 'inactive', actorId);
    if (changed) {
      this.store.audit.record(
        guildId,
        actorId,
        enabled ? AUDIT_ACTIONS.knowledgeEnable : AUDIT_ACTIONS.knowledgeDisable,
        `knowledge:${id}`,
      );
    }
    return changed;
  }

  /** Sweep expired temporary knowledge. Returns the number of entries retired. */
  expireDue(): number {
    const changed = this.store.knowledge.expireDue();
    if (changed > 0) log.info({ changed }, 'expired temporary knowledge');
    return changed;
  }
}
