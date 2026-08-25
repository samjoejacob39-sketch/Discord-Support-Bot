import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { BOT_NAME } from '../../config/constants.js';
import { child } from '../../logging/logger.js';
import { infoEmbed } from '../ui/embeds.js';
const log = child('discord:guilds');
/** First text channel the bot may actually post in. */
function greetingChannel(guild) {
    const me = guild.members.me;
    if (!me)
        return undefined;
    const candidates = [
        guild.systemChannel,
        ...guild.channels.cache
            .filter((channel) => channel.type === ChannelType.GuildText)
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .values(),
    ];
    for (const channel of candidates) {
        if (!channel || channel.type !== ChannelType.GuildText)
            continue;
        const permissions = channel.permissionsFor(me);
        if (permissions?.has(PermissionFlagsBits.SendMessages) && permissions.has(PermissionFlagsBits.ViewChannel)) {
            return channel;
        }
    }
    return undefined;
}
/** Register the guild and explain the three setup steps once, in the server itself (§2). */
export async function handleGuildCreate(guild, ctx) {
    ctx.store.guilds.ensure(guild.id, guild.name);
    log.info({ guildId: guild.id, name: guild.name, members: guild.memberCount }, 'joined guild');
    const channel = greetingChannel(guild);
    if (!channel)
        return;
    await channel
        .send({
        embeds: [
            infoEmbed(`${BOT_NAME} is here`, [
                'I answer support questions from what your team teaches me, check the web when a question needs current facts, and hand a conversation to a human the moment I am not sure.',
                '',
                '**Three steps to set me up — all here in Discord, there is no website:**',
                '1. `/shinadmin add user:@Mod` — who may teach me and who gets pinged on escalations.',
                '2. `/shinconfig mode mode:channels` + `/shinconfig channel channel:#support` — where I answer on my own.',
                '3. `/learn <what I should know>` — start with your rules, hours and common answers.',
                '',
                'Until then I only reply when someone uses `/ask` or mentions me. `/help` lists everything.',
            ].join('\n')),
        ],
        allowedMentions: { parse: [] },
    })
        .catch((error) => log.warn({ guildId: guild.id, err: String(error) }, 'greeting failed'));
}
/** Keep the row for history and knowledge, but mark the guild as left. */
export function handleGuildDelete(guild, ctx) {
    ctx.store.guilds.markLeft(guild.id);
    log.info({ guildId: guild.id, name: guild.name }, 'left guild');
}
//# sourceMappingURL=guilds.js.map