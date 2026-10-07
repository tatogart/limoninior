import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'limoninior.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    google_sub  TEXT UNIQUE NOT NULL,
    email       TEXT NOT NULL,
    username    TEXT UNIQUE COLLATE NOCASE,
    name        TEXT NOT NULL DEFAULT '',
    bio         TEXT NOT NULL DEFAULT '',
    avatar      TEXT,
    google_pic  TEXT,
    banned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY,
    token_hash  TEXT UNIQUE NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    last_used   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    user_agent  TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    admin_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS chats (
    id          INTEGER PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('private', 'group', 'saved')),
    pair_key    TEXT UNIQUE,
    title       TEXT NOT NULL DEFAULT '',
    avatar      TEXT,
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    last_msg_id INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',
    joined_at    INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS members_user ON chat_members(user_id);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'system', 'sticker', 'gift')),
    text       TEXT NOT NULL DEFAULT '',
    file       TEXT,
    width      INTEGER,
    height     INTEGER,
    reply_to   INTEGER,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    extra      TEXT
  );
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);

  CREATE TABLE IF NOT EXISTS media (
    name       TEXT PRIMARY KEY,
    owner_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('avatar', 'message')),
    chat_id    INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY,
    at         INTEGER NOT NULL,
    user_id    INTEGER,
    ip         TEXT,
    action     TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---------- migrations for databases created by earlier versions ----------

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
function addColumn(table, name, ddl) {
  if (!columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

addColumn('users', 'password_hash', 'TEXT');
addColumn('users', 'verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'coins', 'INTEGER NOT NULL DEFAULT 100');
addColumn('users', 'last_bonus', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'extra', 'TEXT');

// Widen the messages.kind CHECK constraint (SQLite can't ALTER a CHECK, so rebuild).
const msgSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get()?.sql || '';
if (!msgSql.includes("'gift'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  db.exec(`
    CREATE TABLE messages_new (
      id         INTEGER PRIMARY KEY,
      chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'system', 'sticker', 'gift')),
      text       TEXT NOT NULL DEFAULT '',
      file       TEXT,
      width      INTEGER,
      height     INTEGER,
      reply_to   INTEGER,
      created_at INTEGER NOT NULL,
      edited_at  INTEGER,
      extra      TEXT
    );
    INSERT INTO messages_new (id, chat_id, sender_id, kind, text, file, width, height, reply_to, created_at, edited_at, extra)
      SELECT id, chat_id, sender_id, kind, text, file, width, height, reply_to, created_at, edited_at, extra FROM messages;
    DROP TABLE messages;
    ALTER TABLE messages_new RENAME TO messages;
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
  `);
  db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys = ON');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_gifts (
    id         INTEGER PRIMARY KEY,
    gift_id    TEXT NOT NULL,
    from_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note       TEXT NOT NULL DEFAULT '',
    price      INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_gifts_to ON user_gifts(to_id, id);
`);

const stmtCache = new Map();
/** Cached prepared statement. */
export function q(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();

export function audit(userId, ip, action, details = '') {
  q('INSERT INTO audit_log (at, user_id, ip, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(now(), userId ?? null, ip ?? null, action, typeof details === 'string' ? details : JSON.stringify(details));
}

export function kvGet(key) {
  return q('SELECT value FROM kv WHERE key = ?').get(key)?.value;
}
export function kvSet(key, value) {
  q('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
