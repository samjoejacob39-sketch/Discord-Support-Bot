const map = (row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    parentId: row.parent_id,
    openerUserId: row.opener_user_id,
    subject: row.subject,
    state: row.state,
    aiAttempts: row.ai_attempts,
    escalationCount: row.escalation_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    closedAt: row.closed_at,
});
export function createTicketRepository(db) {
    const selectOpen = db.raw.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND state != 'CLOSED'
     ORDER BY id DESC LIMIT 1`);
    const insert = db.raw.prepare(`INSERT INTO tickets
       (guild_id, channel_id, parent_id, opener_user_id, subject, state, created_at, updated_at, last_activity_at)
     VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`);
    const repo = {
        findOpenByChannel(guildId, channelId) {
            const row = selectOpen.get(guildId, channelId);
            return row ? map(row) : undefined;
        },
        getById(guildId, id) {
            const row = db.raw.prepare('SELECT * FROM tickets WHERE guild_id = ? AND id = ?').get(guildId, id);
            return row ? map(row) : undefined;
        },
        create(input) {
            const now = Date.now();
            const info = insert.run(input.guildId, input.channelId, input.parentId ?? null, input.openerUserId, input.subject ?? null, now, now, now);
            return repo.getById(input.guildId, Number(info.lastInsertRowid));
        },
        /** Find the live ticket for a channel or open a new one. */
        ensureOpen(input) {
            return repo.findOpenByChannel(input.guildId, input.channelId) ?? repo.create(input);
        },
        setState(guildId, id, state) {
            const now = Date.now();
            const closedAt = state === 'CLOSED' ? now : null;
            db.raw
                .prepare(`UPDATE tickets SET state = ?, updated_at = ?, last_activity_at = ?,
             closed_at = CASE WHEN ? IS NULL THEN closed_at ELSE ? END
           WHERE guild_id = ? AND id = ?`)
                .run(state, now, now, closedAt, closedAt, guildId, id);
            return repo.getById(guildId, id);
        },
        setSubject(guildId, id, subject) {
            db.raw
                .prepare('UPDATE tickets SET subject = ?, updated_at = ? WHERE guild_id = ? AND id = ? AND subject IS NULL')
                .run(subject.slice(0, 200), Date.now(), guildId, id);
        },
        touch(guildId, id) {
            db.raw
                .prepare('UPDATE tickets SET last_activity_at = ?, updated_at = ? WHERE guild_id = ? AND id = ?')
                .run(Date.now(), Date.now(), guildId, id);
        },
        incrementAttempts(guildId, id) {
            db.raw
                .prepare('UPDATE tickets SET ai_attempts = ai_attempts + 1, updated_at = ? WHERE guild_id = ? AND id = ?')
                .run(Date.now(), guildId, id);
            return repo.getById(guildId, id)?.aiAttempts ?? 0;
        },
        resetAttempts(guildId, id) {
            db.raw
                .prepare('UPDATE tickets SET ai_attempts = 0, updated_at = ? WHERE guild_id = ? AND id = ?')
                .run(Date.now(), guildId, id);
        },
        incrementEscalations(guildId, id) {
            db.raw
                .prepare('UPDATE tickets SET escalation_count = escalation_count + 1, updated_at = ? WHERE guild_id = ? AND id = ?')
                .run(Date.now(), guildId, id);
        },
        listByState(guildId, state, limit = 25) {
            const rows = db.raw
                .prepare('SELECT * FROM tickets WHERE guild_id = ? AND state = ? ORDER BY last_activity_at DESC LIMIT ?')
                .all(guildId, state, limit);
            return rows.map(map);
        },
        countByState(guildId) {
            const rows = db.raw
                .prepare('SELECT state, COUNT(*) AS n FROM tickets WHERE guild_id = ? GROUP BY state')
                .all(guildId);
            return Object.fromEntries(rows.map((row) => [row.state, row.n]));
        },
        countOpenGlobal() {
            const row = db.raw
                .prepare("SELECT COUNT(*) AS n FROM tickets WHERE state NOT IN ('CLOSED', 'RESOLVED')")
                .get();
            return row.n;
        },
        countHandledGlobal() {
            const row = db.raw.prepare('SELECT COUNT(*) AS n FROM tickets').get();
            return row.n;
        },
    };
    return repo;
}
//# sourceMappingURL=tickets.js.map