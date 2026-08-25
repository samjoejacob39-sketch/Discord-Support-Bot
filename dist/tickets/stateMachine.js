/**
 * Ticket lifecycle. One place decides what may follow what, so an escalated ticket cannot
 * silently drift back to AI control and a closed ticket cannot resurrect itself.
 */
export const TRANSITIONS = {
    NEW: ['AI_ACTIVE', 'WAITING_FOR_ADMIN', 'ADMIN_ACTIVE', 'AI_PAUSED', 'RESOLVED', 'CLOSED'],
    AI_ACTIVE: ['WAITING_FOR_ADMIN', 'ADMIN_ACTIVE', 'AI_PAUSED', 'RESOLVED', 'CLOSED'],
    WAITING_FOR_ADMIN: ['ADMIN_ACTIVE', 'AI_ACTIVE', 'RESOLVED', 'CLOSED'],
    ADMIN_ACTIVE: ['AI_ACTIVE', 'WAITING_FOR_ADMIN', 'RESOLVED', 'CLOSED'],
    AI_PAUSED: ['AI_ACTIVE', 'ADMIN_ACTIVE', 'WAITING_FOR_ADMIN', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['AI_ACTIVE', 'ADMIN_ACTIVE', 'CLOSED'],
    CLOSED: [],
};
export class InvalidTransitionError extends Error {
    from;
    to;
    constructor(from, to) {
        super(`Cannot move a ticket from ${from} to ${to}.`);
        this.from = from;
        this.to = to;
        this.name = 'InvalidTransitionError';
    }
}
export function canTransition(from, to) {
    if (from === to)
        return true;
    return (TRANSITIONS[from] ?? []).includes(to);
}
export function assertTransition(from, to) {
    if (!canTransition(from, to))
        throw new InvalidTransitionError(from, to);
}
/** The AI may only speak in these states. Everything else means "stay quiet". */
export function canAIRespond(state) {
    return state === 'NEW' || state === 'AI_ACTIVE';
}
/** True while a human is expected to be driving the conversation. */
export function isHumanHandling(state) {
    return state === 'WAITING_FOR_ADMIN' || state === 'ADMIN_ACTIVE';
}
export function isTerminal(state) {
    return state === 'CLOSED';
}
export const STATE_LABELS = {
    NEW: '🆕 New',
    AI_ACTIVE: '🤖 AI handling',
    WAITING_FOR_ADMIN: '🔔 Waiting for a moderator',
    ADMIN_ACTIVE: '🧑‍💼 Moderator handling',
    AI_PAUSED: '⏸️ AI paused',
    RESOLVED: '✅ Resolved',
    CLOSED: '🔒 Closed',
};
export const STATE_DESCRIPTIONS = {
    NEW: 'Nobody has replied yet.',
    AI_ACTIVE: 'Shinchat Helper is answering in this conversation.',
    WAITING_FOR_ADMIN: 'Escalated. The AI is silent until `/shin-continue`.',
    ADMIN_ACTIVE: 'A moderator is replying. The AI will not interrupt.',
    AI_PAUSED: 'AI support was paused here by an admin.',
    RESOLVED: 'Marked solved. The AI answers again if someone follows up.',
    CLOSED: 'Archived. The bot ignores this channel.',
};
//# sourceMappingURL=stateMachine.js.map