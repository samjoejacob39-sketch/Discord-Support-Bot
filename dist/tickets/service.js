import { child } from '../logging/logger.js';
import { AUDIT_ACTIONS } from '../db/repositories/audit.js';
import { assertTransition, canAIRespond, isHumanHandling } from './stateMachine.js';
const log = child('tickets');
/**
 * Ticket lifecycle owner. Commands and the AI agent go through here so that every state
 * change passes the state machine and every admin action lands in the audit log.
 */
export class TicketService {
    store;
    constructor(store) {
        this.store = store;
    }
    ensure(input) {
        const ticket = this.store.tickets.ensureOpen({
            guildId: input.guildId,
            channelId: input.channelId,
            parentId: input.parentId ?? null,
            openerUserId: input.openerUserId,
            subject: input.subject ?? null,
        });
        if (input.subject && !ticket.subject) {
            this.store.tickets.setSubject(input.guildId, ticket.id, input.subject);
            return this.store.tickets.getById(input.guildId, ticket.id) ?? ticket;
        }
        return ticket;
    }
    get(guildId, ticketId) {
        return this.store.tickets.getById(guildId, ticketId);
    }
    openInChannel(guildId, channelId) {
        return this.store.tickets.findOpenByChannel(guildId, channelId);
    }
    /** Store a member's message as ticket context. */
    recordUserMessage(ticket, authorId, content, discordMessageId) {
        this.store.tickets.touch(ticket.guildId, ticket.id);
        return this.store.conversation.addMessage({
            ticketId: ticket.id,
            guildId: ticket.guildId,
            discordMessageId: discordMessageId ?? null,
            authorId,
            authorKind: 'user',
            content,
        });
    }
    recordBotMessage(ticket, botUserId, content, discordMessageId) {
        return this.store.conversation.addMessage({
            ticketId: ticket.id,
            guildId: ticket.guildId,
            discordMessageId: discordMessageId ?? null,
            authorId: botUserId,
            authorKind: 'bot',
            content,
        });
    }
    /**
     * A staff member replied in the ticket. Recorded as `admin` context and, unless the AI is
     * deliberately paused, the ticket moves to ADMIN_ACTIVE so the bot stops interrupting.
     */
    recordAdminMessage(ticket, adminId, content, discordMessageId) {
        this.store.conversation.addMessage({
            ticketId: ticket.id,
            guildId: ticket.guildId,
            discordMessageId: discordMessageId ?? null,
            authorId: adminId,
            authorKind: 'admin',
            content,
        });
        this.store.tickets.touch(ticket.guildId, ticket.id);
        if (ticket.state === 'AI_PAUSED' || ticket.state === 'ADMIN_ACTIVE' || ticket.state === 'CLOSED')
            return ticket;
        return this.transition(ticket, 'ADMIN_ACTIVE') ?? ticket;
    }
    context(guildId, ticketId, messageLimit) {
        const ticket = this.store.tickets.getById(guildId, ticketId);
        if (!ticket)
            return undefined;
        const summary = this.store.conversation.latestSummary(guildId, ticketId);
        const messages = summary
            ? this.store.conversation.messagesAfter(guildId, ticketId, summary.throughMessageId, messageLimit)
            : this.store.conversation.recentMessages(guildId, ticketId, messageLimit);
        return {
            ticket,
            summary,
            // A summary with no newer messages would starve the model of the live turn.
            messages: messages.length > 0 ? messages : this.store.conversation.recentMessages(guildId, ticketId, messageLimit),
            facts: this.store.conversation.listFacts(guildId, ticketId),
        };
    }
    /** Validated state change. Throws `InvalidTransitionError` on an illegal move. */
    transition(ticket, to) {
        if (ticket.state === to)
            return ticket;
        assertTransition(ticket.state, to);
        log.debug({ guildId: ticket.guildId, ticketId: ticket.id, from: ticket.state, to }, 'ticket transition');
        return this.store.tickets.setState(ticket.guildId, ticket.id, to);
    }
    /** Called just before the AI answers: NEW → AI_ACTIVE and one attempt is counted. */
    beginAiTurn(ticket) {
        const moved = ticket.state === 'NEW' ? (this.transition(ticket, 'AI_ACTIVE') ?? ticket) : ticket;
        const attempts = this.store.tickets.incrementAttempts(moved.guildId, moved.id);
        return { ticket: this.store.tickets.getById(moved.guildId, moved.id) ?? moved, attempts };
    }
    /** The AI answered confidently — its failure streak resets. */
    markAiSuccess(ticket) {
        this.store.tickets.resetAttempts(ticket.guildId, ticket.id);
    }
    attemptLimitReached(ticket, maxAiAttempts) {
        return ticket.aiAttempts >= Math.max(1, maxAiAttempts);
    }
    canAiSpeak(ticket) {
        return canAIRespond(ticket.state);
    }
    awaitingHuman(ticket) {
        return isHumanHandling(ticket.state);
    }
    /** Record the escalation, silence the AI and leave an audit trail. */
    escalate(input) {
        const ticket = this.store.tickets.getById(input.guildId, input.ticketId);
        if (!ticket)
            return undefined;
        const escalation = this.store.escalations.create({
            ticketId: ticket.id,
            guildId: ticket.guildId,
            trigger: input.trigger,
            reason: input.reason,
            summary: input.summary ?? null,
            recommendedAction: input.recommendedAction ?? null,
            notifiedUserIds: input.notifiedUserIds,
        });
        const moved = this.transition(ticket, 'WAITING_FOR_ADMIN') ?? ticket;
        this.store.tickets.incrementEscalations(ticket.guildId, ticket.id);
        this.store.audit.record(ticket.guildId, input.actorId, AUDIT_ACTIONS.ticketEscalate, String(ticket.id), {
            trigger: input.trigger,
            notified: input.notifiedUserIds.length,
        });
        log.info({ guildId: ticket.guildId, ticketId: ticket.id, trigger: input.trigger }, 'ticket escalated');
        return { ticket: this.store.tickets.getById(ticket.guildId, ticket.id) ?? moved, escalationId: escalation.id };
    }
    /**
     * `/shin-continue`: hand the ticket back to the AI with its context intact. The transcript
     * is never cleared, so the bot resumes knowing everything that happened while it was quiet.
     */
    resume(guildId, ticketId, adminId, note) {
        const ticket = this.store.tickets.getById(guildId, ticketId);
        if (!ticket)
            return undefined;
        const resumed = this.transition(ticket, 'AI_ACTIVE');
        if (!resumed)
            return undefined;
        this.store.escalations.resolveForTicket(guildId, ticketId, adminId);
        this.store.tickets.resetAttempts(guildId, ticketId);
        if (note && note.trim().length > 0) {
            this.store.conversation.addFact(guildId, ticketId, 'Staff handover note', note.trim());
        }
        this.store.audit.record(guildId, adminId, AUDIT_ACTIONS.ticketResume, String(ticketId), { hasNote: Boolean(note) });
        // Re-read so the caller sees the cleared attempt counter, not the pre-reset row.
        return this.store.tickets.getById(guildId, ticketId) ?? resumed;
    }
    resolve(guildId, ticketId, actorId) {
        const ticket = this.store.tickets.getById(guildId, ticketId);
        if (!ticket)
            return undefined;
        const moved = this.transition(ticket, 'RESOLVED');
        this.store.escalations.resolveForTicket(guildId, ticketId, actorId);
        this.store.audit.record(guildId, actorId, AUDIT_ACTIONS.ticketResolve, String(ticketId));
        return moved;
    }
    close(guildId, ticketId, actorId) {
        const ticket = this.store.tickets.getById(guildId, ticketId);
        if (!ticket)
            return undefined;
        const moved = this.transition(ticket, 'CLOSED');
        this.store.escalations.resolveForTicket(guildId, ticketId, actorId);
        this.store.audit.record(guildId, actorId, AUDIT_ACTIONS.ticketClose, String(ticketId));
        return moved;
    }
    /** Pause or unpause the AI for a single ticket (`/ticket ai on|off`). */
    setAiPaused(guildId, ticketId, actorId, paused) {
        const ticket = this.store.tickets.getById(guildId, ticketId);
        if (!ticket)
            return undefined;
        const moved = this.transition(ticket, paused ? 'AI_PAUSED' : 'AI_ACTIVE');
        if (!paused)
            this.store.tickets.resetAttempts(guildId, ticketId);
        this.store.audit.record(guildId, actorId, AUDIT_ACTIONS.ticketAiToggle, String(ticketId), { paused });
        return moved;
    }
    addFact(guildId, ticketId, label, value) {
        this.store.conversation.addFact(guildId, ticketId, label, value);
    }
    saveSummary(guildId, ticketId, summary, throughMessageId) {
        this.store.conversation.addSummary(guildId, ticketId, summary, throughMessageId);
    }
    messageCount(guildId, ticketId) {
        return this.store.conversation.countMessages(guildId, ticketId);
    }
}
export function createTicketService(store) {
    return new TicketService(store);
}
//# sourceMappingURL=service.js.map