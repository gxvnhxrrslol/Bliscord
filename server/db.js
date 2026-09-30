import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_EVERYONE, P } from '../shared/permissions.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'bliscord.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  banner TEXT,
  banner_color TEXT,
  accent_color TEXT,
  bio TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'online',
  custom_status TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  banner TEXT,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  topic TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_server ON channels(server_id);

CREATE TABLE IF NOT EXISTS dms (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT,
  kind TEXT NOT NULL DEFAULT 'default',
  edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, id);

CREATE TABLE IF NOT EXISTS relationships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS read_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  last_read_id TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
`);

// Migrations for databases created by older versions.
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'badges', "TEXT NOT NULL DEFAULT '[]'");
addColumn('users', 'profile', "TEXT NOT NULL DEFAULT '{}'");
addColumn('servers', 'system_channel_id', 'TEXT');
addColumn('servers', 'rules_channel_id', 'TEXT');
addColumn('servers', 'join_messages', 'INTEGER NOT NULL DEFAULT 1');
addColumn('channels', 'parent_id', 'TEXT');
addColumn('channels', 'synced', 'INTEGER NOT NULL DEFAULT 1');
addColumn('channels', 'slowmode', 'INTEGER NOT NULL DEFAULT 0');
addColumn('channels', 'user_limit', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'mentions', "TEXT NOT NULL DEFAULT '{}'");
addColumn('messages', 'crosspost', 'TEXT');
addColumn('users', 'suspended_until', 'INTEGER');
addColumn('users', 'suspend_reason', "TEXT NOT NULL DEFAULT ''");

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  hoist INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 0,
  permissions INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS roles_server ON roles(server_id);

CREATE TABLE IF NOT EXISTS member_roles (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS overwrites (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  allow INTEGER NOT NULL DEFAULT 0,
  deny INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE IF NOT EXISTS bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  banned_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS favorite_gifs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, url)
);

CREATE TABLE IF NOT EXISTS warnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_follows (
  source_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id)
);
`);

// Every server gets an @everyone role (id = server id); old "admin" members get an Admin role.
{
  const servers = db.prepare('SELECT id FROM servers').all();
  for (const s of servers) {
    if (!db.prepare('SELECT 1 FROM roles WHERE id = ?').get(s.id)) {
      db.prepare("INSERT INTO roles (id, server_id, name, permissions, position, created_at) VALUES (?, ?, '@everyone', ?, 0, ?)")
        .run(s.id, s.id, DEFAULT_EVERYONE, Date.now());
    }
    // Servers from before categories existed get the same two categories new servers start with.
    const hasCategory = db.prepare("SELECT 1 FROM channels WHERE server_id = ? AND type = 'category'").get(s.id);
    if (!hasCategory) {
      const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at').all(s.id);
      const makeCategory = (name, pos) => {
        const id = `${s.id}-${name === 'Text Channels' ? 'textcat' : 'voicecat'}`;
        db.prepare("INSERT INTO channels (id, server_id, name, type, topic, position, created_at) VALUES (?, ?, ?, 'category', '', ?, ?)")
          .run(id, s.id, name, pos, Date.now());
        return id;
      };
      const textCat = makeCategory('Text Channels', 0);
      const voiceCat = makeCategory('Voice Channels', 1);
      channels.forEach((c, i) => {
        db.prepare('UPDATE channels SET parent_id = ?, position = ? WHERE id = ?').run(c.type === 'voice' ? voiceCat : textCat, i + 2, c.id);
      });
      const general = channels.find((c) => c.type === 'text');
      if (general) db.prepare('UPDATE servers SET system_channel_id = COALESCE(system_channel_id, ?) WHERE id = ?').run(general.id, s.id);
    }
    const admins = db.prepare("SELECT user_id FROM members WHERE server_id = ? AND role = 'admin'").all(s.id);
    if (admins.length) {
      let admin = db.prepare("SELECT id FROM roles WHERE server_id = ? AND name = 'Admin'").get(s.id);
      if (!admin) {
        const id = `${s.id}-admin`;
        db.prepare("INSERT INTO roles (id, server_id, name, color, hoist, permissions, position, created_at) VALUES (?, ?, 'Admin', '#4f7cff', 1, ?, 1, ?)")
          .run(id, s.id, P.ADMINISTRATOR, Date.now());
        admin = { id };
      }
      for (const a of admins) {
        db.prepare('INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)').run(s.id, a.user_id, admin.id);
      }
      db.prepare("UPDATE members SET role = 'member' WHERE server_id = ? AND role = 'admin'").run(s.id);
    }
  }
}

let seq = 0;
let lastMs = 0;
/** Sortable unique id: fixed-width base36 timestamp + sequence + random. */
export function newId() {
  const now = Date.now();
  if (now === lastMs) seq = (seq + 1) % 1296;
  else { seq = 0; lastMs = now; }
  return now.toString(36).padStart(9, '0') + seq.toString(36).padStart(2, '0') + crypto.randomBytes(3).toString('hex');
}

export function newInviteCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}

const cache = new Map();
/** Prepared statement cache. */
export function q(sql) {
  let stmt = cache.get(sql);
  if (!stmt) { stmt = db.prepare(sql); cache.set(sql, stmt); }
  return stmt;
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
