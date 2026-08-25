/**
 * Migrations are plain SQL strings kept in TypeScript so that a `tsc` build needs no
 * asset-copying step. They run in ascending `id` order exactly once, tracked in
 * `_migrations`. Never edit a shipped migration — add a new one.
 */
export interface Migration {
  id: number;
  name: string;
  /** Skipped (and recorded as skipped) when the SQLite build lacks FTS5. */
  requiresFts?: boolean;
  sql: string;
}

const init = /* sql */ `
CREATE TABLE guilds (
  guild_id   TEXT PRIMARY KEY,
  name       TEXT,
  joined_at  INTEGER NOT NULL,
  left_at    INTEGER
);

CREATE TABLE guild_settings (
  guild_id              TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  support_mode          TEXT    NOT NULL DEFAULT 'invoked',
  ai_enabled            INTEGER NOT NULL DEFAULT 1,
  trusted_role_id       TEXT,
  admin_ping_role_id    TEXT,
  support_channel_ids   TEXT    NOT NULL DEFAULT '[]',
  support_category_ids  TEXT    NOT NULL DEFAULT '[]',
  escalation_channel_id TEXT,
  persona_note          TEXT,
  max_ai_attempts       INTEGER NOT NULL DEFAULT 3,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE shin_admins (
  guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL,
  added_by  TEXT NOT NULL,
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE knowledge_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'general',
  kind        TEXT    NOT NULL DEFAULT 'permanent',
  status      TEXT    NOT NULL DEFAULT 'active',
  visibility  TEXT    NOT NULL DEFAULT 'public',
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,
  flagged     INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  created_by  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_by  TEXT,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_knowledge_guild_status ON knowledge_entries (guild_id, status);
CREATE INDEX idx_knowledge_guild_kind ON knowledge_entries (guild_id, kind, status);
CREATE INDEX idx_knowledge_expiry ON knowledge_entries (status, expires_at);

CREATE TABLE tickets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  channel_id       TEXT    NOT NULL,
  parent_id        TEXT,
  opener_user_id   TEXT    NOT NULL,
  subject          TEXT,
  state            TEXT    NOT NULL DEFAULT 'NEW',
  ai_attempts      INTEGER NOT NULL DEFAULT 0,
  escalation_count INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  closed_at        INTEGER
);
CREATE UNIQUE INDEX idx_tickets_open_channel
  ON tickets (guild_id, channel_id) WHERE state != 'CLOSED';
CREATE INDEX idx_tickets_guild_state ON tickets (guild_id, state);

CREATE TABLE ticket_messages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id          INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id           TEXT    NOT NULL,
  discord_message_id TEXT,
  author_id          TEXT    NOT NULL,
  author_kind        TEXT    NOT NULL,
  content            TEXT    NOT NULL,
  created_at         INTEGER NOT NULL
);
CREATE INDEX idx_ticket_messages_ticket ON ticket_messages (ticket_id, id);

CREATE TABLE ticket_summaries (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id          INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id           TEXT    NOT NULL,
  summary            TEXT    NOT NULL,
  through_message_id INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);
CREATE INDEX idx_ticket_summaries_ticket ON ticket_summaries (ticket_id, id);

CREATE TABLE ticket_facts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id   TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ticket_facts_ticket ON ticket_facts (ticket_id);

CREATE TABLE escalations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id           INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id            TEXT    NOT NULL,
  trigger             TEXT    NOT NULL,
  reason              TEXT    NOT NULL,
  summary             TEXT,
  recommended_action  TEXT,
  notified_user_ids   TEXT    NOT NULL DEFAULT '[]',
  created_at          INTEGER NOT NULL,
  resolved_at         INTEGER,
  resolved_by         TEXT
);
CREATE INDEX idx_escalations_guild ON escalations (guild_id, created_at);

CREATE TABLE ai_interactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  ticket_id     INTEGER,
  user_id       TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  confidence    TEXT,
  escalated     INTEGER NOT NULL DEFAULT 0,
  used_web      INTEGER NOT NULL DEFAULT 0,
  tool_calls    TEXT    NOT NULL DEFAULT '[]',
  input_tokens  INTEGER,
  output_tokens INTEGER,
  latency_ms    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ai_interactions_guild ON ai_interactions (guild_id, created_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  actor_id   TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  target     TEXT,
  metadata   TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_guild ON audit_log (guild_id, created_at);

CREATE TABLE response_cache (
  guild_id    TEXT    NOT NULL,
  prompt_hash TEXT    NOT NULL,
  response    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, prompt_hash)
);
`;

const fts = /* sql */ `
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title, content, content='knowledge_entries', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER knowledge_fts_ai AFTER INSERT ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts (rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER knowledge_fts_ad AFTER DELETE ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts (knowledge_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER knowledge_fts_au AFTER UPDATE ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts (knowledge_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO knowledge_fts (rowid, title, content) VALUES (new.id, new.title, new.content);
END;
`;

export const migrations: Migration[] = [
  { id: 1, name: 'init', sql: init },
  { id: 2, name: 'knowledge_fts', sql: fts, requiresFts: true },
];
