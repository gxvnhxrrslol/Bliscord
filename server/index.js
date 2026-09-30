import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { q, tx, newId, newInviteCode, UPLOAD_DIR } from './db.js';
import { getIceServers, turnConfigured } from './ice.js';

const PORT = Number(process.env.PORT || 3000);
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(import.meta.dirname, '..', 'dist'));
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

class ApiError extends Error {}
const fail = (message) => { throw new ApiError(message); };
const now = () => Date.now();

/* ------------------------------------------------------------------ */
/* Presence                                                            */
/* ------------------------------------------------------------------ */

// userId -> Map(socketId -> { idle })
const online = new Map();

function presenceOf(row) {
  const conns = online.get(row.id);
  if (!conns || conns.size === 0 || row.status === 'invisible') return 'offline';
  if (row.status === 'online' && [...conns.values()].every((c) => c.idle)) return 'idle';
  return row.status;
}

/* ------------------------------------------------------------------ */
/* Serializers                                                         */
/* ------------------------------------------------------------------ */

const getUserRow = (id) => q('SELECT * FROM users WHERE id = ?').get(id);

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    banner: row.banner,
    bannerColor: row.banner_color,
    accentColor: row.accent_color,
    bio: row.bio,
    pronouns: row.pronouns,
    customStatus: row.custom_status,
    badges: JSON.parse(row.badges || '[]'),
    createdAt: row.created_at,
    presence: presenceOf(row),
  };
}

function selfUser(row) {
  return { ...publicUser(row), email: row.email, status: row.status };
}

function serializeServer(s) {
  return {
    id: s.id,
    name: s.name,
    icon: s.icon,
    banner: s.banner,
    description: s.description,
    ownerId: s.owner_id,
    inviteCode: s.invite_code,
    createdAt: s.created_at,
  };
}

function lastMessageId(channelId) {
  return q('SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1').get(channelId)?.id || null;
}

function serializeChannel(c) {
  return {
    id: c.id,
    serverId: c.server_id,
    name: c.name,
    type: c.type,
    topic: c.topic,
    position: c.position,
    lastMessageId: c.type === 'text' ? lastMessageId(c.id) : null,
  };
}

function serializeMember(m) {
  return { userId: m.user_id, nickname: m.nickname, role: m.role, joinedAt: m.joined_at };
}

function serializeServerFull(s) {
  return {
    ...serializeServer(s),
    channels: q('SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at').all(s.id).map(serializeChannel),
    members: q('SELECT * FROM members WHERE server_id = ? ORDER BY joined_at').all(s.id).map(serializeMember),
  };
}

function serializeDm(dm, forUser) {
  return {
    id: dm.id,
    recipientId: dm.user_a === forUser ? dm.user_b : dm.user_a,
    createdAt: dm.created_at,
    lastMessageAt: dm.last_message_at,
    lastMessageId: lastMessageId(dm.id),
  };
}

function serializeMessage(m) {
  let replyTo = null;
  if (m.reply_to) {
    const r = q('SELECT id, author_id, content, attachments FROM messages WHERE id = ?').get(m.reply_to);
    replyTo = r
      ? { id: r.id, authorId: r.author_id, content: r.content.slice(0, 300), hasAttachments: JSON.parse(r.attachments).length > 0 }
      : { id: m.reply_to, deleted: true };
  }
  return {
    id: m.id,
    channelId: m.channel_id,
    authorId: m.author_id,
    content: m.content,
    attachments: JSON.parse(m.attachments),
    replyTo,
    kind: m.kind,
    editedAt: m.edited_at,
    createdAt: m.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

function relatedUserIds(uid) {
  const rows = q(`
    SELECT m2.user_id AS id FROM members m1 JOIN members m2 ON m1.server_id = m2.server_id WHERE m1.user_id = ?
    UNION SELECT target_id FROM relationships WHERE user_id = ?
    UNION SELECT user_id FROM relationships WHERE target_id = ?
    UNION SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END FROM dms WHERE user_a = ? OR user_b = ?
  `).all(uid, uid, uid, uid, uid, uid);
  const ids = new Set(rows.map((r) => r.id));
  ids.delete(uid);
  return [...ids];
}

function relationship(a, b) {
  return q('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?').get(a, b)?.type || null;
}

function isBlockedEitherWay(a, b) {
  return relationship(a, b) === 'blocked' || relationship(b, a) === 'blocked';
}

function memberRole(serverId, uid) {
  return q('SELECT role FROM members WHERE server_id = ? AND user_id = ?').get(serverId, uid)?.role || null;
}

function requireManager(serverId, uid) {
  const role = memberRole(serverId, uid);
  if (role !== 'owner' && role !== 'admin') fail('You do not have permission to do that');
  return role;
}

function channelAccess(uid, channelId) {
  const channel = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
  if (channel) {
    const role = memberRole(channel.server_id, uid);
    if (!role) fail('You do not have access to this channel');
    return { kind: 'channel', channel, role };
  }
  const dm = q('SELECT * FROM dms WHERE id = ?').get(String(channelId || ''));
  if (dm && (dm.user_a === uid || dm.user_b === uid)) {
    return { kind: 'dm', dm, otherId: dm.user_a === uid ? dm.user_b : dm.user_a };
  }
  fail('Channel not found');
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function str(v, max, { trim = true } = {}) {
  if (v === undefined || v === null) return '';
  let s = String(v);
  if (trim) s = s.trim();
  return s.slice(0, max);
}

function uploadPath(v) {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\/uploads\/[A-Za-z0-9_.-]+$/.test(v)) fail('Invalid file');
  return v;
}

function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((a) => ({
    url: uploadPath(a?.url),
    name: str(a?.name, 200) || 'file',
    size: Math.max(0, Number(a?.size) || 0),
    type: str(a?.type, 100),
    width: Number(a?.width) || undefined,
    height: Number(a?.height) || undefined,
  })).filter((a) => a.url);
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const t = now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < t) { attempts.set(key, { count: 1, reset: t + windowMs }); return; }
  entry.count += 1;
  if (entry.count > max) fail('Too many attempts, try again in a few minutes');
}
setInterval(() => { const t = now(); for (const [k, v] of attempts) if (v.reset < t) attempts.delete(k); }, 60_000).unref();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now());
  return token;
}

function authFromHeader(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const row = token && q('SELECT user_id FROM sessions WHERE token = ?').get(token);
  return row ? row.user_id : null;
}

const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (!(err instanceof ApiError)) console.error(err);
    res.status(err instanceof ApiError ? 400 : 500).json({ error: err instanceof ApiError ? err.message : 'Server error' });
  }
};

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Bliscord', turn: turnConfigured() }));

app.post('/api/auth/register', route(async (req) => {
  rateLimit('reg:' + req.ip, 10, 60 * 60 * 1000);
  const username = str(req.body.username, 32).toLowerCase();
  const displayName = str(req.body.displayName, 32) || username;
  const email = str(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || '');
  if (!USERNAME_RE.test(username)) fail('Usernames are 2-32 characters: letters, numbers, _ and .');
  if (!EMAIL_RE.test(email)) fail('Enter a valid email address');
  if (password.length < 8) fail('Password must be at least 8 characters');
  if (q('SELECT 1 FROM users WHERE username = ?').get(username)) fail('That username is taken');
  if (q('SELECT 1 FROM users WHERE email = ?').get(email)) fail('That email is already registered');
  const hash = await bcrypt.hash(password, 10);
  const id = newId();
  const palette = ['#4f7cff', '#6a5cff', '#2bb3ff', '#1fc7a8', '#ff6b8a', '#ffa34f'];
  q(`INSERT INTO users (id, username, display_name, email, password_hash, banner_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, username, displayName, email, hash, palette[crypto.randomInt(palette.length)], now());
  return { token: createSession(id) };
}));

app.post('/api/auth/login', route(async (req) => {
  rateLimit('login:' + req.ip, 25, 10 * 60 * 1000);
  const login = str(req.body.login, 254).toLowerCase();
  const user = q('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login);
  const ok = user && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
  if (!ok) fail('Incorrect login or password');
  return { token: createSession(user.id) };
}));

app.post('/api/auth/logout', route(async (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) q('DELETE FROM sessions WHERE token = ?').run(header.slice(7));
  return { ok: true };
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
      cb(null, newId() + crypto.randomBytes(4).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD, files: 1 },
});

app.post('/api/upload', (req, res, next) => {
  const uid = authFromHeader(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  try { rateLimit('up:' + uid, 60, 60 * 1000); } catch (e) { return res.status(429).json({ error: e.message }); }
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Files can be up to ${MAX_UPLOAD / 1024 / 1024} MB` : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({
      url: '/uploads/' + req.file.filename,
      name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200),
      size: req.file.size,
      type: req.file.mimetype,
    });
  });
});

const INLINE = /\.(png|jpe?g|gif|webp|avif|bmp|mp4|webm|mov|mp3|wav|ogg|m4a|flac)$/i;
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '30d',
  immutable: true,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!INLINE.test(filePath)) res.setHeader('Content-Disposition', 'attachment');
  },
}));

if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIR));
}

const server = http.createServer(app);

/* ------------------------------------------------------------------ */
/* Realtime                                                            */
/* ------------------------------------------------------------------ */

const io = new Server(server, {
  cors: { origin: true },
  maxHttpBufferSize: 2e6,
  pingInterval: 15000,
  pingTimeout: 20000,
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const row = token && q('SELECT user_id FROM sessions WHERE token = ?').get(String(token));
  if (!row) return next(new Error('unauthorized'));
  socket.data.userId = row.user_id;
  socket.data.token = String(token);
  next();
});

function toUsers(ids, event, payload) {
  if (!ids.length) return;
  io.to(ids.map((id) => 'user:' + id)).emit(event, payload);
}

function broadcastUser(uid) {
  const row = getUserRow(uid);
  if (!row) return;
  toUsers(relatedUserIds(uid), 'user:update', publicUser(row));
  io.to('user:' + uid).emit('self:update', selfUser(row));
}

function emitToChannel(access, event, payload) {
  if (access.kind === 'channel') io.to('server:' + access.channel.server_id).emit(event, payload);
  else toUsers([access.dm.user_a, access.dm.user_b], event, payload);
}

/* ---------------- Voice rooms ---------------- */

// roomId -> Map(userId -> state)
const voiceRooms = new Map();
// socketId -> roomId
const voiceBySocket = new Map();

function publicVoiceState(s) {
  const { socketId, ...rest } = s;
  return rest;
}

function roomTarget(roomId) {
  const channel = q('SELECT server_id FROM channels WHERE id = ?').get(roomId);
  if (channel) return io.to('server:' + channel.server_id);
  const dm = q('SELECT user_a, user_b FROM dms WHERE id = ?').get(roomId);
  if (dm) return io.to(['user:' + dm.user_a, 'user:' + dm.user_b]);
  return null;
}

function emitVoice(roomId) {
  const states = [...(voiceRooms.get(roomId)?.values() || [])].map(publicVoiceState);
  roomTarget(roomId)?.emit('voice:update', { roomId, states });
}

function leaveVoice(socket, { notify = true } = {}) {
  const roomId = voiceBySocket.get(socket.id);
  if (!roomId) return;
  voiceBySocket.delete(socket.id);
  const room = voiceRooms.get(roomId);
  if (room) {
    const state = room.get(socket.data.userId);
    if (state && state.socketId === socket.id) room.delete(socket.data.userId);
    if (room.size === 0) voiceRooms.delete(roomId);
  }
  if (notify) emitVoice(roomId);
  const dm = q('SELECT * FROM dms WHERE id = ?').get(roomId);
  if (dm && !voiceRooms.has(roomId)) toUsers([dm.user_a, dm.user_b], 'call:end', { roomId });
}

function kickRoom(roomId) {
  const room = voiceRooms.get(roomId);
  if (!room) return;
  for (const s of room.values()) {
    const sock = io.sockets.sockets.get(s.socketId);
    if (sock) { leaveVoice(sock, { notify: false }); sock.emit('voice:kicked', { roomId }); }
  }
  voiceRooms.delete(roomId);
  emitVoice(roomId);
}

function kickUserFromServerVoice(uid, serverId) {
  for (const [roomId, room] of voiceRooms) {
    const s = room.get(uid);
    if (!s) continue;
    const ch = q('SELECT server_id FROM channels WHERE id = ?').get(roomId);
    if (ch?.server_id !== serverId) continue;
    const sock = io.sockets.sockets.get(s.socketId);
    if (sock) { leaveVoice(sock); sock.emit('voice:kicked', { roomId }); }
  }
}

function voiceStatesFor(roomIds) {
  const out = {};
  for (const id of roomIds) {
    const room = voiceRooms.get(id);
    if (room) out[id] = [...room.values()].map(publicVoiceState);
  }
  return out;
}

/* ---------------- Ready payload ---------------- */

function buildReady(uid) {
  const me = getUserRow(uid);
  const servers = q(`SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY m.joined_at`)
    .all(uid).map(serializeServerFull);
  const dms = q('SELECT * FROM dms WHERE user_a = ? OR user_b = ?').all(uid, uid).map((d) => serializeDm(d, uid));
  const relationships = q('SELECT target_id, type FROM relationships WHERE user_id = ?').all(uid)
    .map((r) => ({ id: r.target_id, type: r.type }));
  const users = relatedUserIds(uid).map((id) => publicUser(getUserRow(id))).filter(Boolean);
  const readStates = Object.fromEntries(
    q('SELECT channel_id, last_read_id FROM read_states WHERE user_id = ?').all(uid).map((r) => [r.channel_id, r.last_read_id]),
  );
  const unreadDm = {};
  for (const dm of dms) {
    const last = readStates[dm.id] || '';
    unreadDm[dm.id] = q('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND id > ? AND author_id != ?').get(dm.id, last, uid).n;
  }
  const roomIds = [...servers.flatMap((s) => s.channels.filter((c) => c.type === 'voice').map((c) => c.id)), ...dms.map((d) => d.id)];
  return { user: selfUser(me), servers, dms, relationships, users, readStates, unreadDm, voice: voiceStatesFor(roomIds) };
}

/* ---------------- Connection ---------------- */

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  if (!getUserRow(uid)) { socket.disconnect(true); return; }

  socket.join('user:' + uid);
  for (const { server_id } of q('SELECT server_id FROM members WHERE user_id = ?').all(uid)) socket.join('server:' + server_id);

  const wasOnline = (online.get(uid)?.size || 0) > 0;
  if (!online.has(uid)) online.set(uid, new Map());
  online.get(uid).set(socket.id, { idle: false });
  socket.emit('ready', buildReady(uid));
  if (!wasOnline) broadcastUser(uid);

  const bucket = { tokens: 10, at: now() };
  function spend() {
    const t = now();
    bucket.tokens = Math.min(10, bucket.tokens + (t - bucket.at) / 500);
    bucket.at = t;
    if (bucket.tokens < 1) fail('You are sending messages too quickly');
    bucket.tokens -= 1;
  }

  function on(event, handler) {
    socket.on(event, async (payload, ack) => {
      if (typeof payload === 'function') { ack = payload; payload = {}; }
      try {
        const data = await handler(payload && typeof payload === 'object' ? payload : {});
        if (typeof ack === 'function') ack({ ok: true, data });
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(`[${event}]`, err);
        if (typeof ack === 'function') ack({ ok: false, error: err instanceof ApiError ? err.message : 'Something went wrong' });
      }
    });
  }

  on('ping', () => ({ t: now() }));

  on('presence:idle', ({ idle }) => {
    const conns = online.get(uid);
    if (!conns?.has(socket.id)) return;
    const before = presenceOf(getUserRow(uid));
    conns.get(socket.id).idle = Boolean(idle);
    if (presenceOf(getUserRow(uid)) !== before) broadcastUser(uid);
  });

  /* ---------- Profile & account ---------- */

  on('user:update', (p) => {
    const row = getUserRow(uid);
    const next = {
      display_name: 'displayName' in p ? (str(p.displayName, 32) || row.username) : row.display_name,
      avatar: 'avatar' in p ? uploadPath(p.avatar) : row.avatar,
      banner: 'banner' in p ? uploadPath(p.banner) : row.banner,
      banner_color: 'bannerColor' in p ? (COLOR_RE.test(p.bannerColor || '') ? p.bannerColor : null) : row.banner_color,
      accent_color: 'accentColor' in p ? (COLOR_RE.test(p.accentColor || '') ? p.accentColor : null) : row.accent_color,
      bio: 'bio' in p ? str(p.bio, 300, { trim: false }).trim() : row.bio,
      pronouns: 'pronouns' in p ? str(p.pronouns, 40) : row.pronouns,
      custom_status: 'customStatus' in p ? str(p.customStatus, 128) : row.custom_status,
      status: 'status' in p ? (['online', 'idle', 'dnd', 'invisible'].includes(p.status) ? p.status : row.status) : row.status,
    };
    q(`UPDATE users SET display_name = ?, avatar = ?, banner = ?, banner_color = ?, accent_color = ?, bio = ?, pronouns = ?,
       custom_status = ?, status = ? WHERE id = ?`).run(
      next.display_name, next.avatar, next.banner, next.banner_color, next.accent_color, next.bio, next.pronouns,
      next.custom_status, next.status, uid,
    );
    broadcastUser(uid);
    return selfUser(getUserRow(uid));
  });

  on('account:update', async (p) => {
    const row = getUserRow(uid);
    if (!(await bcrypt.compare(String(p.currentPassword || ''), row.password_hash))) fail('Your current password is incorrect');
    let { username, email, password_hash: hash } = row;
    if (p.username !== undefined) {
      username = str(p.username, 32).toLowerCase();
      if (!USERNAME_RE.test(username)) fail('Usernames are 2-32 characters: letters, numbers, _ and .');
      const taken = q('SELECT id FROM users WHERE username = ?').get(username);
      if (taken && taken.id !== uid) fail('That username is taken');
    }
    if (p.email !== undefined) {
      email = str(p.email, 254).toLowerCase();
      if (!EMAIL_RE.test(email)) fail('Enter a valid email address');
      const taken = q('SELECT id FROM users WHERE email = ?').get(email);
      if (taken && taken.id !== uid) fail('That email is already registered');
    }
    if (p.newPassword) {
      if (String(p.newPassword).length < 8) fail('Password must be at least 8 characters');
      hash = await bcrypt.hash(String(p.newPassword), 10);
      q('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(uid, socket.data.token);
    }
    q('UPDATE users SET username = ?, email = ?, password_hash = ? WHERE id = ?').run(username, email, hash, uid);
    broadcastUser(uid);
    return selfUser(getUserRow(uid));
  });

  on('user:fetch', ({ userId }) => {
    const row = getUserRow(String(userId || ''));
    if (!row) fail('User not found');
    const mutualServers = q(`SELECT m1.server_id AS id FROM members m1 JOIN members m2 ON m1.server_id = m2.server_id
      WHERE m1.user_id = ? AND m2.user_id = ?`).all(uid, row.id).map((r) => r.id);
    const mutualFriends = q(`SELECT a.target_id AS id FROM relationships a JOIN relationships b ON a.target_id = b.target_id
      WHERE a.user_id = ? AND b.user_id = ? AND a.type = 'friend' AND b.type = 'friend'`).all(uid, row.id).map((r) => r.id);
    return { user: publicUser(row), mutualServers, mutualFriends };
  });

  /* ---------- Servers ---------- */

  function joinServerRooms(userId, serverId) {
    io.in('user:' + userId).socketsJoin('server:' + serverId);
  }

  function sendServerTo(userId, serverId) {
    const s = q('SELECT * FROM servers WHERE id = ?').get(serverId);
    const full = serializeServerFull(s);
    const users = full.members.map((m) => publicUser(getUserRow(m.userId)));
    const voice = voiceStatesFor(full.channels.filter((c) => c.type === 'voice').map((c) => c.id));
    io.to('user:' + userId).emit('server:create', { server: full, users, voice });
    return full;
  }

  function addChannel(serverId, name, type) {
    const pos = q('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE server_id = ?').get(serverId).p;
    const id = newId();
    q('INSERT INTO channels (id, server_id, name, type, topic, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, serverId, name, type, '', pos, now());
    return q('SELECT * FROM channels WHERE id = ?').get(id);
  }

  function normalizeChannelName(name, type) {
    let n = str(name, 100);
    if (type === 'text') n = n.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').replace(/-+/g, '-');
    if (!n) fail('Channel name is required');
    return n;
  }

  on('server:create', ({ name, icon }) => {
    const serverName = str(name, 100);
    if (!serverName) fail('Give your server a name');
    const owned = q('SELECT COUNT(*) AS n FROM members WHERE user_id = ?').get(uid).n;
    if (owned >= 100) fail('You are in too many servers');
    const id = newId();
    tx(() => {
      q('INSERT INTO servers (id, name, icon, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, serverName, uploadPath(icon ?? null), uid, newInviteCode(), now());
      q('INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, uid, 'owner', now());
      addChannel(id, 'general', 'text');
      addChannel(id, 'Lounge', 'voice');
    });
    joinServerRooms(uid, id);
    return sendServerTo(uid, id);
  });

  on('server:update', (p) => {
    const s = q('SELECT * FROM servers WHERE id = ?').get(String(p.serverId || ''));
    if (!s) fail('Server not found');
    requireManager(s.id, uid);
    const name = 'name' in p ? str(p.name, 100) : s.name;
    if (!name) fail('Server name is required');
    q('UPDATE servers SET name = ?, icon = ?, banner = ?, description = ? WHERE id = ?').run(
      name,
      'icon' in p ? uploadPath(p.icon) : s.icon,
      'banner' in p ? uploadPath(p.banner) : s.banner,
      'description' in p ? str(p.description, 300) : s.description,
      s.id,
    );
    const out = serializeServer(q('SELECT * FROM servers WHERE id = ?').get(s.id));
    io.to('server:' + s.id).emit('server:update', out);
    return out;
  });

  on('server:invite_reset', ({ serverId }) => {
    requireManager(String(serverId || ''), uid);
    q('UPDATE servers SET invite_code = ? WHERE id = ?').run(newInviteCode(), serverId);
    const out = serializeServer(q('SELECT * FROM servers WHERE id = ?').get(serverId));
    io.to('server:' + serverId).emit('server:update', out);
    return out;
  });

  on('server:delete', ({ serverId }) => {
    const s = q('SELECT * FROM servers WHERE id = ?').get(String(serverId || ''));
    if (!s) fail('Server not found');
    if (s.owner_id !== uid) fail('Only the owner can delete this server');
    for (const c of q("SELECT id FROM channels WHERE server_id = ? AND type = 'voice'").all(s.id)) kickRoom(c.id);
    tx(() => {
      q('DELETE FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?)').run(s.id);
      q('DELETE FROM servers WHERE id = ?').run(s.id);
    });
    io.to('server:' + s.id).emit('server:remove', { serverId: s.id });
    io.in('server:' + s.id).socketsLeave('server:' + s.id);
    return true;
  });

  function extractCode(input) {
    const raw = str(input, 200);
    const m = raw.match(/([A-Za-z0-9]{6,16})\/?$/);
    return m ? m[1] : raw;
  }

  on('server:preview', ({ code }) => {
    const s = q('SELECT * FROM servers WHERE invite_code = ?').get(extractCode(code));
    if (!s) fail('That invite is invalid or has expired');
    const memberIds = q('SELECT user_id FROM members WHERE server_id = ?').all(s.id).map((r) => r.user_id);
    const onlineCount = memberIds.filter((id) => presenceOf(getUserRow(id)) !== 'offline').length;
    return { ...serializeServer(s), inviteCode: undefined, memberCount: memberIds.length, onlineCount, joined: memberIds.includes(uid) };
  });

  on('server:join', ({ code }) => {
    const s = q('SELECT * FROM servers WHERE invite_code = ?').get(extractCode(code));
    if (!s) fail('That invite is invalid or has expired');
    if (memberRole(s.id, uid)) return serializeServerFull(s);
    q('INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(s.id, uid, 'member', now());
    const general = q("SELECT * FROM channels WHERE server_id = ? AND type = 'text' ORDER BY position LIMIT 1").get(s.id);
    joinServerRooms(uid, s.id);
    io.to('server:' + s.id).except('user:' + uid).emit('server:member_add', {
      serverId: s.id,
      member: serializeMember(q('SELECT * FROM members WHERE server_id = ? AND user_id = ?').get(s.id, uid)),
      user: publicUser(getUserRow(uid)),
    });
    if (general) {
      const id = newId();
      q("INSERT INTO messages (id, channel_id, author_id, content, kind, created_at) VALUES (?, ?, ?, '', 'join', ?)").run(id, general.id, uid, now());
      io.to('server:' + s.id).emit('message:new', serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)));
    }
    return sendServerTo(uid, s.id);
  });

  function removeMember(serverId, userId) {
    kickUserFromServerVoice(userId, serverId);
    q('DELETE FROM members WHERE server_id = ? AND user_id = ?').run(serverId, userId);
    io.to('user:' + userId).emit('server:remove', { serverId });
    io.in('user:' + userId).socketsLeave('server:' + serverId);
    io.to('server:' + serverId).emit('server:member_remove', { serverId, userId });
  }

  on('server:leave', ({ serverId }) => {
    const role = memberRole(String(serverId || ''), uid);
    if (!role) fail('You are not in this server');
    if (role === 'owner') fail('Transfer or delete the server before leaving');
    removeMember(serverId, uid);
    return true;
  });

  on('server:kick', ({ serverId, userId }) => {
    const myRole = requireManager(String(serverId || ''), uid);
    const theirRole = memberRole(serverId, String(userId || ''));
    if (!theirRole) fail('That user is not in this server');
    if (theirRole === 'owner' || (theirRole === 'admin' && myRole !== 'owner')) fail('You cannot kick that member');
    removeMember(serverId, userId);
    return true;
  });

  on('member:role', ({ serverId, userId, role }) => {
    const s = q('SELECT * FROM servers WHERE id = ?').get(String(serverId || ''));
    if (!s || s.owner_id !== uid) fail('Only the owner can change roles');
    if (userId === uid) fail('You cannot change your own role');
    if (!['admin', 'member'].includes(role)) fail('Invalid role');
    if (!memberRole(s.id, userId)) fail('That user is not in this server');
    q('UPDATE members SET role = ? WHERE server_id = ? AND user_id = ?').run(role, s.id, userId);
    const member = serializeMember(q('SELECT * FROM members WHERE server_id = ? AND user_id = ?').get(s.id, userId));
    io.to('server:' + s.id).emit('server:member_update', { serverId: s.id, member });
    return member;
  });

  on('member:nickname', ({ serverId, nickname }) => {
    if (!memberRole(String(serverId || ''), uid)) fail('You are not in this server');
    q('UPDATE members SET nickname = ? WHERE server_id = ? AND user_id = ?').run(str(nickname, 32) || null, serverId, uid);
    const member = serializeMember(q('SELECT * FROM members WHERE server_id = ? AND user_id = ?').get(serverId, uid));
    io.to('server:' + serverId).emit('server:member_update', { serverId, member });
    return member;
  });

  on('server:transfer', ({ serverId, userId }) => {
    const s = q('SELECT * FROM servers WHERE id = ?').get(String(serverId || ''));
    if (!s || s.owner_id !== uid) fail('Only the owner can transfer the server');
    if (!memberRole(s.id, String(userId || '')) || userId === uid) fail('Pick another member');
    tx(() => {
      q('UPDATE servers SET owner_id = ? WHERE id = ?').run(userId, s.id);
      q("UPDATE members SET role = 'owner' WHERE server_id = ? AND user_id = ?").run(s.id, userId);
      q("UPDATE members SET role = 'admin' WHERE server_id = ? AND user_id = ?").run(s.id, uid);
    });
    io.to('server:' + s.id).emit('server:update', serializeServer(q('SELECT * FROM servers WHERE id = ?').get(s.id)));
    for (const id of [userId, uid]) {
      io.to('server:' + s.id).emit('server:member_update', {
        serverId: s.id, member: serializeMember(q('SELECT * FROM members WHERE server_id = ? AND user_id = ?').get(s.id, id)),
      });
    }
    return true;
  });

  /* ---------- Channels ---------- */

  on('channel:create', ({ serverId, name, type }) => {
    requireManager(String(serverId || ''), uid);
    const t = type === 'voice' ? 'voice' : 'text';
    const count = q('SELECT COUNT(*) AS n FROM channels WHERE server_id = ?').get(serverId).n;
    if (count >= 200) fail('This server has too many channels');
    const ch = serializeChannel(addChannel(serverId, normalizeChannelName(name, t), t));
    io.to('server:' + serverId).emit('channel:create', ch);
    return ch;
  });

  on('channel:update', ({ channelId, name, topic }) => {
    const ch = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
    if (!ch) fail('Channel not found');
    requireManager(ch.server_id, uid);
    q('UPDATE channels SET name = ?, topic = ? WHERE id = ?').run(
      name !== undefined ? normalizeChannelName(name, ch.type) : ch.name,
      topic !== undefined ? str(topic, 1024) : ch.topic,
      ch.id,
    );
    const out = serializeChannel(q('SELECT * FROM channels WHERE id = ?').get(ch.id));
    io.to('server:' + ch.server_id).emit('channel:update', out);
    return out;
  });

  on('channel:reorder', ({ serverId, order }) => {
    requireManager(String(serverId || ''), uid);
    if (!Array.isArray(order)) fail('Invalid order');
    tx(() => order.forEach((id, i) => q('UPDATE channels SET position = ? WHERE id = ? AND server_id = ?').run(i, String(id), serverId)));
    const channels = q('SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at').all(serverId).map(serializeChannel);
    io.to('server:' + serverId).emit('channel:reorder', { serverId, channels });
    return true;
  });

  on('channel:delete', ({ channelId }) => {
    const ch = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
    if (!ch) fail('Channel not found');
    requireManager(ch.server_id, uid);
    if (ch.type === 'text' && q("SELECT COUNT(*) AS n FROM channels WHERE server_id = ? AND type = 'text'").get(ch.server_id).n <= 1) {
      fail('A server needs at least one text channel');
    }
    if (ch.type === 'voice') kickRoom(ch.id);
    tx(() => {
      q('DELETE FROM messages WHERE channel_id = ?').run(ch.id);
      q('DELETE FROM read_states WHERE channel_id = ?').run(ch.id);
      q('DELETE FROM channels WHERE id = ?').run(ch.id);
    });
    io.to('server:' + ch.server_id).emit('channel:delete', { id: ch.id, serverId: ch.server_id });
    return true;
  });

  /* ---------- Messages ---------- */

  on('messages:fetch', ({ channelId, before, limit }) => {
    channelAccess(uid, channelId);
    const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const rows = before
      ? q('SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(channelId, String(before), n)
      : q('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(channelId, n);
    return rows.reverse().map(serializeMessage);
  });

  on('message:send', ({ channelId, content, attachments, replyTo, nonce }) => {
    spend();
    const access = channelAccess(uid, channelId);
    if (access.kind === 'channel' && access.channel.type !== 'text') fail('You cannot send messages here');
    if (access.kind === 'dm' && isBlockedEitherWay(uid, access.otherId)) fail('You cannot message this user');
    const text = str(content, 4000, { trim: false }).replace(/^\s+|\s+$/g, '');
    const files = sanitizeAttachments(attachments);
    if (!text && !files.length) fail('Message is empty');
    let reply = null;
    if (replyTo) {
      const r = q('SELECT id FROM messages WHERE id = ? AND channel_id = ?').get(String(replyTo), channelId);
      reply = r ? r.id : null;
    }
    const id = newId();
    const t = now();
    tx(() => {
      q('INSERT INTO messages (id, channel_id, author_id, content, attachments, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, channelId, uid, text, JSON.stringify(files), reply, t);
      if (access.kind === 'dm') q('UPDATE dms SET last_message_at = ? WHERE id = ?').run(t, channelId);
      q(`INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(uid, channelId, id);
    });
    const msg = { ...serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)), nonce: str(nonce, 64) || undefined };
    emitToChannel(access, 'message:new', msg);
    return msg;
  });

  on('message:edit', ({ messageId, content }) => {
    const m = q('SELECT * FROM messages WHERE id = ?').get(String(messageId || ''));
    if (!m || m.author_id !== uid || m.kind !== 'default') fail('You cannot edit this message');
    const access = channelAccess(uid, m.channel_id);
    const text = str(content, 4000, { trim: false }).replace(/^\s+|\s+$/g, '');
    if (!text && JSON.parse(m.attachments).length === 0) fail('Message is empty');
    q('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(text, now(), m.id);
    const msg = serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(m.id));
    emitToChannel(access, 'message:update', msg);
    return msg;
  });

  on('message:delete', ({ messageId }) => {
    const m = q('SELECT * FROM messages WHERE id = ?').get(String(messageId || ''));
    if (!m) fail('Message not found');
    const access = channelAccess(uid, m.channel_id);
    const canModerate = access.kind === 'channel' && (access.role === 'owner' || access.role === 'admin');
    if (m.author_id !== uid && !canModerate) fail('You cannot delete this message');
    q('DELETE FROM messages WHERE id = ?').run(m.id);
    emitToChannel(access, 'message:delete', { id: m.id, channelId: m.channel_id });
    return true;
  });

  on('typing', ({ channelId }) => {
    const access = channelAccess(uid, channelId);
    const payload = { channelId, userId: uid };
    if (access.kind === 'channel') socket.to('server:' + access.channel.server_id).emit('typing', payload);
    else io.to('user:' + access.otherId).emit('typing', payload);
    return true;
  });

  on('read', ({ channelId, messageId }) => {
    channelAccess(uid, channelId);
    const id = str(messageId, 64);
    if (!id) return true;
    q(`INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(uid, channelId, id);
    io.to('user:' + uid).emit('read', { channelId, messageId: id });
    return true;
  });

  /* ---------- Relationships & DMs ---------- */

  function emitRelationship(a, b) {
    const type = relationship(a, b);
    if (type) io.to('user:' + a).emit('relationship:update', { id: b, type, user: publicUser(getUserRow(b)) });
    else io.to('user:' + a).emit('relationship:remove', { id: b });
  }

  function setRel(a, b, type) {
    if (type) {
      q(`INSERT INTO relationships (user_id, target_id, type, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, target_id) DO UPDATE SET type = excluded.type`).run(a, b, type, now());
    } else {
      q('DELETE FROM relationships WHERE user_id = ? AND target_id = ?').run(a, b);
    }
  }

  on('friend:request', ({ username, userId }) => {
    const target = userId
      ? getUserRow(String(userId))
      : q('SELECT * FROM users WHERE username = ?').get(str(username, 32).toLowerCase().replace(/^@/, ''));
    if (!target) fail('No user found with that username');
    if (target.id === uid) fail('You cannot add yourself');
    const mine = relationship(uid, target.id);
    const theirs = relationship(target.id, uid);
    if (mine === 'friend') fail('You are already friends');
    if (mine === 'outgoing') fail('Friend request already sent');
    if (mine === 'blocked') fail('Unblock this user first');
    if (theirs === 'blocked') fail('No user found with that username');
    if (mine === 'incoming') {
      setRel(uid, target.id, 'friend');
      setRel(target.id, uid, 'friend');
    } else {
      setRel(uid, target.id, 'outgoing');
      setRel(target.id, uid, 'incoming');
    }
    emitRelationship(uid, target.id);
    emitRelationship(target.id, uid);
    return { id: target.id, type: relationship(uid, target.id) };
  });

  on('friend:accept', ({ userId }) => {
    if (relationship(uid, String(userId || '')) !== 'incoming') fail('No pending request from this user');
    setRel(uid, userId, 'friend');
    setRel(userId, uid, 'friend');
    emitRelationship(uid, userId);
    emitRelationship(userId, uid);
    return true;
  });

  on('friend:remove', ({ userId }) => {
    const id = String(userId || '');
    const mine = relationship(uid, id);
    if (mine && mine !== 'blocked') setRel(uid, id, null);
    const theirs = relationship(id, uid);
    if (theirs && theirs !== 'blocked') setRel(id, uid, null);
    emitRelationship(uid, id);
    emitRelationship(id, uid);
    return true;
  });

  on('user:block', ({ userId }) => {
    const id = String(userId || '');
    if (!getUserRow(id) || id === uid) fail('User not found');
    setRel(uid, id, 'blocked');
    if (relationship(id, uid) !== 'blocked') setRel(id, uid, null);
    emitRelationship(uid, id);
    emitRelationship(id, uid);
    return true;
  });

  on('user:unblock', ({ userId }) => {
    const id = String(userId || '');
    if (relationship(uid, id) === 'blocked') setRel(uid, id, null);
    emitRelationship(uid, id);
    return true;
  });

  on('dm:open', ({ userId }) => {
    const target = getUserRow(String(userId || ''));
    if (!target || target.id === uid) fail('User not found');
    const [a, b] = [uid, target.id].sort();
    let dm = q('SELECT * FROM dms WHERE user_a = ? AND user_b = ?').get(a, b);
    if (!dm) {
      if (isBlockedEitherWay(uid, target.id)) fail('You cannot message this user');
      q('INSERT INTO dms (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)').run(newId(), a, b, now());
      dm = q('SELECT * FROM dms WHERE user_a = ? AND user_b = ?').get(a, b);
      io.to('user:' + target.id).emit('dm:create', { dm: serializeDm(dm, target.id), user: publicUser(getUserRow(uid)) });
    }
    io.to('user:' + uid).emit('dm:create', { dm: serializeDm(dm, uid), user: publicUser(target) });
    return serializeDm(dm, uid);
  });

  /* ---------- Voice & calls ---------- */

  on('voice:join', async ({ roomId }) => {
    const access = channelAccess(uid, roomId);
    if (access.kind === 'channel' && access.channel.type !== 'voice') fail('This is not a voice channel');
    if (access.kind === 'dm' && isBlockedEitherWay(uid, access.otherId)) fail('You cannot call this user');

    leaveVoice(socket);
    for (const [otherRoom, room] of voiceRooms) {
      const existing = room.get(uid);
      if (existing && existing.socketId !== socket.id) {
        const other = io.sockets.sockets.get(existing.socketId);
        if (other) { leaveVoice(other); other.emit('voice:kicked', { roomId: otherRoom, reason: 'moved' }); }
        else { room.delete(uid); emitVoice(otherRoom); }
      }
    }

    const wasEmpty = !voiceRooms.get(roomId)?.size;
    if (!voiceRooms.has(roomId)) voiceRooms.set(roomId, new Map());
    const room = voiceRooms.get(roomId);
    const participants = [...room.values()].map(publicVoiceState);
    room.set(uid, {
      userId: uid, socketId: socket.id, muted: false, deafened: false, video: false, screen: false,
      cameraStreamId: null, screenStreamId: null, joinedAt: now(),
    });
    voiceBySocket.set(socket.id, roomId);
    emitVoice(roomId);

    if (access.kind === 'dm' && !room.has(access.otherId)) {
      io.to('user:' + access.otherId).emit('call:ring', { roomId, callerId: uid });
      if (wasEmpty) {
        const id = newId();
        q("INSERT INTO messages (id, channel_id, author_id, content, kind, created_at) VALUES (?, ?, ?, '', 'call', ?)").run(id, roomId, uid, now());
        q('UPDATE dms SET last_message_at = ? WHERE id = ?').run(now(), roomId);
        emitToChannel(access, 'message:new', serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)));
      }
    }
    return { roomId, participants, iceServers: await getIceServers(uid) };
  });

  on('voice:leave', () => { leaveVoice(socket); return true; });

  on('voice:state', (p) => {
    const roomId = voiceBySocket.get(socket.id);
    const state = roomId && voiceRooms.get(roomId)?.get(uid);
    if (!state || state.socketId !== socket.id) fail('Not in a voice channel');
    for (const key of ['muted', 'deafened', 'video', 'screen']) if (key in p) state[key] = Boolean(p[key]);
    for (const key of ['cameraStreamId', 'screenStreamId']) if (key in p) state[key] = p[key] ? str(p[key], 100) : null;
    emitVoice(roomId);
    return true;
  });

  on('rtc:signal', ({ to, data }) => {
    const roomId = voiceBySocket.get(socket.id);
    const target = roomId && voiceRooms.get(roomId)?.get(String(to || ''));
    if (!target) return false;
    io.to(target.socketId).emit('rtc:signal', { from: uid, roomId, data });
    return true;
  });

  on('call:decline', ({ roomId }) => {
    const access = channelAccess(uid, roomId);
    if (access.kind !== 'dm') fail('Not a call');
    toUsers([uid, access.otherId], 'call:declined', { roomId, userId: uid });
    return true;
  });

  on('auth:logout', () => {
    q('DELETE FROM sessions WHERE token = ?').run(socket.data.token);
    setTimeout(() => socket.disconnect(true), 50);
    return true;
  });

  socket.on('disconnect', () => {
    leaveVoice(socket);
    const conns = online.get(uid);
    conns?.delete(socket.id);
    if (!conns || conns.size === 0) {
      online.delete(uid);
      broadcastUser(uid);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bliscord server listening on http://localhost:${PORT}`);
  if (!turnConfigured()) console.log('[ice] No TURN relay configured. Calls use STUN only (see README to enable TURN).');
});
