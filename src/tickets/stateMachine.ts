import type { TicketState } from '../db/types.js';

/**
 * Ticket lifecycle. One place decides what may follow what, so an escalated ticket cannot
 * silently drift back to AI control and a closed ticket cannot resurrect itself.
 */
export const TRANSITIONS: Record<TicketState, TicketState[]> = {
  NEW: ['AI_ACTIVE', 'WAITING_FOR_ADMIN', 'ADMIN_ACTIVE', 'AI_PAUSED', 'RESOLVED', 'CLOSED'],
  AI_ACTIVE: ['WAITING_FOR_ADMIN', 'ADMIN_ACTIVE', 'AI_PAUSED', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_ADMIN: ['ADMIN_ACTIVE', 'AI_ACTIVE', 'RESOLVED', 'CLOSED'],
  ADMIN_ACTIVE: ['AI_ACTIVE', 'WAITING_FOR_ADMIN', 'RESOLVED', 'CLOSED'],
  AI_PAUSED: ['AI_ACTIVE', 'ADMIN_ACTIVE', 'WAITING_FOR_ADMIN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['AI_ACTIVE', 'ADMIN_ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TicketState,
    readonly to: TicketState,
  ) {
    super(`Cannot move a ticket from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: TicketState, to: TicketState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: TicketState, to: TicketState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** The AI may only speak in these states. Everything else means "stay quiet". */
export function canAIRespond(state: TicketState): boolean {
  return state === 'NEW' || state === 'AI_ACTIVE';
}

/** True while a human is expected to be driving the conversation. */
export function isHumanHandling(state: TicketState): boolean {
  return state === 'WAITING_FOR_ADMIN' || state === 'ADMIN_ACTIVE';
}

export function isTerminal(state: TicketState): boolean {
  return state === 'CLOSED';
}

export const STATE_LABELS: Record<TicketState, string> = {
  NEW: '🆕 New',
  AI_ACTIVE: '🤖 AI handling',
  WAITING_FOR_ADMIN: '🔔 Waiting for a moderator',
  ADMIN_ACTIVE: '🧑‍💼 Moderator handling',
  AI_PAUSED: '⏸️ AI paused',
  RESOLVED: '✅ Resolved',
  CLOSED: '🔒 Closed',
};

export const STATE_DESCRIPTIONS: Record<TicketState, string> = {
  NEW: 'Nobody has replied yet.',
  AI_ACTIVE: 'Shinchat Helper is answering in this conversation.',
  WAITING_FOR_ADMIN: 'Escalated. The AI is silent until `/shin-continue`.',
  ADMIN_ACTIVE: 'A moderator is replying. The AI will not interrupt.',
  AI_PAUSED: 'AI support was paused here by an admin.',
  RESOLVED: 'Marked solved. The AI answers again if someone follows up.',
  CLOSED: 'Archived. The bot ignores this channel.',
};
