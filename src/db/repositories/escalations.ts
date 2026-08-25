import type { Db } from '../client.js';
import type { Escalation, EscalationTrigger } from '../types.js';

interface EscalationRow {
  id: number;
  ticket_id: number;
  guild_id: string;
  trigger: string;
  reason: string;
  summary: string | null;
  recommended_action: string | null;
  notified_user_ids: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

function parseIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const map = (row: EscalationRow): Escalation => ({
  id: row.id,
  ticketId: row.ticket_id,
  guildId: row.guild_id,
  trigger: row.trigger as EscalationTrigger,
  reason: row.reason,
  summary: row.summary,
  recommendedAction: row.recommended_action,
  notifiedUserIds: parseIds(row.notified_user_ids),
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
});

export interface NewEscalation {
  ticketId: number;
  guildId: string;
  trigger: EscalationTrigger;
  reason: string;
  summary?: string | null;
  recommendedAction?: string | null;
  notifiedUserIds: string[];
}

export function createEscalationRepository(db: Db) {
  const insert = db.raw.prepare(
    `INSERT INTO escalations
       (ticket_id, guild_id, trigger, reason, summary, recommended_action, notified_user_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const repo = {
    create(input: NewEscalation): Escalation {
      const now = Date.now();
      const info = insert.run(
        input.ticketId,
        input.guildId,
        input.trigger,
        input.reason.slice(0, 1000),
        input.summary ?? null,
        input.recommendedAction ?? null,
        JSON.stringify(input.notifiedUserIds),
        now,
      );
      return repo.get(input.guildId, Number(info.lastInsertRowid))!;
    },

    get(guildId: string, id: number): Escalation | undefined {
      const row = db.raw.prepare('SELECT * FROM escalations WHERE guild_id = ? AND id = ?').get(guildId, id) as
        | EscalationRow
        | undefined;
      return row ? map(row) : undefined;
    },

    latestOpenForTicket(guildId: string, ticketId: number): Escalation | undefined {
      const row = db.raw
        .prepare(
          `SELECT * FROM escalations WHERE guild_id = ? AND ticket_id = ? AND resolved_at IS NULL
           ORDER BY id DESC LIMIT 1`,
        )
        .get(guildId, ticketId) as EscalationRow | undefined;
      return row ? map(row) : undefined;
    },

    resolveForTicket(guildId: string, ticketId: number, resolvedBy: string): number {
      return db.raw
        .prepare(
          `UPDATE escalations SET resolved_at = ?, resolved_by = ?
           WHERE guild_id = ? AND ticket_id = ? AND resolved_at IS NULL`,
        )
        .run(Date.now(), resolvedBy, guildId, ticketId).changes;
    },

    countOpen(guildId: string): number {
      const row = db.raw
        .prepare('SELECT COUNT(*) AS n FROM escalations WHERE guild_id = ? AND resolved_at IS NULL')
        .get(guildId) as { n: number };
      return row.n;
    },
  };

  return repo;
}

export type EscalationRepository = ReturnType<typeof createEscalationRepository>;
