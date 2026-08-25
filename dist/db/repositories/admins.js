const map = (row) => ({
    guildId: row.guild_id,
    userId: row.user_id,
    addedBy: row.added_by,
    addedAt: row.added_at,
});
export function createAdminRepository(db) {
    const insert = db.raw.prepare(`INSERT INTO shin_admins (guild_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO NOTHING`);
    const remove = db.raw.prepare('DELETE FROM shin_admins WHERE guild_id = ? AND user_id = ?');
    const exists = db.raw.prepare('SELECT 1 FROM shin_admins WHERE guild_id = ? AND user_id = ?');
    const list = db.raw.prepare('SELECT * FROM shin_admins WHERE guild_id = ? ORDER BY added_at ASC');
    return {
        /** @returns true when the user was newly added, false when already an admin. */
        add(guildId, userId, addedBy) {
            return insert.run(guildId, userId, addedBy, Date.now()).changes > 0;
        },
        /** @returns true when a row was actually removed. */
        remove(guildId, userId) {
            return remove.run(guildId, userId).changes > 0;
        },
        isAdmin(guildId, userId) {
            return exists.get(guildId, userId) !== undefined;
        },
        list(guildId) {
            return list.all(guildId).map(map);
        },
        listIds(guildId) {
            return list.all(guildId).map((row) => row.user_id);
        },
        count(guildId) {
            const row = db.raw
                .prepare('SELECT COUNT(*) AS n FROM shin_admins WHERE guild_id = ?')
                .get(guildId);
            return row.n;
        },
    };
}
//# sourceMappingURL=admins.js.map