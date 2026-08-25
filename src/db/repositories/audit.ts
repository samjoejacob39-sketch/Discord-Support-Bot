import type { Db } from '../client.js';
import type { AuditEntry } from '../types.js';

/** Audit actions worth keeping. Intentionally coarse — never logs message content. */
export const AUDIT_ACTIONS = {
  knowledgeAdd: 'knowledge.add',
  knowledgeRemove: 'knowledge.remove',
  knowledgeDisable: 'knowledge.disable',
  knowledgeEnable: 'knowledge.enable',
  adminAdd: 'admin.add',
  adminRemove: 'admin.remove',
  settingsUpdate: 'settings.update',
  settingsReset: 'settings.reset',
  ticketEscalate: 'ticket.escalate',
  ticketResume: 'ticket.resume',
  ticketResolve: 'ticket.resolve',
  ticketClose: 'ticket.close',
  ticketReopen: 'ticket.reopen',
  ticketAiToggle: 'ticket.ai_toggle',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

interface AuditRow {
  id: number;
  guild_id: string;
  actor_id: string;
  action: string;
  target: string | null;
  metadata: string;
  created_at: number;
}

function parseMetadata(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createAuditRepository(db: Db) {
  const insert = db.raw.prepare(
    'INSERT INTO audit_log (guild_id, actor_id, action, target, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  return {
    record(
      guildId: string,
      actorId: string,
      action: AuditAction | string,
      target?: string | null,
      metadata: Record<string, unknown> = {},
    ): void {
      insert.run(guildId, actorId, action, target ?? null, JSON.stringify(metadata), Date.now());
    },

    list(guildId: string, limit = 20, offset = 0): AuditEntry[] {
      const rows = db.raw
        .prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(guildId, limit, offset) as AuditRow[];
      return rows.map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        actorId: row.actor_id,
        action: row.action,
        target: row.target,
        metadata: parseMetadata(row.metadata),
        createdAt: row.created_at,
      }));
    },

    count(guildId: string): number {
      const row = db.raw.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE guild_id = ?').get(guildId) as {
        n: number;
      };
      return row.n;
    },
  };
}

export type AuditRepository = ReturnType<typeof createAuditRepository>;
