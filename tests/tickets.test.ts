import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/db/repositories/audit.js';
import { buildStaffEmbed } from '../src/tickets/escalation.js';
import type { StaffBrief } from '../src/ai/supportAgent.js';
import {
  InvalidTransitionError,
  TRANSITIONS,
  canAIRespond,
  canTransition,
  isHumanHandling,
  isTerminal,
  STATE_LABELS,
} from '../src/tickets/stateMachine.js';
import { createHarness, seedGuild, type Harness } from './helpers/harness.js';

const GUILD = 'guild-tickets';

let h: Harness;

beforeEach(() => {
  h = createHarness();
  seedGuild(h.store, GUILD);
});

afterEach(() => h.close());

function open(channelId = 'chan-1', openerUserId = 'user-1') {
  return h.ctx.tickets.ensure({ guildId: GUILD, channelId, openerUserId });
}

describe('ticket state machine (§11, §13)', () => {
  it('lets the AI speak only while nobody else owns the conversation', () => {
    expect(canAIRespond('NEW')).toBe(true);
    expect(canAIRespond('AI_ACTIVE')).toBe(true);
    for (const state of ['WAITING_FOR_ADMIN', 'ADMIN_ACTIVE', 'AI_PAUSED', 'RESOLVED', 'CLOSED'] as const) {
      expect(canAIRespond(state), `${state} must silence the AI`).toBe(false);
    }
    expect(isHumanHandling('WAITING_FOR_ADMIN')).toBe(true);
    expect(isHumanHandling('ADMIN_ACTIVE')).toBe(true);
    expect(isHumanHandling('AI_ACTIVE')).toBe(false);
  });

  it('treats CLOSED as terminal and every state as reachable from NEW', () => {
    expect(TRANSITIONS.CLOSED).toEqual([]);
    expect(isTerminal('CLOSED')).toBe(true);
    for (const state of Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[]) {
      if (state !== 'NEW') expect(TRANSITIONS.NEW).toContain(state);
      expect(canTransition(state, state)).toBe(true);
      expect(STATE_LABELS[state]).toBeTruthy();
    }
    expect(canTransition('CLOSED', 'AI_ACTIVE')).toBe(false);
    expect(canTransition('RESOLVED', 'WAITING_FOR_ADMIN')).toBe(false);
  });

  it('rejects an illegal move loudly instead of corrupting state', () => {
    const ticket = open();
    h.ctx.tickets.close(GUILD, ticket.id, 'admin-1');
    const closed = h.ctx.tickets.get(GUILD, ticket.id)!;

    expect(closed.state).toBe('CLOSED');
    expect(() => h.ctx.tickets.transition(closed, 'AI_ACTIVE')).toThrow(InvalidTransitionError);
    expect(h.ctx.tickets.get(GUILD, ticket.id)?.state).toBe('CLOSED');
  });

  it('reuses the live ticket for a channel and opens a fresh one after closing', () => {
    const first = open();
    expect(open().id).toBe(first.id);

    h.ctx.tickets.close(GUILD, first.id, 'admin-1');
    const second = open();
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe('NEW');
  });

  it('counts AI attempts and resets them on success', () => {
    const ticket = open();

    const first = h.ctx.tickets.beginAiTurn(ticket);
    expect(first.ticket.state).toBe('AI_ACTIVE');
    expect(first.attempts).toBe(1);

    const second = h.ctx.tickets.beginAiTurn(first.ticket);
    expect(second.attempts).toBe(2);
    expect(h.ctx.tickets.attemptLimitReached(second.ticket, 2)).toBe(true);

    h.ctx.tickets.markAiSuccess(second.ticket);
    expect(h.ctx.tickets.get(GUILD, ticket.id)?.aiAttempts).toBe(0);
  });

  it('steps aside as soon as a moderator replies (§14)', () => {
    const ticket = open();
    const moved = h.ctx.tickets.recordAdminMessage(ticket, 'admin-1', 'I will take this one.');

    expect(moved.state).toBe('ADMIN_ACTIVE');
    expect(h.ctx.tickets.canAiSpeak(moved)).toBe(false);
    expect(h.ctx.tickets.messageCount(GUILD, ticket.id)).toBe(1);
  });

  it('keeps the AI paused when an admin replies during an explicit pause', () => {
    const ticket = open();
    h.ctx.tickets.setAiPaused(GUILD, ticket.id, 'admin-1', true);
    const paused = h.ctx.tickets.get(GUILD, ticket.id)!;

    const after = h.ctx.tickets.recordAdminMessage(paused, 'admin-1', 'still handling this');
    expect(after.state).toBe('AI_PAUSED');

    h.ctx.tickets.setAiPaused(GUILD, ticket.id, 'admin-1', false);
    expect(h.ctx.tickets.get(GUILD, ticket.id)?.state).toBe('AI_ACTIVE');
  });
});

describe('escalation (§10, §12, §27, §28)', () => {
  it('records the escalation, silences the AI and audits who caused it', () => {
    const ticket = open('chan-esc');
    h.ctx.tickets.recordUserMessage(ticket, 'user-1', 'my payment failed twice');

    const result = h.ctx.tickets.escalate({
      guildId: GUILD,
      ticketId: ticket.id,
      trigger: 'ai_low_confidence',
      reason: 'The AI was not confident enough to answer reliably.',
      summary: 'Payment fails at checkout.',
      recommendedAction: 'Check the payment provider dashboard.',
      notifiedUserIds: ['admin-1', 'admin-2'],
      actorId: 'bot',
    })!;

    expect(result.ticket.state).toBe('WAITING_FOR_ADMIN');
    expect(result.ticket.escalationCount).toBe(1);
    // §12: the AI stays quiet until a human hands it back.
    expect(h.ctx.tickets.canAiSpeak(result.ticket)).toBe(false);
    expect(h.ctx.tickets.awaitingHuman(result.ticket)).toBe(true);

    const open_ = h.store.escalations.latestOpenForTicket(GUILD, ticket.id)!;
    expect(open_.id).toBe(result.escalationId);
    expect(open_.trigger).toBe('ai_low_confidence');
    expect(open_.notifiedUserIds).toEqual(['admin-1', 'admin-2']);
    expect(open_.resolvedAt).toBeNull();

    const audit = h.store.audit.list(GUILD, 10);
    expect(audit.some((row) => row.action === AUDIT_ACTIONS.ticketEscalate)).toBe(true);
  });

  it('preserves the transcript across the handover', () => {
    const ticket = open('chan-esc-2');
    h.ctx.tickets.recordUserMessage(ticket, 'user-1', 'my invoice shows the wrong amount');
    h.ctx.tickets.recordBotMessage(ticket, 'bot-1', 'Let me check that for you.');
    h.ctx.tickets.escalate({
      guildId: GUILD,
      ticketId: ticket.id,
      trigger: 'ai_requested',
      reason: 'needs billing access',
      notifiedUserIds: [],
      actorId: 'bot',
    });

    const context = h.ctx.tickets.context(GUILD, ticket.id, 20)!;
    expect(context.ticket.state).toBe('WAITING_FOR_ADMIN');
    expect(context.messages).toHaveLength(2);
    expect(context.messages.map((message) => message.authorKind)).toEqual(['user', 'bot']);
  });

  it('reports nothing for a ticket that does not exist', () => {
    expect(
      h.ctx.tickets.escalate({
        guildId: GUILD,
        ticketId: 424_242,
        trigger: 'admin_forced',
        reason: 'x',
        notifiedUserIds: [],
        actorId: 'admin-1',
      }),
    ).toBeUndefined();
  });

  it('builds a staff brief that answers the questions §29 asks for', () => {
    const ticket = open('chan-brief');
    const brief: StaffBrief = {
      problem: 'Member cannot redeem a licence key.',
      keyFacts: ['Key ABCD-1234 rejected', 'Bought 3 days ago'],
      attempted: ['Checked the licence FAQ', 'Asked for the exact error text'],
      suspectedCause: 'Key may already be bound to another account.',
      whyEscalated: 'Requires account-level access the bot does not have.',
      recommendedAction: 'Look up the key in the licence admin panel.',
      urgency: 'high',
      knowledgeUsed: ['Licence activation steps'],
      sources: ['example.com'],
    };

    const embed = buildStaffEmbed({
      guildName: 'Test Guild',
      ticket,
      brief,
      trigger: 'ai_low_confidence',
      channelId: 'chan-brief',
    }).toJSON();

    expect(embed.title).toContain(`#${ticket.id}`);
    expect(embed.description).toContain('AI is now silent here');
    expect(embed.description).toContain(`<@${ticket.openerUserId}>`);
    expect(embed.footer?.text).toContain('/shin-continue');

    const fields = new Map((embed.fields ?? []).map((field) => [field.name, field.value]));
    expect(fields.get('Problem')).toBe(brief.problem);
    expect(fields.get('Why escalated')).toBe(brief.whyEscalated);
    expect(fields.get('Key facts')).toContain('Key ABCD-1234 rejected');
    expect(fields.get('Already tried')).toContain('Checked the licence FAQ');
    expect(fields.get('Suspected cause (unverified)')).toContain('another account');
    expect(fields.get('Recommended action')).toContain('licence admin panel');
    expect(fields.get('Server knowledge used')).toContain('Licence activation steps');
    expect(fields.get('Web sources consulted')).toBe('example.com');
  });

  it('omits empty brief sections instead of showing blank fields', () => {
    const ticket = open('chan-brief-2');
    const embed = buildStaffEmbed({
      guildName: 'Test Guild',
      ticket,
      brief: {
        problem: 'Unclear question.',
        keyFacts: [],
        attempted: [],
        suspectedCause: null,
        whyEscalated: 'Member asked for a human.',
        recommendedAction: null,
        urgency: 'normal',
        knowledgeUsed: [],
        sources: [],
      },
      trigger: 'user_requested',
      channelId: 'chan-brief-2',
    }).toJSON();

    const names = (embed.fields ?? []).map((field) => field.name);
    expect(names).toEqual(['Problem', 'Why escalated']);
  });
});

describe('/shin-continue resume semantics (§13)', () => {
  it('hands the ticket back to the AI with its context intact', () => {
    const ticket = open('chan-resume');
    h.ctx.tickets.recordUserMessage(ticket, 'user-1', 'my licence key will not activate');
    h.ctx.tickets.beginAiTurn(ticket);
    h.ctx.tickets.escalate({
      guildId: GUILD,
      ticketId: ticket.id,
      trigger: 'ai_low_confidence',
      reason: 'not confident',
      notifiedUserIds: ['admin-1'],
      actorId: 'bot',
    });
    h.ctx.tickets.recordAdminMessage(h.ctx.tickets.get(GUILD, ticket.id)!, 'admin-1', 'Reissued the key manually.');

    const resumed = h.ctx.tickets.resume(GUILD, ticket.id, 'admin-1', 'Key reissued — explain activation steps.')!;

    expect(resumed.state).toBe('AI_ACTIVE');
    expect(h.ctx.tickets.canAiSpeak(resumed)).toBe(true);
    // The escalation is closed out and the failure streak forgotten.
    expect(h.store.escalations.latestOpenForTicket(GUILD, ticket.id)).toBeUndefined();
    expect(h.store.escalations.countOpen(GUILD)).toBe(0);
    expect(resumed.aiAttempts).toBe(0);

    const context = h.ctx.tickets.context(GUILD, ticket.id, 20)!;
    expect(context.messages).toHaveLength(2);
    expect(context.facts.some((fact) => fact.label === 'Staff handover note')).toBe(true);

    const audit = h.store.audit.list(GUILD, 10);
    expect(audit.some((row) => row.action === AUDIT_ACTIONS.ticketResume && row.actorId === 'admin-1')).toBe(true);
  });

  it('works without a note and refuses unknown or closed tickets', () => {
    const ticket = open('chan-resume-2');
    h.ctx.tickets.escalate({
      guildId: GUILD,
      ticketId: ticket.id,
      trigger: 'user_requested',
      reason: 'member asked',
      notifiedUserIds: [],
      actorId: 'bot',
    });

    const resumed = h.ctx.tickets.resume(GUILD, ticket.id, 'admin-1')!;
    expect(resumed.state).toBe('AI_ACTIVE');
    expect(h.store.conversation.listFacts(GUILD, ticket.id)).toHaveLength(0);

    expect(h.ctx.tickets.resume(GUILD, 999_999, 'admin-1')).toBeUndefined();

    h.ctx.tickets.close(GUILD, ticket.id, 'admin-1');
    expect(() => h.ctx.tickets.resume(GUILD, ticket.id, 'admin-1')).toThrow(InvalidTransitionError);
  });

  it('resolving a ticket closes its escalation but keeps the history', () => {
    const ticket = open('chan-resolve');
    h.ctx.tickets.recordUserMessage(ticket, 'user-1', 'sorted now, thanks');
    h.ctx.tickets.escalate({
      guildId: GUILD,
      ticketId: ticket.id,
      trigger: 'admin_forced',
      reason: 'staff took over',
      notifiedUserIds: [],
      actorId: 'admin-1',
    });

    const resolved = h.ctx.tickets.resolve(GUILD, ticket.id, 'admin-1')!;
    expect(resolved.state).toBe('RESOLVED');
    expect(h.store.escalations.countOpen(GUILD)).toBe(0);
    expect(h.ctx.tickets.messageCount(GUILD, ticket.id)).toBe(1);
  });
});
