import { TIMINGS } from '../config/constants.js';
import { child } from '../logging/logger.js';
import { chunkMessage, preview } from '../util/text.js';
const log = child('ai:pipeline');
/**
 * One AI support turn, shared by `/ask` and by automatic message handling. Everything that must
 * happen exactly once per answer lives here: rate limiting, ticket bookkeeping, the agent call,
 * escalation, delivery, telemetry and summarisation.
 */
export async function runSupportTurn(input) {
    const { ctx, guild, channel, asker, settings, question } = input;
    if (!input.skipRateLimit) {
        const verdict = ctx.limiter.check(guild.id, asker.id);
        if (!verdict.allowed) {
            return { status: 'rate_limited', retryAfterMs: verdict.retryAfterMs, scope: verdict.scope ?? 'user' };
        }
    }
    const ticket = ctx.tickets.ensure({
        guildId: guild.id,
        channelId: channel.id,
        parentId: channel.isThread() ? channel.parentId : null,
        openerUserId: asker.id,
        subject: preview(question, 140),
    });
    ctx.tickets.recordUserMessage(ticket, asker.id, question, input.sourceMessageId);
    if (!ctx.tickets.canAiSpeak(ticket)) {
        return { status: 'silent', ticket, reason: `ticket state ${ticket.state}` };
    }
    // Cheap duplicate guard: the same question in the same channel within the window reuses the
    // previous answer instead of paying for another model call (§55).
    const cacheKey = ctx.store.telemetry.hashPrompt([channel.id, question.toLowerCase().replace(/\s+/g, ' ')]);
    const cached = ctx.store.telemetry.getCached(guild.id, cacheKey, TIMINGS.duplicateResponseTtlMs);
    if (cached) {
        await deliverAll(input, cached);
        ctx.tickets.recordBotMessage(ticket, input.botUserId, cached);
        return { status: 'answered', ticket, message: cached, cached: true };
    }
    const { ticket: active, attempts } = ctx.tickets.beginAiTurn(ticket);
    const outcome = await ctx.agent.run({
        guildId: guild.id,
        guildName: guild.name,
        channelName: 'name' in channel && channel.name ? channel.name : 'this channel',
        settings,
        ticket: active,
        userId: asker.id,
        askerIsStaff: input.askerIsStaff,
        question,
        maxIterations: ctx.env.AI_MAX_TOOL_ITERATIONS,
        messageLimit: ctx.env.AI_CONTEXT_MESSAGE_LIMIT,
        attemptsUsed: attempts,
    });
    ctx.store.telemetry.recordInteraction({
        guildId: guild.id,
        ticketId: active.id,
        userId: asker.id,
        model: outcome.model,
        confidence: outcome.confidence ?? null,
        escalated: outcome.kind === 'escalate',
        usedWeb: outcome.usedWeb,
        toolCalls: outcome.toolCalls,
        inputTokens: outcome.usage.inputTokens ?? null,
        outputTokens: outcome.usage.outputTokens ?? null,
        latencyMs: outcome.latencyMs,
    });
    if (outcome.kind === 'answer') {
        await deliverAll(input, outcome.message);
        ctx.tickets.recordBotMessage(active, input.botUserId, outcome.message);
        ctx.store.telemetry.putCached(guild.id, cacheKey, outcome.message);
        if (outcome.confidence === 'high')
            ctx.tickets.markAiSuccess(active);
        void ctx.summarizer.maybeSummarise(guild.id, active.id).catch(() => undefined);
        log.debug({ guildId: guild.id, ticketId: active.id, confidence: outcome.confidence, tools: outcome.toolCalls.length }, 'answered');
        return { status: 'answered', ticket: active, message: outcome.message };
    }
    await deliverAll(input, outcome.userMessage);
    ctx.tickets.recordBotMessage(active, input.botUserId, outcome.userMessage);
    await ctx.escalation.escalate({
        guild,
        channel,
        ticket: active,
        settings,
        trigger: outcome.trigger,
        brief: outcome.brief,
        userMessage: outcome.userMessage,
        actorId: input.botUserId,
        announceToMember: false,
    });
    void ctx.summarizer.maybeSummarise(guild.id, active.id).catch(() => undefined);
    return { status: 'escalated', ticket: active, message: outcome.userMessage };
}
async function deliverAll(input, content) {
    const chunks = chunkMessage(content);
    for (const [index, chunk] of chunks.entries()) {
        await input.deliver(chunk, index);
    }
}
//# sourceMappingURL=aiPipeline.js.map