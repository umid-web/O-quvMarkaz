import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';
import { databasePath } from './config.js';

// SQLite also creates WAL/SHM files: protect them from the moment of creation.
// Windows deployments must use service-account NTFS permissions instead.
if (process.platform !== 'win32') process.umask(0o077);
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(databasePath);
if (process.platform !== 'win32') chmodSync(databasePath, 0o600);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role_id TEXT NOT NULL DEFAULT 'admin',
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS normalized_collections (
    collection_key TEXT PRIMARY KEY, normalized_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collection_records (
    collection_key TEXT NOT NULL, record_id TEXT NOT NULL, position INTEGER NOT NULL,
    value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
    PRIMARY KEY (collection_key, record_id)
  );
  CREATE INDEX IF NOT EXISTS collection_records_order ON collection_records(collection_key, position);
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT NOT NULL,
    module TEXT NOT NULL, action TEXT NOT NULL, title TEXT NOT NULL, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS audit_time ON audit_events(at DESC);
  CREATE TABLE IF NOT EXISTS chat_call_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL, call_id TEXT NOT NULL, from_actor TEXT NOT NULL,
    to_actor TEXT, type TEXT NOT NULL, payload TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_call_signals_poll ON chat_call_signals(channel, id, expires_at);
  CREATE TABLE IF NOT EXISTS chat_call_participants (
    call_id TEXT NOT NULL, channel TEXT NOT NULL, actor TEXT NOT NULL, is_initiator INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
    PRIMARY KEY (call_id, channel, actor)
  );
  CREATE INDEX IF NOT EXISTS chat_call_participants_expiry ON chat_call_participants(expires_at);
  CREATE TABLE IF NOT EXISTS chat_presence (
    actor TEXT NOT NULL, tab_id TEXT NOT NULL, last_seen INTEGER NOT NULL,
    PRIMARY KEY (actor, tab_id)
  );
  CREATE INDEX IF NOT EXISTS chat_presence_seen ON chat_presence(last_seen);
  CREATE TABLE IF NOT EXISTS chat_last_seen (
    actor TEXT PRIMARY KEY, last_seen INTEGER NOT NULL
  );
  INSERT INTO chat_last_seen (actor, last_seen)
    SELECT actor, MAX(last_seen) FROM chat_presence GROUP BY actor
    ON CONFLICT(actor) DO UPDATE SET last_seen = MAX(chat_last_seen.last_seen, excluded.last_seen);
`);
