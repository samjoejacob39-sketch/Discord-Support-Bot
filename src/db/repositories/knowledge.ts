import type { Db } from '../client.js';
import type {
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeStatus,
  KnowledgeVisibility,
  NewKnowledgeEntry,
} from '../types.js';

interface EntryRow {
  id: number;
  guild_id: string;
  category: string;
  kind: string;
  status: string;
  visibility: string;
  title: string;
  content: string;
  priority: number;
  flagged: number;
  expires_at: number | null;
  created_by: string;
  created_at: number;
  updated_by: string | null;
  updated_at: number;
}

const map = (row: EntryRow): KnowledgeEntry => ({
  id: row.id,
  guildId: row.guild_id,
  category: row.category,
  kind: row.kind as KnowledgeKind,
  status: row.status as KnowledgeStatus,
  visibility: row.visibility as KnowledgeVisibility,
  title: row.title,
  content: row.content,
  priority: row.priority,
  flagged: row.flagged === 1,
  expiresAt: row.expires_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
});

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'have', 'has',
  'how', 'why', 'what', 'when', 'where', 'can', 'does', 'did', 'was', 'were', 'from', 'into', 'about',
  'please', 'there', 'they', 'them', 'been', 'just', 'get', 'got', 'any', 'all', 'some', 'would',
]);

/** Extract meaningful search terms from free-form user text. */
export function extractTerms(query: string, limit = 12): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    const term = raw.trim();
    if (term.length < 3 || STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= limit) break;
  }
  return terms;
}

/** Build a safe FTS5 MATCH expression (quoted tokens, prefix-matched, OR-joined). */
export function buildMatchExpression(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replace(/"/g, '')}"*`).join(' OR ');
}

export interface ListKnowledgeOptions {
  category?: string;
  kind?: KnowledgeKind;
  status?: KnowledgeStatus | 'any';
  limit?: number;
  offset?: number;
}

export function createKnowledgeRepository(db: Db) {
  const insert = db.raw.prepare(
    `INSERT INTO knowledge_entries
       (guild_id, category, kind, status, visibility, title, content, priority, flagged,
        expires_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const repo = {
    create(entry: NewKnowledgeEntry): KnowledgeEntry {
      const now = Date.now();
      const info = insert.run(
        entry.guildId,
        entry.category,
        entry.kind,
        entry.visibility ?? 'public',
        entry.title,
        entry.content,
        entry.priority ?? 0,
        entry.flagged ? 1 : 0,
        entry.expiresAt ?? null,
        entry.createdBy,
        now,
        now,
      );
      return repo.get(entry.guildId, Number(info.lastInsertRowid))!;
    },

    get(guildId: string, id: number): KnowledgeEntry | undefined {
      const row = db.raw
        .prepare('SELECT * FROM knowledge_entries WHERE guild_id = ? AND id = ?')
        .get(guildId, id) as EntryRow | undefined;
      return row ? map(row) : undefined;
    },

    list(guildId: string, options: ListKnowledgeOptions = {}): KnowledgeEntry[] {
      const clauses = ['guild_id = ?'];
      const params: unknown[] = [guildId];
      const status = options.status ?? 'active';
      if (status !== 'any') {
        clauses.push('status = ?');
        params.push(status);
      }
      if (options.category) {
        clauses.push('category = ?');
        params.push(options.category);
      }
      if (options.kind) {
        clauses.push('kind = ?');
        params.push(options.kind);
      }
      params.push(options.limit ?? 25, options.offset ?? 0);
      const rows = db.raw
        .prepare(
          `SELECT * FROM knowledge_entries WHERE ${clauses.join(' AND ')}
           ORDER BY priority DESC, updated_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params) as EntryRow[];
      return rows.map(map);
    },

    count(guildId: string, options: Pick<ListKnowledgeOptions, 'category' | 'kind' | 'status'> = {}): number {
      const clauses = ['guild_id = ?'];
      const params: unknown[] = [guildId];
      const status = options.status ?? 'active';
      if (status !== 'any') {
        clauses.push('status = ?');
        params.push(status);
      }
      if (options.category) {
        clauses.push('category = ?');
        params.push(options.category);
      }
      if (options.kind) {
        clauses.push('kind = ?');
        params.push(options.kind);
      }
      const row = db.raw
        .prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE ${clauses.join(' AND ')}`)
        .get(...params) as { n: number };
      return row.n;
    },

    countsByCategory(guildId: string): { category: string; count: number }[] {
      const rows = db.raw
        .prepare(
          `SELECT category, COUNT(*) AS n FROM knowledge_entries
           WHERE guild_id = ? AND status = 'active' GROUP BY category ORDER BY n DESC`,
        )
        .all(guildId) as { category: string; n: number }[];
      return rows.map((row) => ({ category: row.category, count: row.n }));
    },

    activeIncidents(guildId: string, now = Date.now()): KnowledgeEntry[] {
      const rows = db.raw
        .prepare(
          `SELECT * FROM knowledge_entries
           WHERE guild_id = ? AND status = 'active' AND kind IN ('incident', 'temporary')
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY kind = 'incident' DESC, priority DESC, updated_at DESC LIMIT 12`,
        )
        .all(guildId, now) as EntryRow[];
      return rows.map(map);
    },

    /** Relevance search: BM25 through FTS5 when available, keyword scoring otherwise. */
    search(guildId: string, query: string, limit = 6): KnowledgeEntry[] {
      const terms = extractTerms(query);
      if (terms.length === 0) return [];

      if (db.ftsAvailable) {
        const match = buildMatchExpression(terms);
        if (match) {
          try {
            const rows = db.raw
              .prepare(
                `SELECT e.* FROM knowledge_fts f
                 JOIN knowledge_entries e ON e.id = f.rowid
                 WHERE knowledge_fts MATCH ? AND e.guild_id = ? AND e.status = 'active'
                 ORDER BY bm25(knowledge_fts, 2.0, 1.0) ASC, e.priority DESC LIMIT ?`,
              )
              .all(match, guildId, limit) as EntryRow[];
            if (rows.length > 0) return rows.map(map);
          } catch {
            /* fall through to LIKE scoring */
          }
        }
      }

      const likeClauses = terms.map(() => '(content LIKE ? OR title LIKE ?)').join(' OR ');
      const params: unknown[] = [guildId];
      for (const term of terms) params.push(`%${term}%`, `%${term}%`);
      const rows = db.raw
        .prepare(
          `SELECT * FROM knowledge_entries
           WHERE guild_id = ? AND status = 'active' AND (${likeClauses})
           ORDER BY priority DESC, updated_at DESC LIMIT 40`,
        )
        .all(...params) as EntryRow[];

      const scored = rows.map((row) => {
        const haystack = `${row.title} ${row.content}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { row, score };
      });
      scored.sort((a, b) => b.score - a.score || b.row.priority - a.row.priority);
      return scored.slice(0, limit).map((item) => map(item.row));
    },

    setStatus(guildId: string, id: number, status: KnowledgeStatus, actorId: string): boolean {
      return (
        db.raw
          .prepare(
            `UPDATE knowledge_entries SET status = ?, updated_by = ?, updated_at = ?
             WHERE guild_id = ? AND id = ?`,
          )
          .run(status, actorId, Date.now(), guildId, id).changes > 0
      );
    },

    delete(guildId: string, id: number): boolean {
      return db.raw.prepare('DELETE FROM knowledge_entries WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
    },

    /** Flip expired temporary knowledge to `expired`. Returns affected rows. */
    expireDue(now = Date.now()): number {
      return db.raw
        .prepare(
          `UPDATE knowledge_entries SET status = 'expired', updated_at = ?
           WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .run(now, now).changes;
    },
  };

  return repo;
}

export type KnowledgeRepository = ReturnType<typeof createKnowledgeRepository>;
