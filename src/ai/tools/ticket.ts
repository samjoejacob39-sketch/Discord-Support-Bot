import { argString, type ToolDefinition } from './types.js';

/**
 * Ticket-management tools. Every one is permission-gated: a normal member's conversation never
 * even sees `close_ticket` or `resume_ticket`, so no amount of persuasion can reach them.
 */

export const createTicketSummary: ToolDefinition = {
  spec: {
    name: 'create_ticket_summary',
    description:
      'Save a short factual summary of this conversation so far. Useful in long tickets so context survives without resending every message. Facts only, no advice, no secrets.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Compact factual recap: goal, key facts, what was tried, open questions.' },
      },
      required: ['summary'],
    },
  },
  async run(args, ctx) {
    const summary = argString(args, 'summary');
    if (summary.length < 20) return { error: 'Summary too short to be useful.' };
    const messages = ctx.store.conversation.recentMessages(ctx.guildId, ctx.ticket.id, 1);
    const throughId = messages[messages.length - 1]?.id ?? 0;
    ctx.tickets.saveSummary(ctx.guildId, ctx.ticket.id, summary.slice(0, 2000), throughId);
    return { saved: true, through_message_id: throughId };
  },
};

export const resumeTicket: ToolDefinition = {
  spec: {
    name: 'resume_ticket',
    description:
      'Staff-only: hand a ticket that is waiting for a human back to AI handling, keeping its context. Equivalent to /shin-continue.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Optional handover note recorded as a ticket fact.' },
      },
    },
  },
  available: (ctx) => ctx.askerIsStaff,
  async run(args, ctx) {
    if (!ctx.askerIsStaff) return { error: 'Only Shinchat Helper admins can resume a ticket.' };
    const resumed = ctx.tickets.resume(ctx.guildId, ctx.ticket.id, ctx.userId, argString(args, 'note') || undefined);
    return resumed ? { state: resumed.state } : { error: 'That ticket could not be resumed from its current state.' };
  },
};

export const closeTicket: ToolDefinition = {
  spec: {
    name: 'close_ticket',
    description: 'Staff-only: archive this ticket. The bot then ignores the channel until a new ticket opens.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why it is being closed.' },
      },
    },
  },
  available: (ctx) => ctx.askerIsStaff,
  async run(_args, ctx) {
    if (!ctx.askerIsStaff) return { error: 'Only Shinchat Helper admins can close a ticket.' };
    const closed = ctx.tickets.close(ctx.guildId, ctx.ticket.id, ctx.userId);
    return closed ? { state: closed.state } : { error: 'That ticket could not be closed.' };
  },
};

export const ticketTools: ToolDefinition[] = [createTicketSummary, resumeTicket, closeTicket];
