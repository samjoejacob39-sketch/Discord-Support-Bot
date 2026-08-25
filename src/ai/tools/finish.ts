import { CONFIDENCE_LEVELS } from '../confidence.js';
import type { ToolDefinition } from './types.js';

/**
 * Terminal tools. The agent loop, not the model, performs the real side effects: the model can
 * only *ask* to answer or to escalate, and the loop validates and executes that decision.
 */

export const respondToUser: ToolDefinition = {
  terminal: true,
  spec: {
    name: 'respond_to_user',
    description:
      'Send your reply to the member and end the turn. Use it once you can actually help. The message is shown verbatim, so write it exactly as the member should read it.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The reply, in plain Discord text. 1-5 short paragraphs unless steps are needed.',
        },
        confidence: {
          type: 'string',
          description: 'Internal only, never shown: how well your sources actually cover this question.',
          enum: [...CONFIDENCE_LEVELS],
        },
        sources: {
          type: 'array',
          description: 'Hosts or knowledge ids you relied on (internal telemetry, not shown).',
          items: { type: 'string' },
        },
        resolved: {
          type: 'boolean',
          description: 'True only when this clearly closes the request and no follow-up is expected.',
        },
      },
      required: ['message', 'confidence'],
    },
  },
};

export const escalateToAdmin: ToolDefinition = {
  terminal: true,
  spec: {
    name: 'escalate_to_admin',
    description:
      'Hand the conversation to human staff and stop answering. Use it when confidence is low, the member asks for a human, staff powers or private data are required, the member is upset and unhelped, or you already tried and failed.',
    parameters: {
      type: 'object',
      properties: {
        user_message: {
          type: 'string',
          description:
            'Short, calm message to the member: what you could not resolve and that staff have been notified. No apology spiral, no promises about timing.',
        },
        problem: { type: 'string', description: 'Staff briefing: what the member is actually trying to do.' },
        key_facts: {
          type: 'array',
          description: 'Concrete facts from the conversation (ids, versions, error text, timings).',
          items: { type: 'string' },
        },
        attempted: {
          type: 'array',
          description: 'What you already tried or told them, so staff do not repeat it.',
          items: { type: 'string' },
        },
        suspected_cause: { type: 'string', description: 'Your best hypothesis, clearly labelled as a guess.' },
        why_escalated: { type: 'string', description: 'The specific reason a human is needed.' },
        recommended_action: { type: 'string', description: 'The concrete next step you recommend a human takes.' },
        urgency: {
          type: 'string',
          description: 'How time-sensitive this looks.',
          enum: ['low', 'normal', 'high'],
        },
      },
      required: ['user_message', 'problem', 'why_escalated'],
    },
  },
};

export const terminalTools: ToolDefinition[] = [respondToUser, escalateToAdmin];
