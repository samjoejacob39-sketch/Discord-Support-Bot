import type { Db } from '../client.js';
import type { ShinAdmin } from '../types.js';

interface AdminRow {
  guild_id: string;
  user_id: string;
  added_by: string;
  added_at: number;
}

const map = (row: AdminRow): ShinAdmin => ({
  guildId: row.guild_id,
  userId: row.user_id,
  addedBy: row.added_by,
  addedAt: row.added_at,
});

export function createAdminRepository(db: Db) {
  const insert = db.raw.prepare(
    `INSERT INTO shin_admins (guild_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO NOTHING`,
  );
  const remove = db.raw.prepare('DELETE FROM shin_admins WHERE guild_id = ? AND user_id = ?');
  const exists = db.raw.prepare('SELECT 1 FROM shin_admins WHERE guild_id = ? AND user_id = ?');
  const list = db.raw.prepare('SELECT * FROM shin_admins WHERE guild_id = ? ORDER BY added_at ASC');

  return {
    /** @returns true when the user was newly added, false when already an admin. */
    add(guildId: string, userId: string, addedBy: string): boolean {
      return insert.run(guildId, userId, addedBy, Date.now()).changes > 0;
    },

    /** @returns true when a row was actually removed. */
    remove(guildId: string, userId: string): boolean {
      return remove.run(guildId, userId).changes > 0;
    },

    isAdmin(guildId: string, userId: string): boolean {
      return exists.get(guildId, userId) !== undefined;
    },

    list(guildId: string): ShinAdmin[] {
      return (list.all(guildId) as AdminRow[]).map(map);
    },

    listIds(guildId: string): string[] {
      return (list.all(guildId) as AdminRow[]).map((row) => row.user_id);
    },

    count(guildId: string): number {
      const row = db.raw
        .prepare('SELECT COUNT(*) AS n FROM shin_admins WHERE guild_id = ?')
        .get(guildId) as { n: number };
      return row.n;
    },
  };
}

export type AdminRepository = ReturnType<typeof createAdminRepository>;
