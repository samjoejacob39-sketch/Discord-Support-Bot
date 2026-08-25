import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3, { type Database as SqliteDatabase } from 'better-sqlite3';
import { child } from '../logging/logger.js';
import { migrations } from './migrations.js';

const log = child('db');

export interface Db {
  raw: SqliteDatabase;
  /** True when this SQLite build supports FTS5, enabling BM25 knowledge search. */
  ftsAvailable: boolean;
  close(): void;
}

function probeFts(raw: SqliteDatabase): boolean {
  try {
    raw.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x)");
    raw.exec('DROP TABLE IF EXISTS _fts_probe');
    return true;
  } catch {
    return false;
  }
}

function runMigrations(raw: SqliteDatabase, ftsAvailable: boolean): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0
  )`);

  const applied = new Set<number>(
    raw.prepare('SELECT id FROM _migrations').all().map((row) => (row as { id: number }).id),
  );
  const record = raw.prepare('INSERT INTO _migrations (id, name, applied_at, skipped) VALUES (?, ?, ?, ?)');

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    if (migration.requiresFts && !ftsAvailable) {
      log.warn({ migration: migration.name }, 'SQLite build lacks FTS5 — skipping migration, using fallback search');
      record.run(migration.id, migration.name, Date.now(), 1);
      continue;
    }

    const apply = raw.transaction(() => {
      raw.exec(migration.sql);
      record.run(migration.id, migration.name, Date.now(), 0);
    });
    apply();
    log.info({ migration: migration.name, id: migration.id }, 'migration applied');
  }
}

/** Open (or create) a database, apply pragmas and run pending migrations. */
export function createDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const raw = new BetterSqlite3(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');

  const ftsAvailable = probeFts(raw);
  runMigrations(raw, ftsAvailable);

  return {
    raw,
    ftsAvailable,
    close: () => raw.close(),
  };
}

let singleton: Db | undefined;

export function initDatabase(path: string): Db {
  singleton = createDatabase(path);
  log.info({ path, fts: singleton.ftsAvailable }, 'database ready');
  return singleton;
}

export function getDatabase(): Db {
  if (!singleton) throw new Error('Database not initialised — call initDatabase() during bootstrap.');
  return singleton;
}

export function closeDatabase(): void {
  singleton?.close();
  singleton = undefined;
}
