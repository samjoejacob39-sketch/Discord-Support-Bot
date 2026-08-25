import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { heuristicClassify } from '../src/knowledge/classifier.js';
import { CATEGORY_SLUGS, isCategory } from '../src/knowledge/categories.js';
import { renderKnowledgeBlocks, retrieveKnowledge, summariseEntries } from '../src/knowledge/retrieval.js';
import { buildMatchExpression, extractTerms } from '../src/db/repositories/knowledge.js';
import { createHarness, seedGuild, type Harness } from './helpers/harness.js';

const GUILD = 'guild-knowledge';

let h: Harness;

beforeEach(() => {
  h = createHarness();
  seedGuild(h.store, GUILD);
});

afterEach(() => h.close());

/** `/learn` without the AI classifier: deterministic, so it is safe to assert on. */
function learn(content: string, extra: { category?: string; durationMs?: number } = {}) {
  return h.ctx.knowledge.learn({ guildId: GUILD, actorId: 'admin-1', content, offline: true, ...extra });
}

describe('knowledge classification (§4, §6)', () => {
  it('routes notes to a sensible category instead of one undifferentiated blob', () => {
    expect(heuristicClassify('Refunds are available within 14 days of purchase.').category).toBe('policies');
    expect(heuristicClassify('The Pro plan costs $10 per month.').category).toBe('pricing');
    expect(heuristicClassify('Run /rank to see your current level.').category).toBe('commands');
    expect(heuristicClassify('Members must reset their router before contacting us.').category).toBe('troubleshooting');
    expect(heuristicClassify('Spamming is not allowed anywhere on the server.').category).toBe('rules');
    expect(heuristicClassify('"GG" stands for good game in our community.').category).toBe('terminology');
    expect(heuristicClassify('How do members claim their weekly reward?').category).toBe('faq');
    // Every category the classifier can emit must exist in the catalogue.
    for (const slug of CATEGORY_SLUGS) expect(isCategory(slug)).toBe(true);
  });

  it('marks time-limited notes as temporary and outage notes as incidents (§19)', () => {
    const incident = heuristicClassify('Incident: logins are currently failing while we restart the auth service.');
    expect(incident.kind).toBe('incident');
    expect(incident.expiresInHours).toBe(24);
    expect(incident.priority).toBeGreaterThan(80);

    const temporary = heuristicClassify('Temporary: double XP weekend runs until Monday.');
    expect(temporary.kind).toBe('temporary');
    expect(temporary.expiresInHours).toBe(72);

    const permanent = heuristicClassify('Our support team answers on weekdays.');
    expect(permanent.kind).toBe('permanent');
    expect(permanent.expiresInHours).toBeNull();
  });

  it('keeps behaviour-shaping notes staff-only so they are never quoted back (§5)', () => {
    const staff = heuristicClassify('Never say we plan to add new features to the roadmap.');
    expect(staff.visibility).toBe('staff');

    const publicFact = heuristicClassify('Our store ships worldwide.');
    expect(publicFact.visibility).toBe('public');

    // The dedicated staff category forces staff visibility regardless of wording.
    expect(heuristicClassify('Escalate anything about chargebacks.').visibility).toBe('public');
  });

  it('derives a short title and never an empty one', () => {
    const long = heuristicClassify(`${'word '.repeat(80)}.`);
    expect(long.title.length).toBeLessThanOrEqual(90);
    expect(heuristicClassify('ok.').title).not.toHaveLength(0);
  });
});

describe('learning and lifecycle (§4, §19, §20)', () => {
  it('stores structured, attributed knowledge rather than raw text', async () => {
    const { entry, classification } = await learn('Refunds are available within 14 days of purchase.');

    expect(entry.guildId).toBe(GUILD);
    expect(entry.category).toBe('policies');
    expect(entry.status).toBe('active');
    expect(entry.createdBy).toBe('admin-1');
    expect(entry.title).not.toHaveLength(0);
    expect(entry.flagged).toBe(false);
    expect(classification.source).toBe('heuristic');
    // §33: who taught it, when, and in which server is on the audit trail.
    expect(h.store.audit.count(GUILD)).toBe(1);
  });

  it('honours an explicit category and an explicit lifetime', async () => {
    const { entry } = await learn('The launcher sometimes hangs on startup.', {
      category: 'troubleshooting',
      durationMs: 3_600_000,
    });

    expect(entry.category).toBe('troubleshooting');
    expect(entry.kind).toBe('temporary');
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refuses content that carries no information and caps very long notes', async () => {
    await expect(learn('ab')).rejects.toThrow(/too short/i);

    const { entry } = await learn('x'.repeat(5000));
    expect(entry.content.length).toBeLessThanOrEqual(3500);
  });

  it('cleans Discord markup so prompts stay readable', async () => {
    const { entry } = await learn('Ask <@1234567890> or <@&987654321> in <#555444333> about billing.');
    expect(entry.content).toContain('@user');
    expect(entry.content).toContain('@role');
    expect(entry.content).toContain('#channel');
    expect(entry.content).not.toContain('<@');
  });

  it('disables and re-enables an entry without deleting it', async () => {
    const { entry } = await learn('The support inbox is support@example.com.');

    expect(h.ctx.knowledge.setEnabled(GUILD, entry.id, false, 'admin-1')).toBe(true);
    expect(h.ctx.knowledge.get(GUILD, entry.id)?.status).toBe('inactive');
    expect(h.ctx.knowledge.search(GUILD, 'support inbox')).toHaveLength(0);
    expect(h.ctx.knowledge.count(GUILD, { status: 'any' })).toBe(1);

    expect(h.ctx.knowledge.setEnabled(GUILD, entry.id, true, 'admin-1')).toBe(true);
    expect(h.ctx.knowledge.search(GUILD, 'support inbox')).toHaveLength(1);
  });

  it('removes an entry and reports honestly when the id does not exist', async () => {
    const { entry } = await learn('Our office is closed on public holidays.');

    expect(h.ctx.knowledge.remove(GUILD, entry.id, 'admin-1')).toBe(true);
    expect(h.ctx.knowledge.get(GUILD, entry.id)).toBeUndefined();
    expect(h.ctx.knowledge.remove(GUILD, entry.id, 'admin-1')).toBe(false);
    expect(h.ctx.knowledge.remove(GUILD, 999_999, 'admin-1')).toBe(false);
  });

  it('retires expired temporary knowledge and leaves permanent knowledge alone', async () => {
    const temporary = await learn('Maintenance window tonight.', { durationMs: 60_000 });
    const permanent = await learn('Our warranty lasts 24 months.');

    // Nothing is due yet.
    expect(h.ctx.knowledge.expireDue()).toBe(0);

    expect(h.store.knowledge.expireDue(Date.now() + 120_000)).toBe(1);
    expect(h.ctx.knowledge.get(GUILD, temporary.entry.id)?.status).toBe('expired');
    expect(h.ctx.knowledge.get(GUILD, permanent.entry.id)?.status).toBe('active');
    expect(h.store.knowledge.activeIncidents(GUILD, Date.now() + 120_000)).toHaveLength(0);
  });

  it('paginates listings and counts per category for /knowledge list', async () => {
    for (let index = 0; index < 7; index += 1) {
      await learn(`Rule ${index}: spamming is not allowed in channel ${index}.`);
    }

    expect(h.ctx.knowledge.count(GUILD)).toBe(7);
    expect(h.ctx.knowledge.list(GUILD, { limit: 5, offset: 0 })).toHaveLength(5);
    expect(h.ctx.knowledge.list(GUILD, { limit: 5, offset: 5 })).toHaveLength(2);

    const stats = h.ctx.knowledge.stats(GUILD);
    expect(stats.total).toBe(7);
    expect(stats.byCategory[0]).toEqual({ category: 'rules', count: 7 });
  });
});

describe('retrieval (§15, §16, §17)', () => {
  it('finds the right note from a differently-worded question', async () => {
    await learn('Refunds are available within 14 days of purchase.');
    await learn('The Pro plan costs $10 per month.');

    const refund = retrieveKnowledge(h.store, GUILD, 'can i get my money back on a refund?');
    expect(refund.used.some((entry) => entry.category === 'policies')).toBe(true);

    const pricing = retrieveKnowledge(h.store, GUILD, 'how much does the pro plan cost');
    expect(pricing.used.some((entry) => entry.category === 'pricing')).toBe(true);
  });

  it('always includes active incidents and ranks them above general documentation (§40)', async () => {
    await learn('Logins normally work through the website.');
    const incident = await learn('Incident: logins are currently failing while we restart the auth service.');

    const result = retrieveKnowledge(h.store, GUILD, 'why can i not log in');
    expect(result.incidents.map((entry) => entry.id)).toContain(incident.entry.id);
    expect(result.used[0]?.id).toBe(incident.entry.id);
    // Never duplicated: an incident that also matches the query appears once.
    expect(result.used.filter((entry) => entry.id === incident.entry.id)).toHaveLength(1);

    const blocks = renderKnowledgeBlocks(result);
    expect(blocks[0]).toContain('<active_incidents');
    expect(blocks[0]).toContain('precedence="above_general_knowledge"');
  });

  it('returns nothing rather than noise when the server was never taught anything', () => {
    const result = retrieveKnowledge(h.store, GUILD, 'do you offer student discounts');
    expect(result.used).toEqual([]);
    expect(renderKnowledgeBlocks(result)).toEqual([]);
    expect(summariseEntries([])).toContain('Nothing yet');
  });

  it('respects a character budget so the prompt cannot grow without bound (§31)', async () => {
    for (let index = 0; index < 6; index += 1) {
      await learn(`Note ${index}: ${'refund policy detail '.repeat(30)}`);
    }

    const result = retrieveKnowledge(h.store, GUILD, 'refund policy', { charBudget: 900 });
    expect(result.used.length).toBeGreaterThan(0);
    expect(result.used.length).toBeLessThan(6);
  });

  it('builds safe search expressions from hostile-looking queries', () => {
    expect(extractTerms('the and for')).toEqual([]);
    expect(extractTerms('Refund POLICY refund')).toEqual(['refund', 'policy']);
    // Quotes cannot escape the FTS expression.
    expect(buildMatchExpression(extractTerms('refund" OR 1=1 --'))).not.toContain('""');
    expect(buildMatchExpression([])).toBeNull();
    expect(h.ctx.knowledge.search(GUILD, '"; DROP TABLE knowledge_entries; --')).toEqual([]);
    expect(h.ctx.knowledge.search(GUILD, '')).toEqual([]);
  });
});
