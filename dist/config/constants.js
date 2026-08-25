/** Values that are stable across the whole product and referenced from many layers. */
export const BOT_NAME = 'Shinchat Helper';
export const COLORS = {
    primary: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    danger: 0xed4245,
    neutral: 0x99aab5,
    escalation: 0xf47b67,
};
/** Discord hard limits we shape output against. */
export const DISCORD_LIMITS = {
    messageLength: 2000,
    embedDescription: 4096,
    embedFieldValue: 1024,
    embedFields: 25,
    autocompleteChoices: 25,
    autocompleteNameLength: 100,
};
/** How much of a knowledge/web payload we are willing to spend on one prompt. */
export const PROMPT_BUDGET = {
    knowledgeChars: 6000,
    webContentChars: 6000,
    summaryChars: 1500,
    recentMessageChars: 900,
};
/** Defaults for a freshly seen guild. */
export const DEFAULT_GUILD_SETTINGS = {
    supportMode: 'invoked',
    aiEnabled: true,
    maxAiAttempts: 3,
};
export const SUPPORT_MODES = ['invoked', 'channels', 'categories', 'all'];
export const SUPPORT_MODE_HELP = {
    invoked: 'Only answers when someone uses `/ask` or mentions the bot. Safest default.',
    channels: 'Answers automatically in the configured support channels and their threads.',
    categories: 'Answers automatically in any channel inside the configured categories.',
    all: 'Answers automatically anywhere it can read. Use with care in busy servers.',
};
/** Cooldown/cache windows in milliseconds. */
export const TIMINGS = {
    duplicateResponseTtlMs: 90_000,
    rateLimitWindowMs: 60_000,
    expirySweepMs: 5 * 60_000,
    presenceRefreshMs: 10 * 60_000,
    cachePruneMs: 15 * 60_000,
    typingRefreshMs: 8_000,
    aiRequestTimeoutMs: 60_000,
    webFetchTimeoutMs: 15_000,
    webSearchTimeoutMs: 12_000,
};
//# sourceMappingURL=constants.js.map