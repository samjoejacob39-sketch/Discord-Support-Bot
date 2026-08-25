function parseIds(json) {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    }
    catch {
        return [];
    }
}
const map = (row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    guildId: row.guild_id,
    trigger: row.trigger,
    reason: row.reason,
    summary: row.summary,
    recommendedAction: row.recommended_action,
    notifiedUserIds: parseIds(row.notified_user_ids),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
});
export function createEscalationRepository(db) {
    const insert = db.raw.prepare(`INSERT INTO escalations
       (ticket_id, guild_id, trigger, reason, summary, recommended_action, notified_user_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const repo = {
        create(input) {
            const now = Date.now();
            const info = insert.run(input.ticketId, input.guildId, input.trigger, input.reason.slice(0, 1000), input.summary ?? null, input.recommendedAction ?? null, JSON.stringify(input.notifiedUserIds), now);
            return repo.get(input.guildId, Number(info.lastInsertRowid));
        },
        get(guildId, id) {
            const row = db.raw.prepare('SELECT * FROM escalations WHERE guild_id = ? AND id = ?').get(guildId, id);
            return row ? map(row) : undefined;
        },
        latestOpenForTicket(guildId, ticketId) {
            const row = db.raw
                .prepare(`SELECT * FROM escalations WHERE guild_id = ? AND ticket_id = ? AND resolved_at IS NULL
           ORDER BY id DESC LIMIT 1`)
                .get(guildId, ticketId);
            return row ? map(row) : undefined;
        },
        resolveForTicket(guildId, ticketId, resolvedBy) {
            return db.raw
                .prepare(`UPDATE escalations SET resolved_at = ?, resolved_by = ?
           WHERE guild_id = ? AND ticket_id = ? AND resolved_at IS NULL`)
                .run(Date.now(), resolvedBy, guildId, ticketId).changes;
        },
        countOpen(guildId) {
            const row = db.raw
                .prepare('SELECT COUNT(*) AS n FROM escalations WHERE guild_id = ? AND resolved_at IS NULL')
                .get(guildId);
            return row.n;
        },
    };
    return repo;
}
//# sourceMappingURL=escalations.js.map