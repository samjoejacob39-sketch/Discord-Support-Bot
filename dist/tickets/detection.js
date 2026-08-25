import { ChannelType } from 'discord.js';
const IGNORE = (reason) => ({ record: false, respond: false, reason, invoked: false });
/** The channel that owns a ticket: a thread's parent channel, or the channel itself. */
export function supportSurfaceIds(channel) {
    if (channel.isThread()) {
        const parent = channel.parent;
        return {
            channelId: channel.id,
            parentChannelId: parent?.id ?? null,
            categoryId: parent?.parentId ?? null,
        };
    }
    return { channelId: channel.id, parentChannelId: null, categoryId: channel.parentId ?? null };
}
function isSupportSurface(channel, settings) {
    const { channelId, parentChannelId, categoryId } = supportSurfaceIds(channel);
    switch (settings.supportMode) {
        case 'all':
            return true;
        case 'channels':
            return (settings.supportChannelIds.includes(channelId) ||
                (parentChannelId !== null && settings.supportChannelIds.includes(parentChannelId)));
        case 'categories':
            return categoryId !== null && settings.supportCategoryIds.includes(categoryId);
        case 'invoked':
        default:
            return false;
    }
}
/**
 * Decide whether Shinchat Helper should touch a message at all. Defaults are deliberately
 * quiet: without configuration the bot only answers when it is mentioned, so installing it
 * never turns a busy server into an AI chatroom.
 */
export function evaluateMessage(message, settings, botUserId) {
    if (!message.inGuild())
        return IGNORE('not a guild message');
    if (message.author.bot || message.webhookId)
        return IGNORE('authored by a bot');
    if (message.system)
        return IGNORE('system message');
    if (message.channel.type === ChannelType.GuildStageVoice)
        return IGNORE('unsupported channel type');
    const content = message.content?.trim() ?? '';
    const invoked = message.mentions.users.has(botUserId);
    if (content.length === 0 && !invoked)
        return IGNORE('no text content');
    if (!settings.aiEnabled) {
        return { record: isSupportSurface(message.channel, settings) || invoked, respond: false, reason: 'AI disabled for this server', invoked };
    }
    const onSupportSurface = isSupportSurface(message.channel, settings);
    if (!onSupportSurface && !invoked) {
        return IGNORE(`support mode is "${settings.supportMode}" and this channel is not configured`);
    }
    return {
        record: true,
        respond: true,
        reason: invoked ? 'bot was mentioned' : `support surface (${settings.supportMode})`,
        invoked,
    };
}
/** Strip the bot mention so the model sees a clean question. */
export function cleanContent(message, botUserId) {
    return (message.content ?? '')
        .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
        .replace(/\s+/g, ' ')
        .trim();
}
//# sourceMappingURL=detection.js.map