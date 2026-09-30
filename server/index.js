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
import { GifError, gifCategories, klipyKey, searchGifs, trendingGifs } from './gifs.js';
import {
  ALL, CHANNEL_SCOPED, DEFAULT_EVERYONE, P, computePermissions, has, topPosition,
} from '../shared/permissions.js';

const PORT = Number(process.env.PORT || 3000);
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(import.meta.dirname, '..', 'dist'));
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

class ApiError extends Error {}
const fail = (message) => { throw new ApiError(message); };
const now = () => Date.now();
const NO_PERMISSION = 'You do not have permission to do that';

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
/* Users                                                               */
/* ------------------------------------------------------------------ */

const getUserRow = (id) => q('SELECT * FROM users WHERE id = ?').get(id);

const DECORATIONS = ['glow', 'orbit', 'rainbow', 'neon', 'sparkle', 'flame', 'frost', 'crown'];
const EFFECTS = ['stars', 'aurora', 'snow', 'bubbles', 'confetti'];
const NAME_STYLES = ['gradient', 'glow', 'shimmer', 'rainbow'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function parseJson(text, fallback) {
  try { return JSON.parse(text || ''); } catch { return fallback; }
}

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
    badges: parseJson(row.badges, []),
    profile: parseJson(row.profile, {}),
    createdAt: row.created_at,
    presence: presenceOf(row),
  };
}

function selfUser(row) {
  return { ...publicUser(row), email: row.email, status: row.status };
}

function sanitizeProfile(p) {
  if (!p || typeof p !== 'object') return {};
  const out = {};
  if (Array.isArray(p.themeColors) && p.themeColors.length === 2 && p.themeColors.every((c) => COLOR_RE.test(c))) out.themeColors = p.themeColors;
  if (DECORATIONS.includes(p.decoration)) out.decoration = p.decoration;
  if (EFFECTS.includes(p.effect)) out.effect = p.effect;
  if (NAME_STYLES.includes(p.nameStyle)) out.nameStyle = p.nameStyle;
  return out;
}

/* ------------------------------------------------------------------ */
/* Server context & permissions                                        */
/* ------------------------------------------------------------------ */

/** Loads everything needed to answer permission questions for one server. */
function serverCtx(serverId) {
  const row = q('SELECT * FROM servers WHERE id = ?').get(String(serverId || ''));
  if (!row) return null;
  const roles = q('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC').all(row.id);
  const memberRoles = new Map();
  for (const r of q('SELECT user_id, role_id FROM member_roles WHERE server_id = ?').all(row.id)) {
    if (!memberRoles.has(r.user_id)) memberRoles.set(r.user_id, []);
    memberRoles.get(r.user_id).push(r.role_id);
  }
  const channels = new Map(q('SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at').all(row.id).map((c) => [c.id, c]));
  const overwrites = new Map();
  for (const o of q('SELECT o.* FROM overwrites o JOIN channels c ON c.id = o.channel_id WHERE c.server_id = ?').all(row.id)) {
    if (!overwrites.has(o.channel_id)) overwrites.set(o.channel_id, []);
    overwrites.get(o.channel_id).push({ id: o.target_id, type: o.type, allow: o.allow, deny: o.deny });
  }
  const memberIds = q('SELECT user_id FROM members WHERE server_id = ?').all(row.id).map((m) => m.user_id);
  const perm = {
    ownerId: row.owner_id,
    everyoneId: row.id,
    roles: roles.map((r) => ({ id: r.id, permissions: r.permissions, position: r.position })),
    memberRoles: (uid) => memberRoles.get(uid) || [],
    channel: (id) => {
      const c = channels.get(id);
      return c ? { parentId: c.parent_id, synced: Boolean(c.synced), overwrites: overwrites.get(id) || [] } : null;
    },
  };
  return { row, roles, memberRoles, channels, overwrites, memberIds, perm };
}

const permsOf = (ctx, uid, channelId = null) => computePermissions(ctx.perm, uid, channelId);
const isMember = (ctx, uid) => ctx.memberIds.includes(uid);

function requireCtx(serverId, uid) {
  const ctx = serverCtx(serverId);
  if (!ctx || !isMember(ctx, uid)) fail('Server not found');
  return ctx;
}

function requirePerm(ctx, uid, flag, channelId = null) {
  if (!has(permsOf(ctx, uid, channelId), flag)) fail(NO_PERMISSION);
}

function canView(ctx, uid, channel) {
  if (channel.type !== 'category') return has(permsOf(ctx, uid, channel.id), P.VIEW_CHANNEL);
  if (has(permsOf(ctx, uid, channel.id), P.VIEW_CHANNEL)) return true;
  for (const c of ctx.channels.values()) if (c.parent_id === channel.id && has(permsOf(ctx, uid, c.id), P.VIEW_CHANNEL)) return true;
  return false;
}

function channelViewers(ctx, channelId) {
  return ctx.memberIds.filter((uid) => has(permsOf(ctx, uid, channelId), P.VIEW_CHANNEL));
}

/* ------------------------------------------------------------------ */
/* Serializers                                                         */
/* ------------------------------------------------------------------ */

function serializeServer(s, { includeInvite = true } = {}) {
  return {
    id: s.id,
    name: s.name,
    icon: s.icon,
    banner: s.banner,
    description: s.description,
    ownerId: s.owner_id,
    inviteCode: includeInvite ? s.invite_code : null,
    systemChannelId: s.system_channel_id,
    rulesChannelId: s.rules_channel_id,
    joinMessages: Boolean(s.join_messages),
    createdAt: s.created_at,
  };
}

function lastMessageId(channelId) {
  return q('SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1').get(channelId)?.id || null;
}

const isTextType = (type) => type === 'text' || type === 'announcement';

function serializeChannel(c, ctx) {
  return {
    id: c.id,
    serverId: c.server_id,
    name: c.name,
    type: c.type,
    topic: c.topic,
    position: c.position,
    parentId: c.parent_id,
    synced: Boolean(c.synced),
    slowmode: c.slowmode,
    userLimit: c.user_limit,
    overwrites: ctx.overwrites.get(c.id) || [],
    lastMessageId: isTextType(c.type) ? lastMessageId(c.id) : null,
  };
}

function serializeRole(r) {
  return {
    id: r.id,
    serverId: r.server_id,
    name: r.name,
    color: r.color,
    hoist: Boolean(r.hoist),
    mentionable: Boolean(r.mentionable),
    permissions: r.permissions,
    position: r.position,
  };
}

function serializeMember(m, ctx) {
  return { userId: m.user_id, nickname: m.nickname, joinedAt: m.joined_at, roles: ctx.memberRoles.get(m.user_id) || [] };
}

/** Everything one member is allowed to see about a server. */
function serverPayloadFor(ctx, uid) {
  const channels = [...ctx.channels.values()].filter((c) => canView(ctx, uid, c)).map((c) => serializeChannel(c, ctx));
  return {
    ...serializeServer(ctx.row, { includeInvite: has(permsOf(ctx, uid), P.CREATE_INVITE) }),
    channels,
    roles: ctx.roles.map(serializeRole),
    members: q('SELECT * FROM members WHERE server_id = ? ORDER BY joined_at').all(ctx.row.id).map((m) => serializeMember(m, ctx)),
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
    mentions: parseJson(m.mentions, {}),
    replyTo,
    kind: m.kind,
    crosspost: m.crosspost ? parseJson(m.crosspost, null) : undefined,
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

/**
 * Resolves a channel or DM id and checks access.
 * For server channels `need` is the permission required (VIEW_CHANNEL by default).
 */
function channelAccess(uid, channelId, need = P.VIEW_CHANNEL) {
  const channel = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
  if (channel) {
    const ctx = serverCtx(channel.server_id);
    if (!ctx || !isMember(ctx, uid)) fail('You do not have access to this channel');
    const perms = permsOf(ctx, uid, channel.id);
    if (!has(perms, P.VIEW_CHANNEL)) fail('You do not have access to this channel');
    if (need && !has(perms, need)) fail(NO_PERMISSION);
    return { kind: 'channel', channel, ctx, perms };
  }
  const dm = q('SELECT * FROM dms WHERE id = ?').get(String(channelId || ''));
  if (dm && (dm.user_a === uid || dm.user_b === uid)) {
    return { kind: 'dm', dm, otherId: dm.user_a === uid ? dm.user_b : dm.user_a, perms: ALL };
  }
  fail('Channel not found');
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which @everyone / @role mentions in a message actually ping. */
function computeMentions(access, uid, text) {
  if (access.kind !== 'channel' || !text.includes('@')) return {};
  const canAll = has(access.perms, P.MENTION_EVERYONE);
  const out = {};
  if (canAll && /(^|[^\w])@(everyone|here)(?![\w])/i.test(text)) out.everyone = true;
  const roles = access.ctx.roles.filter((r) => r.id !== access.ctx.row.id && (r.mentionable || canAll)
    && new RegExp(`(^|[^\\w])@${escapeRe(r.name)}(?![\\w])`, 'i').test(text)).map((r) => r.id);
  if (roles.length) out.roles = roles;
  return out;
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

app.post('/api/upload', (req, res) => {
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

const gifRoute = (fn) => async (req, res) => {
  const uid = authFromHeader(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  try {
    rateLimit('gif:' + uid, 90, 60 * 1000);
    res.json(await fn(uid, req));
  } catch (err) {
    if (!(err instanceof GifError) && !(err instanceof ApiError)) console.error('GIF error', err.message);
    res.status(err instanceof GifError ? 503 : err instanceof ApiError ? 429 : 500).json({ error: err instanceof GifError || err instanceof ApiError ? err.message : 'GIF search is unavailable' });
  }
};
app.get('/api/gifs/status', gifRoute(() => ({ enabled: Boolean(klipyKey()) })));
app.get('/api/gifs/categories', gifRoute((uid) => gifCategories(uid)));
app.get('/api/gifs/trending', gifRoute((uid, req) => trendingGifs(uid, req.query.page)));
app.get('/api/gifs/search', gifRoute((uid, req) => searchGifs(uid, req.query.q, req.query.page)));

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
  if (access.kind === 'channel') toUsers(channelViewers(access.ctx, access.channel.id), event, payload);
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

/** Who should see the participant list of a voice room. */
function roomAudience(roomId) {
  const channel = q('SELECT server_id FROM channels WHERE id = ?').get(roomId);
  if (channel) {
    const ctx = serverCtx(channel.server_id);
    return ctx ? channelViewers(ctx, roomId) : [];
  }
  const dm = q('SELECT user_a, user_b FROM dms WHERE id = ?').get(roomId);
  return dm ? [dm.user_a, dm.user_b] : [];
}

function emitVoice(roomId) {
  const states = [...(voiceRooms.get(roomId)?.values() || [])].map(publicVoiceState);
  toUsers(roomAudience(roomId), 'voice:update', { roomId, states });
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

function disconnectFromVoice(state, roomId) {
  const sock = io.sockets.sockets.get(state.socketId);
  if (sock) {
    leaveVoice(sock);
    sock.emit('voice:kicked', { roomId });
  } else {
    voiceRooms.get(roomId)?.delete(state.userId);
    emitVoice(roomId);
  }
}

function kickRoom(roomId) {
  const room = voiceRooms.get(roomId);
  if (!room) return;
  for (const s of [...room.values()]) disconnectFromVoice(s, roomId);
  voiceRooms.delete(roomId);
}

/** After permissions change, remove anyone who can no longer be in a server's voice channels. */
function enforceVoice(ctx) {
  for (const [roomId, room] of voiceRooms) {
    if (!ctx.channels.has(roomId)) continue;
    for (const s of [...room.values()]) {
      const perms = permsOf(ctx, s.userId, roomId);
      if (!has(perms, P.CONNECT)) disconnectFromVoice(s, roomId);
    }
  }
}

function kickUserFromServerVoice(uid, serverId) {
  for (const [roomId, room] of voiceRooms) {
    const s = room.get(uid);
    if (!s) continue;
    const ch = q('SELECT server_id FROM channels WHERE id = ?').get(roomId);
    if (ch?.server_id === serverId) disconnectFromVoice(s, roomId);
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

/* ---------------- Server sync ---------------- */

function serverPacket(ctx, uid) {
  const server = serverPayloadFor(ctx, uid);
  const users = server.members.map((m) => publicUser(getUserRow(m.userId))).filter(Boolean);
  const voice = voiceStatesFor(server.channels.filter((c) => c.type === 'voice').map((c) => c.id));
  return { server, users, voice };
}

/** Sends every member (or just `onlyUser`) their current view of a server. */
function syncServer(serverId, onlyUser = null) {
  const ctx = serverCtx(serverId);
  if (!ctx) return;
  for (const uid of onlyUser ? [onlyUser] : ctx.memberIds) {
    if (!online.has(uid)) continue;
    io.to('user:' + uid).emit('server:sync', serverPacket(ctx, uid));
  }
  enforceVoice(ctx);
}

/* ---------------- Favorite GIFs ---------------- */

const GIF_URL_RE = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/\S+$/i;

function favoriteGifs(uid) {
  return q('SELECT data FROM favorite_gifs WHERE user_id = ? ORDER BY created_at DESC').all(uid).map((r) => parseJson(r.data, null)).filter(Boolean);
}

/** A favorite is either a KLIPY link or a GIF uploaded to this server. */
const isUploadPath = (v) => typeof v === 'string' && /^\/uploads\/[A-Za-z0-9_.-]+$/.test(v);

function sanitizeGif(g) {
  const upload = isUploadPath(g?.url) ? g.url : null;
  const url = upload || (GIF_URL_RE.test(String(g?.url || '')) ? String(g.url).slice(0, 500) : '');
  if (!url) fail('That GIF cannot be saved');
  const preview = (isUploadPath(g?.preview) ? g.preview : null) || (GIF_URL_RE.test(String(g?.preview || '')) ? String(g.preview).slice(0, 500) : url);
  return {
    url,
    preview,
    width: Math.max(0, Math.min(4096, Number(g?.width) || 0)),
    height: Math.max(0, Math.min(4096, Number(g?.height) || 0)),
    upload: Boolean(upload),
    name: upload ? (str(g?.name, 200) || 'image.gif') : undefined,
    size: upload ? Math.max(0, Number(g?.size) || 0) : undefined,
  };
}

/* ---------------- Announcement follows ---------------- */

const MAX_FOLLOWS_PER_CHANNEL = 10;

function sourceInfo(channel) {
  const server = q('SELECT id, name, icon FROM servers WHERE id = ?').get(channel.server_id);
  return { serverId: server.id, serverName: server.name, serverIcon: server.icon, channelId: channel.id, channelName: channel.name };
}

/** Copies a new announcement into every channel that follows it. */
function crosspost(access, uid, messageId, text, files) {
  const targets = q('SELECT target_id FROM channel_follows WHERE source_id = ?').all(access.channel.id);
  if (!targets.length) return;
  const info = JSON.stringify({ ...sourceInfo(access.channel), messageId });
  for (const { target_id: targetId } of targets) {
    const target = q('SELECT * FROM channels WHERE id = ?').get(targetId);
    const tctx = target && serverCtx(target.server_id);
    if (!tctx) continue;
    const id = newId();
    q("INSERT INTO messages (id, channel_id, author_id, content, attachments, mentions, crosspost, created_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)")
      .run(id, targetId, uid, text, JSON.stringify(files), info, now());
    toUsers(channelViewers(tctx, targetId), 'message:new', serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)));
  }
}

function followsFor(channelId) {
  return q('SELECT f.source_id, f.created_at FROM channel_follows f WHERE f.target_id = ? ORDER BY f.created_at').all(channelId)
    .map((f) => {
      const ch = q('SELECT * FROM channels WHERE id = ?').get(f.source_id);
      return ch ? { ...sourceInfo(ch), createdAt: f.created_at } : null;
    })
    .filter(Boolean);
}

/* ---------------- Ready payload ---------------- */

function buildReady(uid) {
  const me = getUserRow(uid);
  const serverIds = q('SELECT server_id FROM members WHERE user_id = ? ORDER BY joined_at').all(uid).map((r) => r.server_id);
  const servers = serverIds.map((id) => serverCtx(id)).filter(Boolean).map((ctx) => serverPayloadFor(ctx, uid));
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
  return { user: selfUser(me), servers, dms, relationships, users, readStates, unreadDm, voice: voiceStatesFor(roomIds), favoriteGifs: favoriteGifs(uid), gifsEnabled: Boolean(klipyKey()) };
}

// userId:channelId -> time of last message (slowmode)
const lastSent = new Map();

/* ---------------- Channel helpers ---------------- */

const CHANNEL_TYPES = ['text', 'voice', 'announcement', 'category'];

function normalizeChannelName(name, type) {
  let n = str(name, 100);
  // Text channel names are lowercase with dashes, but keep emojis and decorative symbols like the ┃ divider
  if (isTextType(type)) {
    n = n.toLowerCase().replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}\p{M}\p{S}‍_-]/gu, '').replace(/[$+<=>^`|~]/g, '')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  if (!n) fail('Channel name is required');
  return n;
}

function insertChannel(serverId, { name, type, parentId = null, synced = 1 }) {
  const pos = q('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE server_id = ?').get(serverId).p;
  const id = newId();
  q('INSERT INTO channels (id, server_id, name, type, topic, position, parent_id, synced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, serverId, name, type, '', pos, parentId, synced, now());
  return id;
}

function setOverwrites(channelId, list) {
  q('DELETE FROM overwrites WHERE channel_id = ?').run(channelId);
  for (const o of list) {
    if (!o.allow && !o.deny) continue;
    q('INSERT INTO overwrites (channel_id, target_id, type, allow, deny) VALUES (?, ?, ?, ?, ?)')
      .run(channelId, o.id, o.type, o.allow & CHANNEL_SCOPED, o.deny & CHANNEL_SCOPED);
  }
}

function sanitizeOverwrites(ctx, list) {
  if (!Array.isArray(list)) fail('Invalid permissions');
  return list.slice(0, 100).map((o) => ({
    id: String(o?.id || ''),
    type: o?.type === 'member' ? 'member' : 'role',
    allow: (Number(o?.allow) || 0) & CHANNEL_SCOPED,
    deny: (Number(o?.deny) || 0) & CHANNEL_SCOPED,
  })).filter((o) => (o.type === 'role' ? ctx.roles.some((r) => r.id === o.id) : ctx.memberIds.includes(o.id)));
}

/* ---------------- Connection ---------------- */

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  if (!getUserRow(uid)) { socket.disconnect(true); return; }

  socket.join('user:' + uid);

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
      profile: 'profile' in p ? JSON.stringify(sanitizeProfile(p.profile)) : row.profile,
    };
    q(`UPDATE users SET display_name = ?, avatar = ?, banner = ?, banner_color = ?, accent_color = ?, bio = ?, pronouns = ?,
       custom_status = ?, status = ?, profile = ? WHERE id = ?`).run(
      next.display_name, next.avatar, next.banner, next.banner_color, next.accent_color, next.bio, next.pronouns,
      next.custom_status, next.status, next.profile, uid,
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

  function sendServerTo(userId, serverId) {
    const ctx = serverCtx(serverId);
    const packet = serverPacket(ctx, userId);
    io.to('user:' + userId).emit('server:sync', packet);
    return packet.server;
  }

  function emitServerUpdate(ctx) {
    for (const m of ctx.memberIds) {
      io.to('user:' + m).emit('server:update', serializeServer(ctx.row, { includeInvite: has(permsOf(ctx, m), P.CREATE_INVITE) }));
    }
  }

  function emitMember(ctx, userId) {
    const row = q('SELECT * FROM members WHERE server_id = ? AND user_id = ?').get(ctx.row.id, userId);
    if (row) toUsers(ctx.memberIds, 'server:member_update', { serverId: ctx.row.id, member: serializeMember(row, ctx) });
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
      q("INSERT INTO roles (id, server_id, name, permissions, position, created_at) VALUES (?, ?, '@everyone', ?, 0, ?)")
        .run(id, id, DEFAULT_EVERYONE, now());
      q('INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, uid, 'owner', now());
      const textCat = insertChannel(id, { name: 'Text Channels', type: 'category' });
      const general = insertChannel(id, { name: 'general', type: 'text', parentId: textCat });
      const voiceCat = insertChannel(id, { name: 'Voice Channels', type: 'category' });
      insertChannel(id, { name: 'Lounge', type: 'voice', parentId: voiceCat });
      q('UPDATE servers SET system_channel_id = ? WHERE id = ?').run(general, id);
    });
    return sendServerTo(uid, id);
  });

  on('server:update', (p) => {
    const ctx = requireCtx(p.serverId, uid);
    requirePerm(ctx, uid, P.MANAGE_SERVER);
    const s = ctx.row;
    const name = 'name' in p ? str(p.name, 100) : s.name;
    if (!name) fail('Server name is required');
    const channelRef = (key, current, types) => {
      if (!(key in p)) return current;
      if (!p[key]) return null;
      const c = ctx.channels.get(String(p[key]));
      if (!c || !types.includes(c.type)) fail('Pick a text channel');
      return c.id;
    };
    q(`UPDATE servers SET name = ?, icon = ?, banner = ?, description = ?, system_channel_id = ?, rules_channel_id = ?,
       join_messages = ? WHERE id = ?`).run(
      name,
      'icon' in p ? uploadPath(p.icon) : s.icon,
      'banner' in p ? uploadPath(p.banner) : s.banner,
      'description' in p ? str(p.description, 300) : s.description,
      channelRef('systemChannelId', s.system_channel_id, ['text', 'announcement']),
      channelRef('rulesChannelId', s.rules_channel_id, ['text', 'announcement']),
      'joinMessages' in p ? (p.joinMessages ? 1 : 0) : s.join_messages,
      s.id,
    );
    const fresh = serverCtx(s.id);
    emitServerUpdate(fresh);
    return serializeServer(fresh.row);
  });

  on('server:invite_reset', ({ serverId }) => {
    const ctx = requireCtx(serverId, uid);
    requirePerm(ctx, uid, P.MANAGE_SERVER);
    q('UPDATE servers SET invite_code = ? WHERE id = ?').run(newInviteCode(), ctx.row.id);
    const fresh = serverCtx(ctx.row.id);
    emitServerUpdate(fresh);
    return serializeServer(fresh.row);
  });

  on('server:delete', ({ serverId }) => {
    const ctx = requireCtx(serverId, uid);
    if (ctx.row.owner_id !== uid) fail('Only the owner can delete this server');
    for (const c of ctx.channels.values()) if (c.type === 'voice') kickRoom(c.id);
    tx(() => {
      q('DELETE FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id = ?)').run(ctx.row.id);
      q('DELETE FROM servers WHERE id = ?').run(ctx.row.id);
    });
    toUsers(ctx.memberIds, 'server:remove', { serverId: ctx.row.id });
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
    return { ...serializeServer(s, { includeInvite: false }), memberCount: memberIds.length, onlineCount, joined: memberIds.includes(uid) };
  });

  on('server:join', ({ code }) => {
    const s = q('SELECT * FROM servers WHERE invite_code = ?').get(extractCode(code));
    if (!s) fail('That invite is invalid or has expired');
    if (q('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?').get(s.id, uid)) fail('You are banned from this server');
    if (q('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?').get(s.id, uid)) return sendServerTo(uid, s.id);
    q('INSERT INTO members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(s.id, uid, 'member', now());
    const ctx = serverCtx(s.id);
    const member = serializeMember(q('SELECT * FROM members WHERE server_id = ? AND user_id = ?').get(s.id, uid), ctx);
    toUsers(ctx.memberIds.filter((id) => id !== uid), 'server:member_add', { serverId: s.id, member, user: publicUser(getUserRow(uid)) });
    const packet = sendServerTo(uid, s.id);
    if (s.join_messages) {
      const target = ctx.channels.get(s.system_channel_id)
        || [...ctx.channels.values()].find((c) => c.type === 'text');
      if (target) {
        const id = newId();
        q("INSERT INTO messages (id, channel_id, author_id, content, kind, created_at) VALUES (?, ?, ?, '', 'join', ?)").run(id, target.id, uid, now());
        toUsers(channelViewers(ctx, target.id), 'message:new', serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)));
      }
    }
    return packet;
  });

  function removeMember(ctx, userId) {
    const serverId = ctx.row.id;
    kickUserFromServerVoice(userId, serverId);
    tx(() => {
      q('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(serverId, userId);
      q("DELETE FROM overwrites WHERE target_id = ? AND type = 'member' AND channel_id IN (SELECT id FROM channels WHERE server_id = ?)").run(userId, serverId);
      q('DELETE FROM members WHERE server_id = ? AND user_id = ?').run(serverId, userId);
    });
    io.to('user:' + userId).emit('server:remove', { serverId });
    toUsers(ctx.memberIds.filter((id) => id !== userId), 'server:member_remove', { serverId, userId });
  }

  /** Can `uid` act on `targetId` (kick, ban, change roles)? The owner outranks everyone. */
  function outranks(ctx, targetId) {
    if (targetId === ctx.row.owner_id) return false;
    return topPosition(ctx.perm, uid) > topPosition(ctx.perm, targetId);
  }

  on('server:leave', ({ serverId }) => {
    const ctx = requireCtx(serverId, uid);
    if (ctx.row.owner_id === uid) fail('Transfer or delete the server before leaving');
    removeMember(ctx, uid);
    return true;
  });

  on('server:kick', ({ serverId, userId }) => {
    const ctx = requireCtx(serverId, uid);
    requirePerm(ctx, uid, P.KICK_MEMBERS);
    const target = String(userId || '');
    if (!isMember(ctx, target)) fail('That user is not in this server');
    if (!outranks(ctx, target)) fail('You cannot kick that member');
    removeMember(ctx, target);
    return true;
  });

  on('server:ban', ({ serverId, userId, reason }) => {
    const ctx = requireCtx(serverId, uid);
    requirePerm(ctx, uid, P.BAN_MEMBERS);
    const target = String(userId || '');
    if (target === uid || !getUserRow(target)) fail('User not found');
    if (isMember(ctx, target) && !outranks(ctx, target)) fail('You cannot ban that member');
    q(`INSERT INTO bans (server_id, user_id, reason, banned_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (server_id, user_id) DO UPDATE SET reason = excluded.reason`).run(ctx.row.id, target, str(reason, 300), uid, now());
    if (isMember(ctx, target)) removeMember(ctx, target);
    return true;
  });

  on('server:unban', ({ serverId, userId }) => {
    const ctx = requireCtx(serverId, uid);
    requirePerm(ctx, uid, P.BAN_MEMBERS);
    q('DELETE FROM bans WHERE server_id = ? AND user_id = ?').run(ctx.row.id, String(userId || ''));
    return true;
  });

  on('server:bans', ({ serverId }) => {
    const ctx = requireCtx(serverId, uid);
    requirePerm(ctx, uid, P.BAN_MEMBERS);
    return q('SELECT * FROM bans WHERE server_id = ? ORDER BY created_at DESC').all(ctx.row.id).map((b) => ({
      user: publicUser(getUserRow(b.user_id)), reason: b.reason, createdAt: b.created_at,
    })).filter((b) => b.user);
  });

  on('member:nickname', ({ serverId, userId, nickname }) => {
    const ctx = requireCtx(serverId, uid);
    const target = userId ? String(userId) : uid;
    if (!isMember(ctx, target)) fail('That user is not in this server');
    if (target === uid) requirePerm(ctx, uid, P.CHANGE_NICKNAME);
    else {
      requirePerm(ctx, uid, P.MANAGE_NICKNAMES);
      if (!outranks(ctx, target)) fail(NO_PERMISSION);
    }
    q('UPDATE members SET nickname = ? WHERE server_id = ? AND user_id = ?').run(str(nickname, 32) || null, ctx.row.id, target);
    emitMember(ctx, target);
    return true;
  });

  on('server:transfer', ({ serverId, userId }) => {
    const ctx = requireCtx(serverId, uid);
    if (ctx.row.owner_id !== uid) fail('Only the owner can transfer the server');
    const target = String(userId || '');
    if (!isMember(ctx, target) || target === uid) fail('Pick another member');
    tx(() => {
      q('UPDATE servers SET owner_id = ? WHERE id = ?').run(target, ctx.row.id);
      q("UPDATE members SET role = 'owner' WHERE server_id = ? AND user_id = ?").run(ctx.row.id, target);
      q("UPDATE members SET role = 'member' WHERE server_id = ? AND user_id = ?").run(ctx.row.id, uid);
    });
    syncServer(ctx.row.id);
    return true;
  });

  /* ---------- Roles ---------- */

  function requireRoleManager(ctx, role) {
    requirePerm(ctx, uid, P.MANAGE_ROLES);
    if (role && ctx.row.owner_id !== uid && role.position >= topPosition(ctx.perm, uid)) fail('That role is above your highest role');
  }

  on('role:create', ({ serverId }) => {
    const ctx = requireCtx(serverId, uid);
    requireRoleManager(ctx, null);
    if (ctx.roles.length >= 100) fail('This server has too many roles');
    const id = newId();
    tx(() => {
      q('UPDATE roles SET position = position + 1 WHERE server_id = ? AND position >= 1').run(ctx.row.id);
      q("INSERT INTO roles (id, server_id, name, permissions, position, created_at) VALUES (?, ?, 'new role', 0, 1, ?)").run(id, ctx.row.id, now());
    });
    syncServer(ctx.row.id);
    return serializeRole(q('SELECT * FROM roles WHERE id = ?').get(id));
  });

  on('role:update', (p) => {
    const role = q('SELECT * FROM roles WHERE id = ?').get(String(p.roleId || ''));
    if (!role) fail('Role not found');
    const ctx = requireCtx(role.server_id, uid);
    requireRoleManager(ctx, role);
    const isEveryone = role.id === ctx.row.id;
    let permissions = role.permissions;
    if ('permissions' in p) {
      permissions = (Number(p.permissions) || 0) & ALL;
      const mine = permsOf(ctx, uid);
      const added = permissions & ~role.permissions;
      if (!has(mine, P.ADMINISTRATOR) && (added & ~mine)) fail('You cannot grant permissions you do not have');
    }
    const name = !isEveryone && 'name' in p ? (str(p.name, 100) || role.name) : role.name;
    const color = 'color' in p ? (COLOR_RE.test(p.color || '') ? p.color : null) : role.color;
    q('UPDATE roles SET name = ?, color = ?, hoist = ?, mentionable = ?, permissions = ? WHERE id = ?').run(
      name,
      isEveryone ? null : color,
      !isEveryone && 'hoist' in p ? (p.hoist ? 1 : 0) : role.hoist,
      !isEveryone && 'mentionable' in p ? (p.mentionable ? 1 : 0) : role.mentionable,
      permissions,
      role.id,
    );
    syncServer(ctx.row.id);
    return serializeRole(q('SELECT * FROM roles WHERE id = ?').get(role.id));
  });

  on('role:delete', ({ roleId }) => {
    const role = q('SELECT * FROM roles WHERE id = ?').get(String(roleId || ''));
    if (!role) fail('Role not found');
    const ctx = requireCtx(role.server_id, uid);
    if (role.id === ctx.row.id) fail('The @everyone role cannot be deleted');
    requireRoleManager(ctx, role);
    tx(() => {
      q("DELETE FROM overwrites WHERE target_id = ? AND type = 'role'").run(role.id);
      q('DELETE FROM roles WHERE id = ?').run(role.id);
      q('UPDATE roles SET position = position - 1 WHERE server_id = ? AND position > ?').run(ctx.row.id, role.position);
    });
    syncServer(ctx.row.id);
    return true;
  });

  on('role:reorder', ({ serverId, order }) => {
    const ctx = requireCtx(serverId, uid);
    requireRoleManager(ctx, null);
    if (!Array.isArray(order)) fail('Invalid order');
    const ids = order.map(String).filter((id) => id !== ctx.row.id && ctx.roles.some((r) => r.id === id));
    if (ids.length !== ctx.roles.length - 1) fail('Invalid order');
    const top = ctx.row.owner_id === uid ? Infinity : topPosition(ctx.perm, uid);
    const next = new Map(ids.map((id, i) => [id, ids.length - i]));
    for (const r of ctx.roles) {
      if (r.id === ctx.row.id) continue;
      if (next.get(r.id) !== r.position && (r.position >= top || next.get(r.id) >= top)) fail('You can only move roles below your highest role');
    }
    tx(() => { for (const [id, pos] of next) q('UPDATE roles SET position = ? WHERE id = ?').run(pos, id); });
    syncServer(ctx.row.id);
    return true;
  });

  on('member:roles', ({ serverId, userId, roleIds }) => {
    const ctx = requireCtx(serverId, uid);
    requireRoleManager(ctx, null);
    const target = String(userId || '');
    if (!isMember(ctx, target)) fail('That user is not in this server');
    if (!Array.isArray(roleIds)) fail('Invalid roles');
    const wanted = new Set(roleIds.map(String).filter((id) => id !== ctx.row.id && ctx.roles.some((r) => r.id === id)));
    const current = new Set(ctx.memberRoles.get(target) || []);
    const top = ctx.row.owner_id === uid ? Infinity : topPosition(ctx.perm, uid);
    for (const r of ctx.roles) {
      if (wanted.has(r.id) !== current.has(r.id) && r.position >= top) fail('You can only give roles below your highest role');
    }
    tx(() => {
      q('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(ctx.row.id, target);
      for (const id of wanted) q('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)').run(ctx.row.id, target, id);
    });
    const fresh = serverCtx(ctx.row.id);
    emitMember(fresh, target);
    syncServer(ctx.row.id, target);
    return true;
  });

  /* ---------- Channels ---------- */

  on('channel:create', ({ serverId, name, type, parentId, private: isPrivate, allowRoles }) => {
    const ctx = requireCtx(serverId, uid);
    // "rules" is a text channel that only staff can post in, set as the server's rules channel
    const asRules = type === 'rules';
    if (asRules) requirePerm(ctx, uid, P.MANAGE_SERVER);
    const t = asRules ? 'text' : CHANNEL_TYPES.includes(type) ? type : 'text';
    const parent = parentId ? ctx.channels.get(String(parentId)) : null;
    if (parentId && (!parent || parent.type !== 'category' || t === 'category')) fail('Invalid category');
    requirePerm(ctx, uid, P.MANAGE_CHANNELS, parent?.id || null);
    if (ctx.channels.size >= 250) fail('This server has too many channels');

    const inherited = parent ? (ctx.overwrites.get(parent.id) || []) : [];
    const extra = [];
    if (isPrivate) {
      extra.push({ id: ctx.row.id, type: 'role', allow: 0, deny: P.VIEW_CHANNEL });
      for (const rid of Array.isArray(allowRoles) ? allowRoles.map(String) : []) {
        if (ctx.roles.some((r) => r.id === rid && r.id !== ctx.row.id)) extra.push({ id: rid, type: 'role', allow: P.VIEW_CHANNEL, deny: 0 });
      }
      if (ctx.row.owner_id !== uid) extra.push({ id: uid, type: 'member', allow: P.VIEW_CHANNEL, deny: 0 });
    }
    if (t === 'announcement' || asRules) extra.push({ id: ctx.row.id, type: 'role', allow: 0, deny: P.SEND_MESSAGES });

    const merged = new Map(inherited.map((o) => [o.id, { ...o }]));
    for (const o of extra) {
      const cur = merged.get(o.id) || { id: o.id, type: o.type, allow: 0, deny: 0 };
      cur.allow = (cur.allow & ~o.deny) | o.allow;
      cur.deny = (cur.deny & ~o.allow) | o.deny;
      merged.set(o.id, cur);
    }
    const custom = extra.length > 0 && t !== 'category';
    let id;
    tx(() => {
      id = insertChannel(ctx.row.id, { name: normalizeChannelName(name, t), type: t, parentId: parent?.id || null, synced: custom ? 0 : 1 });
      if (custom || t === 'category') setOverwrites(id, [...merged.values()]);
      if (asRules) q('UPDATE servers SET rules_channel_id = ? WHERE id = ?').run(id, ctx.row.id);
    });
    syncServer(ctx.row.id);
    return serializeChannel(serverCtx(ctx.row.id).channels.get(id), serverCtx(ctx.row.id));
  });

  on('channel:update', (p) => {
    const ch = q('SELECT * FROM channels WHERE id = ?').get(String(p.channelId || ''));
    if (!ch) fail('Channel not found');
    const ctx = requireCtx(ch.server_id, uid);
    requirePerm(ctx, uid, P.MANAGE_CHANNELS, ch.id);
    let parent = ch.parent_id;
    if ('parentId' in p && ch.type !== 'category') {
      if (!p.parentId) parent = null;
      else {
        const c = ctx.channels.get(String(p.parentId));
        if (!c || c.type !== 'category') fail('Invalid category');
        parent = c.id;
      }
    }
    // Text and announcement channels can switch between the two.
    let type = ch.type;
    if ('type' in p && p.type !== ch.type) {
      if (!isTextType(ch.type) || !isTextType(p.type)) fail('This channel type cannot be changed');
      type = p.type;
      if (type === 'announcement') {
        // Like a new announcement channel, only people with an explicit allow can post.
        const effective = ch.synced && ch.parent_id ? (ctx.overwrites.get(ch.parent_id) || []) : (ctx.overwrites.get(ch.id) || []);
        const list = effective.map((o) => ({ ...o }));
        let everyone = list.find((o) => o.id === ctx.row.id);
        if (!everyone) list.push(everyone = { id: ctx.row.id, type: 'role', allow: 0, deny: 0 });
        everyone.allow &= ~P.SEND_MESSAGES;
        everyone.deny |= P.SEND_MESSAGES;
        tx(() => {
          q('UPDATE channels SET synced = 0 WHERE id = ?').run(ch.id);
          setOverwrites(ch.id, list);
        });
      }
    }
    q('UPDATE channels SET name = ?, type = ?, topic = ?, slowmode = ?, user_limit = ?, parent_id = ? WHERE id = ?').run(
      'name' in p ? normalizeChannelName(p.name, type) : ch.name,
      type,
      'topic' in p ? str(p.topic, 1024) : ch.topic,
      'slowmode' in p ? Math.max(0, Math.min(21600, Number(p.slowmode) || 0)) : ch.slowmode,
      'userLimit' in p ? Math.max(0, Math.min(99, Number(p.userLimit) || 0)) : ch.user_limit,
      parent,
      ch.id,
    );
    syncServer(ctx.row.id);
    return true;
  });

  on('channel:permissions', ({ channelId, overwrites, synced }) => {
    const ch = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
    if (!ch) fail('Channel not found');
    const ctx = requireCtx(ch.server_id, uid);
    requirePerm(ctx, uid, P.MANAGE_ROLES, ch.id);
    tx(() => {
      if (synced && ch.parent_id) {
        q('UPDATE channels SET synced = 1 WHERE id = ?').run(ch.id);
        q('DELETE FROM overwrites WHERE channel_id = ?').run(ch.id);
      } else {
        q('UPDATE channels SET synced = 0 WHERE id = ?').run(ch.id);
        setOverwrites(ch.id, sanitizeOverwrites(ctx, overwrites || []));
      }
    });
    syncServer(ctx.row.id);
    return true;
  });

  on('channel:reorder', ({ serverId, items }) => {
    const ctx = requireCtx(serverId, uid);
    requirePerm(ctx, uid, P.MANAGE_CHANNELS);
    if (!Array.isArray(items)) fail('Invalid order');
    tx(() => {
      items.slice(0, 300).forEach((item, i) => {
        const c = ctx.channels.get(String(item?.id || ''));
        if (!c) return;
        let parent = c.type === 'category' ? null : (item.parentId ? String(item.parentId) : null);
        if (parent && ctx.channels.get(parent)?.type !== 'category') parent = null;
        q('UPDATE channels SET position = ?, parent_id = ? WHERE id = ?').run(i, parent, c.id);
      });
    });
    syncServer(ctx.row.id);
    return true;
  });

  on('channel:delete', ({ channelId }) => {
    const ch = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
    if (!ch) fail('Channel not found');
    const ctx = requireCtx(ch.server_id, uid);
    requirePerm(ctx, uid, P.MANAGE_CHANNELS, ch.id);
    const textCount = [...ctx.channels.values()].filter((c) => isTextType(c.type)).length;
    if (isTextType(ch.type) && textCount <= 1) fail('A server needs at least one text channel');
    if (ch.type === 'voice') kickRoom(ch.id);
    tx(() => {
      if (ch.type === 'category') q('UPDATE channels SET parent_id = NULL, synced = 0 WHERE parent_id = ?').run(ch.id);
      q('DELETE FROM messages WHERE channel_id = ?').run(ch.id);
      q('DELETE FROM read_states WHERE channel_id = ?').run(ch.id);
      q('DELETE FROM channels WHERE id = ?').run(ch.id);
      q('UPDATE servers SET system_channel_id = NULL WHERE system_channel_id = ?').run(ch.id);
      q('UPDATE servers SET rules_channel_id = NULL WHERE rules_channel_id = ?').run(ch.id);
    });
    syncServer(ctx.row.id);
    return true;
  });

  /* ---------- Messages ---------- */

  on('messages:fetch', ({ channelId, before, limit }) => {
    const access = channelAccess(uid, channelId);
    if (access.kind === 'channel' && !has(access.perms, P.READ_HISTORY)) return [];
    const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const rows = before
      ? q('SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(channelId, String(before), n)
      : q('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(channelId, n);
    return rows.reverse().map(serializeMessage);
  });

  on('message:send', ({ channelId, content, attachments, replyTo, nonce }) => {
    spend();
    const access = channelAccess(uid, channelId, P.SEND_MESSAGES);
    if (access.kind === 'channel' && !isTextType(access.channel.type)) fail('You cannot send messages here');
    if (access.kind === 'dm' && isBlockedEitherWay(uid, access.otherId)) fail('You cannot message this user');
    const text = str(content, 4000, { trim: false }).replace(/^\s+|\s+$/g, '');
    const files = sanitizeAttachments(attachments);
    if (!text && !files.length) fail('Message is empty');
    if (files.length && !has(access.perms, P.ATTACH_FILES)) fail('You cannot attach files here');
    if (access.kind === 'channel' && access.channel.slowmode > 0 && !has(access.perms, P.MANAGE_MESSAGES) && !has(access.perms, P.MANAGE_CHANNELS)) {
      const key = `${uid}:${access.channel.id}`;
      const wait = (lastSent.get(key) || 0) + access.channel.slowmode * 1000 - now();
      if (wait > 0) fail(`Slowmode is on. Wait ${Math.ceil(wait / 1000)}s`);
      lastSent.set(key, now());
    }
    let reply = null;
    if (replyTo) {
      const r = q('SELECT id FROM messages WHERE id = ? AND channel_id = ?').get(String(replyTo), channelId);
      reply = r ? r.id : null;
    }
    const mentions = computeMentions(access, uid, text);
    const id = newId();
    const t = now();
    tx(() => {
      q('INSERT INTO messages (id, channel_id, author_id, content, attachments, reply_to, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, channelId, uid, text, JSON.stringify(files), reply, JSON.stringify(mentions), t);
      if (access.kind === 'dm') q('UPDATE dms SET last_message_at = ? WHERE id = ?').run(t, channelId);
      q(`INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(uid, channelId, id);
    });
    const msg = { ...serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)), nonce: str(nonce, 64) || undefined };
    emitToChannel(access, 'message:new', msg);
    if (access.kind === 'channel' && access.channel.type === 'announcement') crosspost(access, uid, id, text, files);
    return msg;
  });

  on('channel:follow', ({ sourceId, targetId }) => {
    const src = channelAccess(uid, sourceId);
    if (src.kind !== 'channel' || src.channel.type !== 'announcement') fail('Only announcement channels can be followed');
    const target = q('SELECT * FROM channels WHERE id = ?').get(String(targetId || ''));
    if (!target || !isTextType(target.type)) fail('Pick a text channel');
    if (target.id === src.channel.id) fail('A channel cannot follow itself');
    const tctx = requireCtx(target.server_id, uid);
    requirePerm(tctx, uid, P.MANAGE_CHANNELS, target.id);
    if (q('SELECT 1 FROM channel_follows WHERE source_id = ? AND target_id = ?').get(src.channel.id, target.id)) fail('That channel already follows this one');
    if (q('SELECT COUNT(*) AS c FROM channel_follows WHERE target_id = ?').get(target.id).c >= MAX_FOLLOWS_PER_CHANNEL) fail('That channel follows too many channels');
    q('INSERT INTO channel_follows (source_id, target_id, created_by, created_at) VALUES (?, ?, ?, ?)').run(src.channel.id, target.id, uid, now());
    const id = newId();
    q("INSERT INTO messages (id, channel_id, author_id, content, kind, crosspost, created_at) VALUES (?, ?, ?, '', 'follow', ?, ?)")
      .run(id, target.id, uid, JSON.stringify(sourceInfo(src.channel)), now());
    toUsers(channelViewers(tctx, target.id), 'message:new', serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(id)));
    return true;
  });

  on('channel:unfollow', ({ sourceId, targetId }) => {
    const target = q('SELECT * FROM channels WHERE id = ?').get(String(targetId || ''));
    if (!target) fail('Channel not found');
    requirePerm(requireCtx(target.server_id, uid), uid, P.MANAGE_CHANNELS, target.id);
    q('DELETE FROM channel_follows WHERE source_id = ? AND target_id = ?').run(String(sourceId || ''), target.id);
    return followsFor(target.id);
  });

  on('channel:follows', ({ channelId }) => {
    const ch = q('SELECT * FROM channels WHERE id = ?').get(String(channelId || ''));
    if (!ch) fail('Channel not found');
    requirePerm(requireCtx(ch.server_id, uid), uid, P.MANAGE_CHANNELS, ch.id);
    return {
      following: followsFor(ch.id),
      followers: q('SELECT COUNT(*) AS c FROM channel_follows WHERE source_id = ?').get(ch.id).c,
    };
  });

  on('gif:favorite', ({ gif, favorite }) => {
    const g = sanitizeGif(gif);
    if (favorite) {
      const count = q('SELECT COUNT(*) AS c FROM favorite_gifs WHERE user_id = ?').get(uid).c;
      if (count >= 500) fail('You can save up to 500 GIFs');
      q('INSERT OR REPLACE INTO favorite_gifs (user_id, url, data, created_at) VALUES (?, ?, ?, ?)').run(uid, g.url, JSON.stringify(g), now());
    } else {
      q('DELETE FROM favorite_gifs WHERE user_id = ? AND url = ?').run(uid, g.url);
    }
    const list = favoriteGifs(uid);
    io.to('user:' + uid).emit('gif:favorites', list);
    return list;
  });

  on('message:edit', ({ messageId, content }) => {
    const m = q('SELECT * FROM messages WHERE id = ?').get(String(messageId || ''));
    if (!m || m.author_id !== uid || m.kind !== 'default' || m.crosspost) fail('You cannot edit this message');
    const access = channelAccess(uid, m.channel_id);
    const text = str(content, 4000, { trim: false }).replace(/^\s+|\s+$/g, '');
    if (!text && JSON.parse(m.attachments).length === 0) fail('Message is empty');
    q('UPDATE messages SET content = ?, mentions = ?, edited_at = ? WHERE id = ?').run(text, JSON.stringify(computeMentions(access, uid, text)), now(), m.id);
    const msg = serializeMessage(q('SELECT * FROM messages WHERE id = ?').get(m.id));
    emitToChannel(access, 'message:update', msg);
    return msg;
  });

  on('message:delete', ({ messageId }) => {
    const m = q('SELECT * FROM messages WHERE id = ?').get(String(messageId || ''));
    if (!m) fail('Message not found');
    const access = channelAccess(uid, m.channel_id);
    const canModerate = access.kind === 'channel' && has(access.perms, P.MANAGE_MESSAGES);
    if (m.author_id !== uid && !canModerate) fail('You cannot delete this message');
    q('DELETE FROM messages WHERE id = ?').run(m.id);
    emitToChannel(access, 'message:delete', { id: m.id, channelId: m.channel_id });
    return true;
  });

  on('typing', ({ channelId }) => {
    const access = channelAccess(uid, channelId, P.SEND_MESSAGES);
    const payload = { channelId, userId: uid };
    if (access.kind === 'channel') toUsers(channelViewers(access.ctx, access.channel.id).filter((id) => id !== uid), 'typing', payload);
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
    const access = channelAccess(uid, roomId, P.CONNECT);
    if (access.kind === 'channel' && access.channel.type !== 'voice') fail('This is not a voice channel');
    if (access.kind === 'dm' && isBlockedEitherWay(uid, access.otherId)) fail('You cannot call this user');
    if (access.kind === 'channel' && access.channel.user_limit > 0 && !has(access.perms, P.MOVE_MEMBERS)) {
      const count = [...(voiceRooms.get(roomId)?.keys() || [])].filter((id) => id !== uid).length;
      if (count >= access.channel.user_limit) fail('This voice channel is full');
    }

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
      userId: uid, socketId: socket.id, muted: !has(access.perms, P.SPEAK), deafened: false, video: false, screen: false,
      serverMuted: false, serverDeafened: false, cameraStreamId: null, screenStreamId: null, joinedAt: now(),
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
    let perms = ALL;
    const ch = q('SELECT server_id FROM channels WHERE id = ?').get(roomId);
    if (ch) perms = permsOf(serverCtx(ch.server_id), uid, roomId);
    for (const key of ['muted', 'deafened', 'video', 'screen']) if (key in p) state[key] = Boolean(p[key]);
    for (const key of ['cameraStreamId', 'screenStreamId']) if (key in p) state[key] = p[key] ? str(p[key], 100) : null;
    if (!has(perms, P.SPEAK)) state.muted = true;
    if (!has(perms, P.VIDEO)) { state.video = false; state.screen = false; }
    emitVoice(roomId);
    return true;
  });

  on('voice:moderate', ({ userId, serverMuted, serverDeafened, disconnect }) => {
    const target = String(userId || '');
    let roomId = null;
    for (const [id, room] of voiceRooms) if (room.has(target)) roomId = id;
    const ch = roomId && q('SELECT * FROM channels WHERE id = ?').get(roomId);
    if (!ch) fail('That user is not in a voice channel');
    const ctx = requireCtx(ch.server_id, uid);
    const perms = permsOf(ctx, uid, roomId);
    const state = voiceRooms.get(roomId).get(target);
    if (target !== uid && target === ctx.row.owner_id) fail(NO_PERMISSION);
    if (disconnect) {
      if (!has(perms, P.MOVE_MEMBERS)) fail(NO_PERMISSION);
      disconnectFromVoice(state, roomId);
      return true;
    }
    if (serverMuted !== undefined) {
      if (!has(perms, P.MUTE_MEMBERS)) fail(NO_PERMISSION);
      state.serverMuted = Boolean(serverMuted);
    }
    if (serverDeafened !== undefined) {
      if (!has(perms, P.DEAFEN_MEMBERS)) fail(NO_PERMISSION);
      state.serverDeafened = Boolean(serverDeafened);
    }
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
