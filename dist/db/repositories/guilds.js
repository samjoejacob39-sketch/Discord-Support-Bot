import { DEFAULT_GUILD_SETTINGS } from '../../config/constants.js';
function parseIds(json) {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    }
    catch {
        return [];
    }
}
function mapSettings(row) {
    return {
        guildId: row.guild_id,
        supportMode: row.support_mode,
        aiEnabled: row.ai_enabled === 1,
        trustedRoleId: row.trusted_role_id,
        adminPingRoleId: row.admin_ping_role_id,
        supportChannelIds: parseIds(row.support_channel_ids),
        supportCategoryIds: parseIds(row.support_category_ids),
        escalationChannelId: row.escalation_channel_id,
        personaNote: row.persona_note,
        maxAiAttempts: row.max_ai_attempts,
        updatedAt: row.updated_at,
    };
}
export function createGuildRepository(db) {
    const upsertGuild = db.raw.prepare(`INSERT INTO guilds (guild_id, name, joined_at) VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name, left_at = NULL`);
    const insertSettings = db.raw.prepare(`INSERT INTO guild_settings (guild_id, support_mode, ai_enabled, max_ai_attempts, updated_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO NOTHING`);
    const selectSettings = db.raw.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
    const repo = {
        /** Idempotently register a guild and its default settings; returns the settings. */
        ensure(guildId, name) {
            const now = Date.now();
            const tx = db.raw.transaction(() => {
                upsertGuild.run(guildId, name ?? null, now);
                insertSettings.run(guildId, DEFAULT_GUILD_SETTINGS.supportMode, DEFAULT_GUILD_SETTINGS.aiEnabled ? 1 : 0, DEFAULT_GUILD_SETTINGS.maxAiAttempts, now);
            });
            tx();
            return mapSettings(selectSettings.get(guildId));
        },
        getSettings(guildId) {
            const row = selectSettings.get(guildId);
            return row ? mapSettings(row) : undefined;
        },
        /** Read settings, creating defaults when the guild has never been seen. */
        settingsOrDefault(guildId) {
            return repo.getSettings(guildId) ?? repo.ensure(guildId);
        },
        update(guildId, patch) {
            repo.settingsOrDefault(guildId);
            const columns = {};
            if (patch.supportMode !== undefined)
                columns.support_mode = patch.supportMode;
            if (patch.aiEnabled !== undefined)
                columns.ai_enabled = patch.aiEnabled ? 1 : 0;
            if (patch.trustedRoleId !== undefined)
                columns.trusted_role_id = patch.trustedRoleId;
            if (patch.adminPingRoleId !== undefined)
                columns.admin_ping_role_id = patch.adminPingRoleId;
            if (patch.supportChannelIds !== undefined)
                columns.support_channel_ids = JSON.stringify(patch.supportChannelIds);
            if (patch.supportCategoryIds !== undefined)
                columns.support_category_ids = JSON.stringify(patch.supportCategoryIds);
            if (patch.escalationChannelId !== undefined)
                columns.escalation_channel_id = patch.escalationChannelId;
            if (patch.personaNote !== undefined)
                columns.persona_note = patch.personaNote;
            if (patch.maxAiAttempts !== undefined)
                columns.max_ai_attempts = patch.maxAiAttempts;
            const keys = Object.keys(columns);
            if (keys.length > 0) {
                const assignments = keys.map((key) => `${key} = ?`).join(', ');
                db.raw
                    .prepare(`UPDATE guild_settings SET ${assignments}, updated_at = ? WHERE guild_id = ?`)
                    .run(...keys.map((key) => columns[key]), Date.now(), guildId);
            }
            return mapSettings(selectSettings.get(guildId));
        },
        reset(guildId) {
            db.raw.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
            return repo.ensure(guildId);
        },
        markLeft(guildId) {
            db.raw.prepare('UPDATE guilds SET left_at = ? WHERE guild_id = ?').run(Date.now(), guildId);
        },
        countActive() {
            const row = db.raw.prepare('SELECT COUNT(*) AS n FROM guilds WHERE left_at IS NULL').get();
            return row.n;
        },
    };
    return repo;
}
//# sourceMappingURL=guilds.js.map