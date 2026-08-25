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
};
function parseMetadata(json) {
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
export function createAuditRepository(db) {
    const insert = db.raw.prepare('INSERT INTO audit_log (guild_id, actor_id, action, target, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    return {
        record(guildId, actorId, action, target, metadata = {}) {
            insert.run(guildId, actorId, action, target ?? null, JSON.stringify(metadata), Date.now());
        },
        list(guildId, limit = 20, offset = 0) {
            const rows = db.raw
                .prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
                .all(guildId, limit, offset);
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
        count(guildId) {
            const row = db.raw.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE guild_id = ?').get(guildId);
            return row.n;
        },
    };
}
//# sourceMappingURL=audit.js.map