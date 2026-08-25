import { PROMPT_BUDGET } from '../config/constants.js';
import { child } from '../logging/logger.js';
import { redact } from '../security/redaction.js';
import { retrieveKnowledge, renderKnowledgeBlocks } from '../knowledge/retrieval.js';
import { errorMessage } from '../util/async.js';
import { shouldOfferWebSearch } from '../web/service.js';
import { judgeAfterAnswer, parseConfidence, requestsHuman } from './confidence.js';
import { buildSystemPrompt, buildTurns, renderTicketContextBlocks } from './promptBuilder.js';
import { buildToolset } from './tools/index.js';
const log = child('ai:agent');
const ESCALATION_LINE = 'I am not able to resolve this one myself, so I have flagged it for the team — someone will pick it up here.';
/** Remove anything that looks like a leaked prompt block, then redact secrets. */
export function sanitiseReply(text) {
    const withoutTags = text
        .replace(/‹\/?[a-z_]+[^›]*›/gi, '')
        .replace(/<\/?(system|user_content|server_knowledge|server_policy|active_incidents|web_content|ticket_transcript|situation|conversation_summary|ticket_facts)[^>]*>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return redact(withoutTags);
}
function toStringArray(value, limit = 8) {
    if (!Array.isArray(value))
        return typeof value === 'string' && value.trim() ? [value.trim()] : [];
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, limit);
}
function str(args, key) {
    const value = args[key];
    return typeof value === 'string' ? value.trim() : '';
}
function urgencyOf(args) {
    const value = str(args, 'urgency').toLowerCase();
    return value === 'low' || value === 'high' ? value : 'normal';
}
/**
 * The agent loop. Bounded, tool-driven and deterministic at the edges: the model may gather
 * information and then *propose* either an answer or an escalation, but this loop decides what
 * actually happens — including overriding a confident-sounding answer when confidence is low.
 */
export class SupportAgent {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async run(request) {
        const startedAt = Date.now();
        const { store, provider, web, tickets } = this.deps;
        const ctx = {
            store,
            web,
            tickets,
            guildId: request.guildId,
            ticket: request.ticket,
            userId: request.userId,
            askerIsStaff: request.askerIsStaff,
            question: request.question,
            knowledgeUsed: [],
            citations: [],
            usedWeb: false,
        };
        const offerWeb = web.searchEnabled && shouldOfferWebSearch(request.question);
        const toolset = buildToolset(ctx, { offerWeb });
        // Pre-load knowledge so an easy question costs zero tool round-trips.
        const retrieval = retrieveKnowledge(store, request.guildId, request.question, {
            charBudget: PROMPT_BUDGET.knowledgeChars,
        });
        for (const entry of retrieval.used)
            ctx.knowledgeUsed.push(entry);
        const context = tickets.context(request.guildId, request.ticket.id, request.messageLimit);
        const contextBlocks = context ? renderTicketContextBlocks(context) : [];
        const turns = context
            ? buildTurns(context, request.question, request.userId)
            : [{ kind: 'user', text: request.question }];
        const system = buildSystemPrompt({
            guildName: request.guildName,
            personaNote: request.settings.personaNote,
            ticket: {
                id: request.ticket.id,
                state: request.ticket.state,
                subject: request.ticket.subject,
                channelName: request.channelName,
            },
            askerIsStaff: request.askerIsStaff,
            knowledgeBlocks: renderKnowledgeBlocks(retrieval),
            contextBlocks,
            webSearchAvailable: offerWeb,
            webFetchAvailable: web.fetchAllowed,
            attemptsUsed: request.attemptsUsed,
            maxAttempts: request.settings.maxAiAttempts,
        });
        const calledSignatures = new Set();
        const toolCallNames = [];
        let lastResult;
        for (let iteration = 0; iteration < Math.max(1, request.maxIterations); iteration += 1) {
            let result;
            try {
                result = await provider.generate({
                    system,
                    turns,
                    tools: toolset.specs,
                    temperature: 0.35,
                    maxOutputTokens: 1400,
                });
            }
            catch (error) {
                log.error({ guildId: request.guildId, ticketId: request.ticket.id, err: errorMessage(error) }, 'provider failed');
                return this.providerFailure(ctx, toolCallNames, startedAt, provider, errorMessage(error));
            }
            lastResult = result;
            const terminal = result.toolCalls.find((call) => toolset.isTerminal(call.name));
            if (terminal) {
                toolCallNames.push(terminal.name);
                return this.finish(terminal, request, ctx, { result, toolCallNames, startedAt });
            }
            if (result.toolCalls.length === 0) {
                const text = sanitiseReply(result.text);
                if (text.length === 0)
                    break;
                // The model answered in prose instead of calling respond_to_user: accept it, but the
                // deterministic judge still gets the final say.
                return this.finish({ name: 'respond_to_user', args: { message: text, confidence: 'medium' } }, request, ctx, { result, toolCallNames, startedAt });
            }
            turns.push({ kind: 'model', text: result.text || undefined, toolCalls: result.toolCalls });
            const results = [];
            for (const call of result.toolCalls) {
                const signature = `${call.name}:${JSON.stringify(call.args)}`;
                toolCallNames.push(call.name);
                if (calledSignatures.has(signature)) {
                    results.push({
                        name: call.name,
                        response: { error: 'You already called this tool with these arguments. Answer or escalate now.' },
                    });
                    continue;
                }
                calledSignatures.add(signature);
                results.push({ name: call.name, response: await toolset.invoke(call.name, call.args) });
            }
            turns.push({ kind: 'tool', results });
        }
        // Ran out of iterations without a decision: hand over rather than loop forever.
        return {
            kind: 'escalate',
            userMessage: ESCALATION_LINE,
            confidence: 'low',
            trigger: 'attempt_limit',
            brief: {
                problem: request.question.slice(0, 600),
                keyFacts: [],
                attempted: [`Gathered information with ${toolCallNames.length} tool call(s) without reaching an answer.`],
                suspectedCause: null,
                whyEscalated: 'The AI could not converge on an answer within its tool budget.',
                recommendedAction: 'Read the conversation and reply directly.',
                urgency: 'normal',
                knowledgeUsed: ctx.knowledgeUsed.map((entry) => entry.title),
                sources: ctx.citations.map((citation) => citation.host),
            },
            model: lastResult?.model ?? provider.modelFor('main'),
            usage: lastResult?.usage ?? {},
            toolCalls: toolCallNames,
            usedWeb: ctx.usedWeb,
            latencyMs: Date.now() - startedAt,
        };
    }
    /** Turn a terminal tool call into the real outcome, with the deterministic judge on top. */
    finish(call, request, ctx, meta) {
        const telemetry = {
            model: meta.result.model,
            usage: meta.result.usage,
            toolCalls: meta.toolCallNames,
            usedWeb: ctx.usedWeb,
            latencyMs: Date.now() - meta.startedAt,
        };
        const knowledgeUsed = ctx.knowledgeUsed.map((entry) => entry.title);
        const hosts = ctx.citations.map((citation) => citation.host);
        if (call.name === 'escalate_to_admin') {
            const args = call.args;
            return {
                kind: 'escalate',
                userMessage: sanitiseReply(str(args, 'user_message')) || ESCALATION_LINE,
                confidence: 'low',
                trigger: requestsHuman(request.question) ? 'user_requested' : 'ai_requested',
                brief: {
                    problem: redact(str(args, 'problem')) || request.question.slice(0, 600),
                    keyFacts: toStringArray(args['key_facts']).map(redact),
                    attempted: toStringArray(args['attempted']).map(redact),
                    suspectedCause: redact(str(args, 'suspected_cause')) || null,
                    whyEscalated: redact(str(args, 'why_escalated')) || 'The AI decided a human is needed.',
                    recommendedAction: redact(str(args, 'recommended_action')) || null,
                    urgency: urgencyOf(args),
                    knowledgeUsed,
                    sources: hosts,
                },
                ...telemetry,
            };
        }
        const message = sanitiseReply(str(call.args, 'message'));
        const confidence = parseConfidence(call.args['confidence']);
        const judgement = judgeAfterAnswer({
            confidence,
            attemptsUsed: request.attemptsUsed,
            maxAttempts: request.settings.maxAiAttempts,
            userText: request.question,
        });
        if (message.length === 0 || judgement.escalate) {
            // A medium-confidence partial answer is still useful, so keep it and add the handover
            // line. A low-confidence one is a guess and is dropped.
            const keepPartial = message.length > 0 && confidence === 'medium';
            const trigger = requestsHuman(request.question)
                ? 'user_requested'
                : confidence === 'low' || message.length === 0
                    ? 'ai_low_confidence'
                    : 'attempt_limit';
            return {
                kind: 'escalate',
                userMessage: keepPartial ? `${message}\n\n${ESCALATION_LINE}` : ESCALATION_LINE,
                confidence,
                trigger,
                brief: {
                    problem: request.question.slice(0, 600),
                    keyFacts: [],
                    attempted: keepPartial ? [`Told the member: ${message.slice(0, 400)}`] : [],
                    suspectedCause: null,
                    whyEscalated: judgement.reason || 'The AI produced no usable answer.',
                    recommendedAction: 'Reply to the member directly with the missing information.',
                    urgency: 'normal',
                    knowledgeUsed,
                    sources: hosts,
                },
                ...telemetry,
            };
        }
        return {
            kind: 'answer',
            message,
            confidence,
            sources: [...new Set([...toStringArray(call.args['sources']), ...hosts])],
            resolved: call.args['resolved'] === true,
            ...telemetry,
        };
    }
    /** The model is unreachable. Never guess — tell the member and get a human. */
    providerFailure(ctx, toolCallNames, startedAt, provider, detail) {
        return {
            kind: 'escalate',
            userMessage: 'I am having trouble reaching my AI service right now, so I have alerted the team instead of guessing.',
            confidence: 'low',
            trigger: 'provider_failure',
            brief: {
                problem: ctx.question.slice(0, 600),
                keyFacts: [`AI provider error: ${redact(detail).slice(0, 300)}`],
                attempted: [],
                suspectedCause: 'AI provider outage, quota or configuration problem.',
                whyEscalated: 'The AI provider failed after retries.',
                recommendedAction: 'Answer manually and check the bot logs or API quota.',
                urgency: 'high',
                knowledgeUsed: ctx.knowledgeUsed.map((entry) => entry.title),
                sources: [],
            },
            model: provider.modelFor('main'),
            usage: {},
            toolCalls: toolCallNames,
            usedWeb: ctx.usedWeb,
            latencyMs: Date.now() - startedAt,
        };
    }
}
export function createSupportAgent(deps) {
    return new SupportAgent(deps);
}
//# sourceMappingURL=supportAgent.js.map