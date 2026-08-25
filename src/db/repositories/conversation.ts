import type { Db } from '../client.js';
import type { AuthorKind, TicketFact, TicketMessage, TicketSummary } from '../types.js';

interface MessageRow {
  id: number;
  ticket_id: number;
  guild_id: string;
  discord_message_id: string | null;
  author_id: string;
  author_kind: string;
  content: string;
  created_at: number;
}

const mapMessage = (row: MessageRow): TicketMessage => ({
  id: row.id,
  ticketId: row.ticket_id,
  guildId: row.guild_id,
  discordMessageId: row.discord_message_id,
  authorId: row.author_id,
  authorKind: row.author_kind as AuthorKind,
  content: row.content,
  createdAt: row.created_at,
});

export interface NewTicketMessage {
  ticketId: number;
  guildId: string;
  discordMessageId?: string | null;
  authorId: string;
  authorKind: AuthorKind;
  content: string;
}

/** Conversation store: transcript, rolling summaries and per-ticket facts. */
export function createConversationRepository(db: Db) {
  const insertMessage = db.raw.prepare(
    `INSERT INTO ticket_messages
       (ticket_id, guild_id, discord_message_id, author_id, author_kind, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    addMessage(input: NewTicketMessage): TicketMessage {
      const now = Date.now();
      const info = insertMessage.run(
        input.ticketId,
        input.guildId,
        input.discordMessageId ?? null,
        input.authorId,
        input.authorKind,
        input.content.slice(0, 4000),
        now,
      );
      return {
        id: Number(info.lastInsertRowid),
        ticketId: input.ticketId,
        guildId: input.guildId,
        discordMessageId: input.discordMessageId ?? null,
        authorId: input.authorId,
        authorKind: input.authorKind,
        content: input.content.slice(0, 4000),
        createdAt: now,
      };
    },

    /** Chronological tail of the transcript (oldest → newest). */
    recentMessages(guildId: string, ticketId: number, limit: number): TicketMessage[] {
      const rows = db.raw
        .prepare(
          `SELECT * FROM ticket_messages WHERE guild_id = ? AND ticket_id = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(guildId, ticketId, limit) as MessageRow[];
      return rows.reverse().map(mapMessage);
    },

    /** Messages newer than a summary checkpoint (oldest → newest). */
    messagesAfter(guildId: string, ticketId: number, afterId: number, limit = 100): TicketMessage[] {
      const rows = db.raw
        .prepare(
          `SELECT * FROM ticket_messages WHERE guild_id = ? AND ticket_id = ? AND id > ?
           ORDER BY id ASC LIMIT ?`,
        )
        .all(guildId, ticketId, afterId, limit) as MessageRow[];
      return rows.map(mapMessage);
    },

    countMessages(guildId: string, ticketId: number): number {
      const row = db.raw
        .prepare('SELECT COUNT(*) AS n FROM ticket_messages WHERE guild_id = ? AND ticket_id = ?')
        .get(guildId, ticketId) as { n: number };
      return row.n;
    },

    addSummary(guildId: string, ticketId: number, summary: string, throughMessageId: number): TicketSummary {
      const now = Date.now();
      const info = db.raw
        .prepare(
          `INSERT INTO ticket_summaries (ticket_id, guild_id, summary, through_message_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(ticketId, guildId, summary, throughMessageId, now);
      return {
        id: Number(info.lastInsertRowid),
        ticketId,
        guildId,
        summary,
        throughMessageId,
        createdAt: now,
      };
    },

    latestSummary(guildId: string, ticketId: number): TicketSummary | undefined {
      const row = db.raw
        .prepare(
          `SELECT * FROM ticket_summaries WHERE guild_id = ? AND ticket_id = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(guildId, ticketId) as
        | { id: number; ticket_id: number; guild_id: string; summary: string; through_message_id: number; created_at: number }
        | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        ticketId: row.ticket_id,
        guildId: row.guild_id,
        summary: row.summary,
        throughMessageId: row.through_message_id,
        createdAt: row.created_at,
      };
    },

    addFact(guildId: string, ticketId: number, label: string, value: string): void {
      db.raw
        .prepare(
          `INSERT INTO ticket_facts (ticket_id, guild_id, label, value, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(ticketId, guildId, label.slice(0, 120), value.slice(0, 600), Date.now());
    },

    listFacts(guildId: string, ticketId: number, limit = 20): TicketFact[] {
      const rows = db.raw
        .prepare(
          `SELECT * FROM ticket_facts WHERE guild_id = ? AND ticket_id = ? ORDER BY id DESC LIMIT ?`,
        )
        .all(guildId, ticketId, limit) as {
        id: number;
        ticket_id: number;
        guild_id: string;
        label: string;
        value: string;
        created_at: number;
      }[];
      return rows.reverse().map((row) => ({
        id: row.id,
        ticketId: row.ticket_id,
        guildId: row.guild_id,
        label: row.label,
        value: row.value,
        createdAt: row.created_at,
      }));
    },
  };
}

export type ConversationRepository = ReturnType<typeof createConversationRepository>;
