import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retrieveKnowledge } from '../src/knowledge/retrieval.js';
import { createHarness, seedGuild, type Harness } from './helpers/harness.js';

const A = 'guild-alpha';
const B = 'guild-beta';

let h: Harness;

beforeEach(async () => {
  h = createHarness();
  seedGuild(h.store, A, 'Alpha');
  seedGuild(h.store, B, 'Beta');
});

afterEach(() => h.close());

describe('guild isolation (§34, §35)', () => {
  it('never surfaces one server’s knowledge in another', async () => {
    await h.ctx.knowledge.learn({
      guildId: A,
      actorId: 'admin-a',
      content: 'Refunds are available within 14 days of purchase for Alpha customers.',
      offline: true,
    });

    expect(h.ctx.knowledge.search(A, 'refunds')).toHaveLength(1);
    expect(h.ctx.knowledge.search(B, 'refunds')).toHaveLength(0);
    expect(retrieveKnowledge(h.store, B, 'refund policy').used).toHaveLength(0);
    expect(h.ctx.knowledge.count(B, { status: 'any' })).toBe(0);
  });

  it('refuses cross-guild reads and writes by id', async () => {
    const { entry } = await h.ctx.knowledge.learn({
      guildId: A,
      actorId: 'admin-a',
      content: 'Alpha support hours are 09:00–17:00 UTC on weekdays.',
      offline: true,
    });

    // Guessing the numeric id from another guild must not work in either direction.
    expect(h.ctx.knowledge.get(B, entry.id)).toBeUndefined();
    expect(h.ctx.knowledge.remove(B, entry.id, 'attacker')).toBe(false);
    expect(h.ctx.knowledge.setEnabled(B, entry.id, false, 'attacker')).toBe(false);
    expect(h.ctx.knowledge.get(A, entry.id)?.status).toBe('active');
  });

  it('scopes tickets, transcripts and facts to their own guild', () => {
    const ticketA = h.ctx.tickets.ensure({ guildId: A, channelId: 'chan-1', openerUserId: 'user-1' });
    const ticketB = h.ctx.tickets.ensure({ guildId: B, channelId: 'chan-1', openerUserId: 'user-1' });

    expect(ticketA.id).not.toBe(ticketB.id);

    h.ctx.tickets.recordUserMessage(ticketA, 'user-1', 'my Alpha invoice is wrong');
    h.ctx.tickets.addFact(A, ticketA.id, 'Order', 'A-1001');

    // Same channel id, different guild: nothing bleeds through.
    expect(h.ctx.tickets.get(B, ticketA.id)).toBeUndefined();
    expect(h.ctx.tickets.messageCount(B, ticketA.id)).toBe(0);
    expect(h.store.conversation.listFacts(B, ticketA.id)).toHaveLength(0);
    expect(h.ctx.tickets.context(B, ticketA.id, 10)).toBeUndefined();
    expect(h.ctx.tickets.context(A, ticketA.id, 10)?.messages).toHaveLength(1);
  });

  it('scopes admins, settings, audit trail and telemetry per guild', () => {
    h.store.admins.add(A, 'user-9', 'owner-a');
    expect(h.store.admins.isAdmin(A, 'user-9')).toBe(true);
    expect(h.store.admins.isAdmin(B, 'user-9')).toBe(false);
    expect(h.store.admins.listIds(B)).toEqual([]);

    h.store.guilds.update(A, { supportMode: 'all', personaNote: 'Alpha voice' });
    expect(h.store.guilds.getSettings(B)?.supportMode).toBe('invoked');
    expect(h.store.guilds.getSettings(B)?.personaNote).toBeNull();

    h.store.audit.record(A, 'owner-a', 'settings.update', 'supportMode');
    expect(h.store.audit.count(A)).toBeGreaterThan(0);
    expect(h.store.audit.count(B)).toBe(0);

    const hash = h.store.telemetry.hashPrompt(['chan-1', 'how do i reset my password']);
    h.store.telemetry.putCached(A, hash, 'Alpha-specific answer');
    expect(h.store.telemetry.getCached(A, hash, 60_000)).toBe('Alpha-specific answer');
    expect(h.store.telemetry.getCached(B, hash, 60_000)).toBeUndefined();
  });

  it('keeps the response cache from leaking answers across guilds even for identical questions', () => {
    const hash = h.store.telemetry.hashPrompt(['same-channel-name', 'what is the price']);
    h.store.telemetry.putCached(A, hash, '$10 per month');
    h.store.telemetry.putCached(B, hash, '€25 per month');

    expect(h.store.telemetry.getCached(A, hash, 60_000)).toBe('$10 per month');
    expect(h.store.telemetry.getCached(B, hash, 60_000)).toBe('€25 per month');
  });

  it('counts escalations only within the guild that raised them', () => {
    const ticket = h.ctx.tickets.ensure({ guildId: A, channelId: 'chan-esc', openerUserId: 'user-1' });
    h.ctx.tickets.escalate({
      guildId: A,
      ticketId: ticket.id,
      trigger: 'ai_low_confidence',
      reason: 'not confident',
      notifiedUserIds: [],
      actorId: 'bot',
    });

    expect(h.store.escalations.countOpen(A)).toBe(1);
    expect(h.store.escalations.countOpen(B)).toBe(0);
    expect(h.store.escalations.latestOpenForTicket(B, ticket.id)).toBeUndefined();
  });
});
