import { EmbedBuilder } from 'discord.js';
import { BOT_NAME, COLORS, DISCORD_LIMITS } from '../../config/constants.js';
import type { KnowledgeEntry, Ticket } from '../../db/types.js';
import { categoryLabel } from '../../knowledge/categories.js';
import { summariseEntries } from '../../knowledge/retrieval.js';
import { STATE_DESCRIPTIONS, STATE_LABELS } from '../../tickets/stateMachine.js';
import { relativeTimestamp, truncate } from '../../util/text.js';

/** Small embed vocabulary so every surface of the bot looks like the same product. */

export function baseEmbed(color: number, title?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(truncate(title, 250));
  return embed;
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(COLORS.primary, title);
  if (description) embed.setDescription(truncate(description, DISCORD_LIMITS.embedDescription));
  return embed;
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(COLORS.success, `✅ ${title}`);
  if (description) embed.setDescription(truncate(description, DISCORD_LIMITS.embedDescription));
  return embed;
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(COLORS.warning, `⚠️ ${title}`);
  if (description) embed.setDescription(truncate(description, DISCORD_LIMITS.embedDescription));
  return embed;
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed(COLORS.danger, `❌ ${title}`);
  if (description) embed.setDescription(truncate(description, DISCORD_LIMITS.embedDescription));
  return embed;
}

/** Full detail of one knowledge entry (staff-facing). */
export function knowledgeEmbed(entry: KnowledgeEntry): EmbedBuilder {
  const embed = baseEmbed(entry.kind === 'incident' ? COLORS.danger : COLORS.primary, `#${entry.id} · ${entry.title}`)
    .setDescription(truncate(entry.content, DISCORD_LIMITS.embedDescription))
    .addFields(
      { name: 'Category', value: categoryLabel(entry.category), inline: true },
      { name: 'Kind', value: entry.kind, inline: true },
      { name: 'Status', value: entry.status, inline: true },
      { name: 'Visibility', value: entry.visibility === 'staff' ? '🔒 staff only' : 'public', inline: true },
      { name: 'Taught by', value: `<@${entry.createdBy}>`, inline: true },
      { name: 'Added', value: relativeTimestamp(entry.createdAt), inline: true },
    );
  if (entry.expiresAt) {
    embed.addFields({ name: 'Expires', value: relativeTimestamp(entry.expiresAt), inline: true });
  }
  if (entry.flagged) {
    embed.addFields({
      name: '⚠️ Flagged content',
      value:
        'This note contains phrasing that looks like an instruction override attempt. It is stored as **policy data only** and can never change the bot’s safety rules.',
    });
  }
  return embed;
}

export interface ListPage {
  entries: KnowledgeEntry[];
  page: number;
  pageCount: number;
  total: number;
  heading: string;
}

export function knowledgeListEmbed(page: ListPage): EmbedBuilder {
  return infoEmbed(page.heading, summariseEntries(page.entries)).setFooter({
    text: `Page ${page.page}/${Math.max(1, page.pageCount)} · ${page.total} entr${page.total === 1 ? 'y' : 'ies'} · ${BOT_NAME}`,
  });
}

export function ticketEmbed(ticket: Ticket, extras: { openEscalation?: boolean; messageCount?: number } = {}): EmbedBuilder {
  const embed = baseEmbed(COLORS.primary, `Ticket #${ticket.id}`)
    .setDescription(`${STATE_LABELS[ticket.state]} — ${STATE_DESCRIPTIONS[ticket.state]}`)
    .addFields(
      { name: 'Opened by', value: `<@${ticket.openerUserId}>`, inline: true },
      { name: 'Channel', value: `<#${ticket.channelId}>`, inline: true },
      { name: 'Started', value: relativeTimestamp(ticket.createdAt), inline: true },
      { name: 'AI attempts', value: String(ticket.aiAttempts), inline: true },
      { name: 'Escalations', value: String(ticket.escalationCount), inline: true },
      { name: 'Last activity', value: relativeTimestamp(ticket.lastActivityAt), inline: true },
    );
  if (ticket.subject) embed.addFields({ name: 'Topic', value: truncate(ticket.subject, 200) });
  if (typeof extras.messageCount === 'number') {
    embed.addFields({ name: 'Messages recorded', value: String(extras.messageCount), inline: true });
  }
  if (extras.openEscalation) {
    embed.addFields({ name: 'Open escalation', value: 'Waiting for staff. Use `/shin-continue` to hand it back to the AI.' });
  }
  return embed;
}
