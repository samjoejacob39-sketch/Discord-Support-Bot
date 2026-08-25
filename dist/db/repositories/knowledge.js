const map = (row) => ({
    id: row.id,
    guildId: row.guild_id,
    category: row.category,
    kind: row.kind,
    status: row.status,
    visibility: row.visibility,
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
export function extractTerms(query, limit = 12) {
    const seen = new Set();
    const terms = [];
    for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
        const term = raw.trim();
        if (term.length < 3 || STOPWORDS.has(term) || seen.has(term))
            continue;
        seen.add(term);
        terms.push(term);
        if (terms.length >= limit)
            break;
    }
    return terms;
}
/** Build a safe FTS5 MATCH expression (quoted tokens, prefix-matched, OR-joined). */
export function buildMatchExpression(terms) {
    if (terms.length === 0)
        return null;
    return terms.map((term) => `"${term.replace(/"/g, '')}"*`).join(' OR ');
}
export function createKnowledgeRepository(db) {
    const insert = db.raw.prepare(`INSERT INTO knowledge_entries
       (guild_id, category, kind, status, visibility, title, content, priority, flagged,
        expires_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const repo = {
        create(entry) {
            const now = Date.now();
            const info = insert.run(entry.guildId, entry.category, entry.kind, entry.visibility ?? 'public', entry.title, entry.content, entry.priority ?? 0, entry.flagged ? 1 : 0, entry.expiresAt ?? null, entry.createdBy, now, now);
            return repo.get(entry.guildId, Number(info.lastInsertRowid));
        },
        get(guildId, id) {
            const row = db.raw
                .prepare('SELECT * FROM knowledge_entries WHERE guild_id = ? AND id = ?')
                .get(guildId, id);
            return row ? map(row) : undefined;
        },
        list(guildId, options = {}) {
            const clauses = ['guild_id = ?'];
            const params = [guildId];
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
                .prepare(`SELECT * FROM knowledge_entries WHERE ${clauses.join(' AND ')}
           ORDER BY priority DESC, updated_at DESC LIMIT ? OFFSET ?`)
                .all(...params);
            return rows.map(map);
        },
        count(guildId, options = {}) {
            const clauses = ['guild_id = ?'];
            const params = [guildId];
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
                .get(...params);
            return row.n;
        },
        countsByCategory(guildId) {
            const rows = db.raw
                .prepare(`SELECT category, COUNT(*) AS n FROM knowledge_entries
           WHERE guild_id = ? AND status = 'active' GROUP BY category ORDER BY n DESC`)
                .all(guildId);
            return rows.map((row) => ({ category: row.category, count: row.n }));
        },
        activeIncidents(guildId, now = Date.now()) {
            const rows = db.raw
                .prepare(`SELECT * FROM knowledge_entries
           WHERE guild_id = ? AND status = 'active' AND kind IN ('incident', 'temporary')
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY kind = 'incident' DESC, priority DESC, updated_at DESC LIMIT 12`)
                .all(guildId, now);
            return rows.map(map);
        },
        /** Relevance search: BM25 through FTS5 when available, keyword scoring otherwise. */
        search(guildId, query, limit = 6) {
            const terms = extractTerms(query);
            if (terms.length === 0)
                return [];
            if (db.ftsAvailable) {
                const match = buildMatchExpression(terms);
                if (match) {
                    try {
                        const rows = db.raw
                            .prepare(`SELECT e.* FROM knowledge_fts f
                 JOIN knowledge_entries e ON e.id = f.rowid
                 WHERE knowledge_fts MATCH ? AND e.guild_id = ? AND e.status = 'active'
                 ORDER BY bm25(knowledge_fts, 2.0, 1.0) ASC, e.priority DESC LIMIT ?`)
                            .all(match, guildId, limit);
                        if (rows.length > 0)
                            return rows.map(map);
                    }
                    catch {
                        /* fall through to LIKE scoring */
                    }
                }
            }
            const likeClauses = terms.map(() => '(content LIKE ? OR title LIKE ?)').join(' OR ');
            const params = [guildId];
            for (const term of terms)
                params.push(`%${term}%`, `%${term}%`);
            const rows = db.raw
                .prepare(`SELECT * FROM knowledge_entries
           WHERE guild_id = ? AND status = 'active' AND (${likeClauses})
           ORDER BY priority DESC, updated_at DESC LIMIT 40`)
                .all(...params);
            const scored = rows.map((row) => {
                const haystack = `${row.title} ${row.content}`.toLowerCase();
                const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
                return { row, score };
            });
            scored.sort((a, b) => b.score - a.score || b.row.priority - a.row.priority);
            return scored.slice(0, limit).map((item) => map(item.row));
        },
        setStatus(guildId, id, status, actorId) {
            return (db.raw
                .prepare(`UPDATE knowledge_entries SET status = ?, updated_by = ?, updated_at = ?
             WHERE guild_id = ? AND id = ?`)
                .run(status, actorId, Date.now(), guildId, id).changes > 0);
        },
        delete(guildId, id) {
            return db.raw.prepare('DELETE FROM knowledge_entries WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
        },
        /** Flip expired temporary knowledge to `expired`. Returns affected rows. */
        expireDue(now = Date.now()) {
            return db.raw
                .prepare(`UPDATE knowledge_entries SET status = 'expired', updated_at = ?
           WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`)
                .run(now, now).changes;
        },
    };
    return repo;
}
//# sourceMappingURL=knowledge.js.map