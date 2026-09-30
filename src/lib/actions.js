import { authApi, call, connectSocket, disconnectSocket, discoverServer, getSocket, getToken, native, setToken } from './api';
import { getState, resetState, setState, withKey, withoutKey } from './store';
import { voice } from './voice';
import { playSound, startLoop, stopLoop } from './sounds';
import { displayName, nonce } from './format';

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

let toastSeq = 0;
export function toast(text, kind = 'info') {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
}

export function openModal(type, props = {}) {
  setState((s) => ({ modals: [...s.modals, { id: nonce(), type, props }], popout: null, menu: null }));
}
export function closeModal() {
  setState((s) => ({ modals: s.modals.slice(0, -1) }));
}
export function closeAllModals() {
  setState({ modals: [] });
}

export function openPopout(userId, rect, serverId = null) {
  setState({ popout: { userId, rect, serverId }, menu: null });
}
export const closePopout = () => setState({ popout: null });

export function openMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  setState({ menu: { x: event.clientX, y: event.clientY, items }, popout: null });
}
export const closeMenu = () => setState({ menu: null });

async function attempt(fn, { success } = {}) {
  try {
    const out = await fn();
    if (success) toast(success, 'success');
    return out;
  } catch (err) {
    toast(err.message || 'Something went wrong', 'error');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export async function boot() {
  setupActivityTracking();
  await discoverServer();
  const token = getToken();
  if (!token) setState({ status: 'auth' });
  else startSession(token);
}

export async function login(loginName, password) {
  const { token } = await authApi.login(loginName, password);
  startSession(token);
}

export async function register(fields) {
  const { token } = await authApi.register(fields);
  startSession(token);
}

export async function logout() {
  const token = getToken();
  voice.leave({ silent: true });
  try { await call('auth:logout', {}, 3000); } catch { await authApi.logout(token); }
  endSession();
}

function endSession() {
  setToken(null);
  disconnectSocket();
  stopLoop('ringtone');
  stopLoop('calling');
  native?.setBadge?.(null, 0);
  resetState();
}

let pingTimer = null;

export function startSession(token) {
  setToken(token);
  setState({ status: 'connecting', connection: 'connecting' });
  const socket = connectSocket(token);
  let failures = 0;

  socket.on('connect', () => { failures = 0; setState({ connection: 'connected' }); });
  socket.on('disconnect', () => setState({ connection: 'reconnecting' }));
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      endSession();
      toast('Your session expired. Please log in again.', 'error');
      return;
    }
    failures += 1;
    setState({ connection: failures > 2 ? 'offline' : 'reconnecting' });
    // The server may have moved to a new tunnel address.
    if (failures % 3 === 0) {
      discoverServer().then((moved) => { if (moved && getToken() === token) startSession(token); });
    }
  });

  socket.on('ready', onReady);
  socket.on('self:update', (u) => setState((s) => ({ me: u, users: withKey(s.users, u.id, { ...s.users[u.id], ...u }) })));
  socket.on('user:update', (u) => setState((s) => ({ users: withKey(s.users, u.id, { ...s.users[u.id], ...u }) })));

  socket.on('server:create', ({ server, users, voice: voiceStates }) => addServer(server, users, voiceStates));
  socket.on('server:update', (srv) => setState((s) => ({ servers: withKey(s.servers, srv.id, { ...s.servers[srv.id], ...srv }) })));
  socket.on('server:remove', ({ serverId }) => removeServer(serverId));
  socket.on('server:member_add', ({ serverId, member, user }) => setState((s) => ({
    users: withKey(s.users, user.id, { ...s.users[user.id], ...user }),
    members: withKey(s.members, serverId, withKey(s.members[serverId] || {}, member.userId, member)),
  })));
  socket.on('server:member_update', ({ serverId, member }) => setState((s) => ({
    members: withKey(s.members, serverId, withKey(s.members[serverId] || {}, member.userId, member)),
  })));
  socket.on('server:member_remove', ({ serverId, userId }) => setState((s) => ({
    members: withKey(s.members, serverId, withoutKey(s.members[serverId] || {}, userId)),
  })));

  socket.on('channel:create', (ch) => setState((s) => ({ channels: withKey(s.channels, ch.id, ch) })));
  socket.on('channel:update', (ch) => setState((s) => ({ channels: withKey(s.channels, ch.id, { ...s.channels[ch.id], ...ch }) })));
  socket.on('channel:reorder', ({ channels }) => setState((s) => {
    const next = { ...s.channels };
    for (const ch of channels) next[ch.id] = { ...next[ch.id], ...ch };
    return { channels: next };
  }));
  socket.on('channel:delete', ({ id, serverId }) => {
    const { view } = getState();
    setState((s) => ({ channels: withoutKey(s.channels, id), messages: withoutKey(s.messages, id) }));
    if (view.kind === 'server' && view.channelId === id) selectServer(serverId);
  });

  socket.on('message:new', onMessageNew);
  socket.on('message:update', (m) => setState((s) => {
    const bucket = s.messages[m.channelId];
    if (!bucket) return null;
    return { messages: withKey(s.messages, m.channelId, { ...bucket, list: bucket.list.map((x) => (x.id === m.id ? m : x)) }) };
  }));
  socket.on('message:delete', ({ id, channelId }) => setState((s) => {
    const bucket = s.messages[channelId];
    if (!bucket) return null;
    return { messages: withKey(s.messages, channelId, { ...bucket, list: bucket.list.filter((x) => x.id !== id) }) };
  }));

  socket.on('typing', ({ channelId, userId }) => {
    const until = Date.now() + 8000;
    setState((s) => ({ typing: withKey(s.typing, channelId, withKey(s.typing[channelId] || {}, userId, until)) }));
    setTimeout(() => setState((s) => {
      const cur = s.typing[channelId];
      if (!cur || cur[userId] !== until) return null;
      return { typing: withKey(s.typing, channelId, withoutKey(cur, userId)) };
    }), 8100);
  });

  socket.on('read', ({ channelId, messageId }) => setState((s) => ({
    readStates: withKey(s.readStates, channelId, messageId > (s.readStates[channelId] || '') ? messageId : s.readStates[channelId]),
    unreadDm: s.unreadDm[channelId] ? withKey(s.unreadDm, channelId, 0) : s.unreadDm,
    mentions: s.mentions[channelId] ? withKey(s.mentions, channelId, 0) : s.mentions,
  })));

  socket.on('relationship:update', ({ id, type, user }) => {
    const prev = getState().relationships[id];
    setState((s) => ({
      relationships: withKey(s.relationships, id, type),
      users: user ? withKey(s.users, id, { ...s.users[id], ...user }) : s.users,
    }));
    if (type === 'incoming' && prev !== 'incoming') {
      playSound('message');
      notify('Friend request', `${displayName(user)} sent you a friend request`, () => openHome('friends'));
    }
  });
  socket.on('relationship:remove', ({ id }) => setState((s) => ({ relationships: withoutKey(s.relationships, id) })));

  socket.on('dm:create', ({ dm, user }) => setState((s) => ({
    dms: withKey(s.dms, dm.id, { ...s.dms[dm.id], ...dm }),
    users: withKey(s.users, user.id, { ...s.users[user.id], ...user }),
  })));

  socket.on('voice:update', onVoiceUpdate);
  socket.on('voice:kicked', () => voice.leave({ local: true }));
  socket.on('rtc:signal', (msg) => voice.onSignal(msg));
  socket.on('call:ring', onCallRing);
  socket.on('call:end', ({ roomId }) => clearIncoming(roomId));
  socket.on('call:declined', ({ roomId, userId }) => {
    const me = getState().me;
    if (userId === me?.id) { clearIncoming(roomId); return; }
    if (voice.roomId === roomId) {
      const others = (getState().voice[roomId] || []).filter((st) => st.userId !== me.id);
      if (!others.length) {
        voice.leave();
        toast(`${displayName(getState().users[userId])} is unavailable`, 'info');
      }
    }
  });

  clearInterval(pingTimer);
  pingTimer = setInterval(measurePing, 8000);
}

function onReady(data) {
  const prev = getState();
  const users = {};
  for (const u of data.users) users[u.id] = u;
  users[data.user.id] = data.user;

  const servers = {};
  const channels = {};
  const members = {};
  for (const srv of data.servers) {
    const { channels: chs, members: mems, ...rest } = srv;
    servers[srv.id] = rest;
    for (const c of chs) channels[c.id] = c;
    members[srv.id] = Object.fromEntries(mems.map((m) => [m.userId, m]));
  }
  const savedOrder = loadServerOrder();
  const ids = data.servers.map((s) => s.id);
  const serverOrder = [...savedOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !savedOrder.includes(id))];

  let view = prev.view;
  if (view.kind === 'server' && !servers[view.serverId]) view = { kind: 'home', home: 'friends' };

  setState({
    status: 'ready',
    connection: 'connected',
    me: data.user,
    users,
    servers,
    serverOrder,
    channels,
    members,
    dms: Object.fromEntries(data.dms.map((d) => [d.id, d])),
    relationships: Object.fromEntries(data.relationships.map((r) => [r.id, r.type])),
    readStates: data.readStates,
    unreadDm: data.unreadDm,
    voice: data.voice,
    messages: {},
    typing: {},
    view,
  });
  if (view.kind === 'server' && !view.channelId) selectServer(view.serverId);
  if (voice.roomId) voice.rejoin();
  updateBadge();
  measurePing();
}

async function measurePing() {
  if (!getSocket()?.connected) return;
  const t = performance.now();
  try {
    await call('ping', {}, 5000);
    setState({ ping: Math.round(performance.now() - t) });
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Server bookkeeping                                                  */
/* ------------------------------------------------------------------ */

const ORDER_KEY = 'bliscord.serverOrder';
function loadServerOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { return []; }
}
export function reorderServers(order) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  setState({ serverOrder: order });
}

function addServer(server, users, voiceStates) {
  setState((s) => {
    const { channels: chs, members: mems, ...rest } = server;
    const nextUsers = { ...s.users };
    for (const u of users) nextUsers[u.id] = { ...nextUsers[u.id], ...u };
    const nextChannels = { ...s.channels };
    for (const c of chs) nextChannels[c.id] = c;
    return {
      servers: withKey(s.servers, server.id, rest),
      serverOrder: s.serverOrder.includes(server.id) ? s.serverOrder : [...s.serverOrder, server.id],
      channels: nextChannels,
      members: withKey(s.members, server.id, Object.fromEntries(mems.map((m) => [m.userId, m]))),
      users: nextUsers,
      voice: { ...s.voice, ...voiceStates },
    };
  });
}

function removeServer(serverId) {
  const s = getState();
  const channelIds = Object.values(s.channels).filter((c) => c.serverId === serverId).map((c) => c.id);
  if (voice.roomId && channelIds.includes(voice.roomId)) voice.leave({ local: true });
  const channels = { ...s.channels };
  const messages = { ...s.messages };
  for (const id of channelIds) { delete channels[id]; delete messages[id]; }
  setState({
    servers: withoutKey(s.servers, serverId),
    serverOrder: s.serverOrder.filter((id) => id !== serverId),
    members: withoutKey(s.members, serverId),
    channels,
    messages,
  });
  if (s.view.kind === 'server' && s.view.serverId === serverId) openHome('friends');
}

export function serverChannels(state, serverId) {
  return Object.values(state.channels)
    .filter((c) => c.serverId === serverId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

export function selectServer(serverId) {
  const s = getState();
  const list = serverChannels(s, serverId);
  const remembered = s.lastChannel[serverId];
  const channel = list.find((c) => c.id === remembered) || list.find((c) => c.type === 'text');
  setState({ view: { kind: 'server', serverId, channelId: channel?.id || null } });
}

export function selectChannel(serverId, channelId) {
  setState((s) => ({
    view: { kind: 'server', serverId, channelId },
    lastChannel: withKey(s.lastChannel, serverId, channelId),
  }));
}

export function openHome(home = 'friends') {
  setState({ view: { kind: 'home', home } });
}

export async function openDm(userId) {
  const existing = Object.values(getState().dms).find((d) => d.recipientId === userId);
  if (existing) { openHome(existing.id); return existing; }
  const dm = await attempt(() => call('dm:open', { userId }));
  setState((s) => ({ dms: withKey(s.dms, dm.id, { ...s.dms[dm.id], ...dm }) }));
  openHome(dm.id);
  return dm;
}

export function isViewing(channelId) {
  const { view } = getState();
  return (view.kind === 'server' && view.channelId === channelId) || (view.kind === 'home' && view.home === channelId);
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export async function loadMessages(channelId) {
  const bucket = getState().messages[channelId];
  if (bucket?.loaded || bucket?.loading) return;
  setState((s) => ({ messages: withKey(s.messages, channelId, { list: [], hasMore: true, loaded: false, loading: true }) }));
  try {
    const list = await call('messages:fetch', { channelId, limit: 50 });
    setState((s) => {
      const pending = (s.messages[channelId]?.list || []).filter((m) => m.pending || m.failed);
      const live = (s.messages[channelId]?.list || []).filter((m) => !m.pending && !m.failed && !list.some((x) => x.id === m.id));
      return { messages: withKey(s.messages, channelId, { list: [...list, ...live, ...pending], hasMore: list.length === 50, loaded: true, loading: false }) };
    });
  } catch (err) {
    setState((s) => ({ messages: withoutKey(s.messages, channelId) }));
    toast(err.message, 'error');
  }
}

export async function loadOlder(channelId) {
  const bucket = getState().messages[channelId];
  if (!bucket?.loaded || bucket.loadingOlder || !bucket.hasMore) return;
  const first = bucket.list.find((m) => !m.pending);
  if (!first) return;
  setState((s) => ({ messages: withKey(s.messages, channelId, { ...s.messages[channelId], loadingOlder: true }) }));
  try {
    const older = await call('messages:fetch', { channelId, before: first.id, limit: 50 });
    setState((s) => {
      const b = s.messages[channelId];
      if (!b) return null;
      return { messages: withKey(s.messages, channelId, { ...b, list: [...older, ...b.list], hasMore: older.length === 50, loadingOlder: false }) };
    });
  } catch {
    setState((s) => ({ messages: withKey(s.messages, channelId, { ...s.messages[channelId], loadingOlder: false }) }));
  }
}

function appendMessage(s, m) {
  const bucket = s.messages[m.channelId];
  if (!bucket) return s.messages;
  let list = bucket.list;
  if (m.nonce && list.some((x) => x.id === m.nonce)) list = list.map((x) => (x.id === m.nonce ? m : x));
  else if (list.some((x) => x.id === m.id)) return s.messages;
  else list = [...list, m];
  return withKey(s.messages, m.channelId, { ...bucket, list });
}

function mentionsMe(content, me) {
  if (!content || !me) return false;
  return new RegExp(`(^|\\W)@(${me.username}|everyone)(?![\\w.])`, 'i').test(content);
}

function onMessageNew(m) {
  const s = getState();
  const me = s.me;
  const own = m.authorId === me?.id;
  const isDm = Boolean(s.dms[m.channelId]);
  const viewing = isViewing(m.channelId) && document.hasFocus();

  setState((st) => {
    const patch = { messages: appendMessage(st, m) };
    if (isDm) {
      patch.dms = withKey(st.dms, m.channelId, { ...st.dms[m.channelId], lastMessageAt: m.createdAt, lastMessageId: m.id });
    } else if (st.channels[m.channelId]) {
      patch.channels = withKey(st.channels, m.channelId, { ...st.channels[m.channelId], lastMessageId: m.id });
    }
    const typers = st.typing[m.channelId];
    if (typers?.[m.authorId]) patch.typing = withKey(st.typing, m.channelId, withoutKey(typers, m.authorId));
    if (own || viewing) {
      patch.readStates = withKey(st.readStates, m.channelId, m.id);
    } else {
      if (isDm) patch.unreadDm = withKey(st.unreadDm, m.channelId, (st.unreadDm[m.channelId] || 0) + 1);
      else if (mentionsMe(m.content, me)) patch.mentions = withKey(st.mentions, m.channelId, (st.mentions[m.channelId] || 0) + 1);
    }
    return patch;
  });

  if (own) return;
  if (viewing) { markRead(m.channelId, m.id); return; }
  if (m.kind !== 'default') return;
  const important = isDm || mentionsMe(m.content, me);
  if (important && me.status !== 'dnd') {
    playSound('message');
    const author = s.users[m.authorId];
    const channel = s.channels[m.channelId];
    const server = channel ? s.servers[channel.serverId] : null;
    const title = isDm ? displayName(author) : `${displayName(author)} in #${channel?.name} (${server?.name})`;
    const body = m.content || (m.attachments.length ? 'Sent an attachment' : '');
    notify(title, body, () => (isDm ? openHome(m.channelId) : selectChannel(channel.serverId, channel.id)));
    native?.flash?.();
  }
  updateBadge();
}

export function markRead(channelId, messageId) {
  const s = getState();
  if (!messageId || (s.readStates[channelId] || '') >= messageId) {
    if (s.unreadDm[channelId] || s.mentions[channelId]) {
      setState((st) => ({ unreadDm: withKey(st.unreadDm, channelId, 0), mentions: withKey(st.mentions, channelId, 0) }));
      updateBadge();
    }
    return;
  }
  setState((st) => ({
    readStates: withKey(st.readStates, channelId, messageId),
    unreadDm: withKey(st.unreadDm, channelId, 0),
    mentions: withKey(st.mentions, channelId, 0),
  }));
  call('read', { channelId, messageId }).catch(() => {});
  updateBadge();
}

export function sendMessage(channelId, { content = '', attachments = [], replyTo = null }) {
  const me = getState().me;
  const id = nonce();
  const pending = {
    id, nonce: id, channelId, authorId: me.id, content, attachments, kind: 'default', pending: true,
    replyTo: replyTo ? { id: replyTo.id, authorId: replyTo.authorId, content: replyTo.content } : null,
    createdAt: Date.now(),
  };
  setState((s) => ({ messages: appendMessage(s, pending) }));
  call('message:send', { channelId, content, attachments, replyTo: replyTo?.id, nonce: id })
    .then((m) => setState((s) => ({ messages: appendMessage(s, { ...m, nonce: id }) })))
    .catch((err) => {
      setState((s) => {
        const b = s.messages[channelId];
        if (!b) return null;
        return { messages: withKey(s.messages, channelId, { ...b, list: b.list.map((x) => (x.id === id ? { ...x, pending: false, failed: true } : x)) }) };
      });
      toast(err.message, 'error');
    });
}

export function retryMessage(m) {
  setState((s) => {
    const b = s.messages[m.channelId];
    return { messages: withKey(s.messages, m.channelId, { ...b, list: b.list.filter((x) => x.id !== m.id) }) };
  });
  sendMessage(m.channelId, { content: m.content, attachments: m.attachments });
}

export function discardMessage(m) {
  setState((s) => {
    const b = s.messages[m.channelId];
    return { messages: withKey(s.messages, m.channelId, { ...b, list: b.list.filter((x) => x.id !== m.id) }) };
  });
}

export const editMessage = (messageId, content) => attempt(() => call('message:edit', { messageId, content }));
export const deleteMessage = (messageId) => attempt(() => call('message:delete', { messageId }));

const lastTyping = {};
export function sendTyping(channelId) {
  const t = Date.now();
  if (lastTyping[channelId] && t - lastTyping[channelId] < 6000) return;
  lastTyping[channelId] = t;
  call('typing', { channelId }).catch(() => {});
}
export function stopTyping(channelId) {
  delete lastTyping[channelId];
}

/* ------------------------------------------------------------------ */
/* Servers & channels                                                  */
/* ------------------------------------------------------------------ */

export async function createServer(name, icon) {
  const server = await call('server:create', { name, icon });
  selectServer(server.id);
  return server;
}

export const previewInvite = (code) => call('server:preview', { code });

export async function joinServer(code) {
  const server = await call('server:join', { code });
  await new Promise((r) => setTimeout(r, 30));
  selectServer(server.id);
  return server;
}

export const updateServer = (serverId, patch) => attempt(() => call('server:update', { serverId, ...patch }), { success: 'Saved' });
export const resetInvite = (serverId) => attempt(() => call('server:invite_reset', { serverId }));
export const deleteServer = (serverId) => attempt(() => call('server:delete', { serverId }));
export const leaveServer = (serverId) => attempt(() => call('server:leave', { serverId }));
export const kickMember = (serverId, userId) => attempt(() => call('server:kick', { serverId, userId }));
export const setMemberRole = (serverId, userId, role) => attempt(() => call('member:role', { serverId, userId, role }));
export const setNickname = (serverId, nickname) => attempt(() => call('member:nickname', { serverId, nickname }), { success: 'Nickname updated' });
export const transferServer = (serverId, userId) => attempt(() => call('server:transfer', { serverId, userId }), { success: 'Ownership transferred' });
export const createChannel = (serverId, name, type) => attempt(() => call('channel:create', { serverId, name, type }));
export const updateChannel = (channelId, patch) => attempt(() => call('channel:update', { channelId, ...patch }));
export const deleteChannel = (channelId) => attempt(() => call('channel:delete', { channelId }));
export const reorderChannels = (serverId, order) => attempt(() => call('channel:reorder', { serverId, order }));

/* ------------------------------------------------------------------ */
/* Profile, friends                                                    */
/* ------------------------------------------------------------------ */

export const updateProfile = (patch) => call('user:update', patch);
export const setStatus = (status) => attempt(() => call('user:update', { status }));
export const updateAccount = (patch) => call('account:update', patch);
export const fetchProfile = (userId) => call('user:fetch', { userId });

export const sendFriendRequest = (username) => call('friend:request', { username });
export const addFriendById = (userId) => attempt(() => call('friend:request', { userId }), { success: 'Friend request sent' });
export const acceptFriend = (userId) => attempt(() => call('friend:accept', { userId }));
export const removeFriend = (userId) => attempt(() => call('friend:remove', { userId }));
export const blockUser = (userId) => attempt(() => call('user:block', { userId }));
export const unblockUser = (userId) => attempt(() => call('user:unblock', { userId }));

/* ------------------------------------------------------------------ */
/* Voice & calls                                                       */
/* ------------------------------------------------------------------ */

let lastRoomStates = {};

function onVoiceUpdate({ roomId, states }) {
  const s = getState();
  const me = s.me?.id;
  const prev = lastRoomStates[roomId] || s.voice[roomId] || [];
  lastRoomStates[roomId] = states;
  setState((st) => ({ voice: states.length ? withKey(st.voice, roomId, states) : withoutKey(st.voice, roomId) }));

  if (voice.roomId === roomId) {
    const before = new Set(prev.map((p) => p.userId));
    const after = new Set(states.map((p) => p.userId));
    if (before.has(me) && after.has(me)) {
      for (const id of after) if (!before.has(id) && id !== me) playSound('join');
      for (const id of before) if (!after.has(id) && id !== me) playSound('leave');
    }
    voice.onRoomUpdate(roomId, states);
  }

  if (s.incomingCall?.roomId === roomId && (states.some((p) => p.userId === me) || !states.length)) clearIncoming(roomId);
  syncCallingLoop();
}

function syncCallingLoop() {
  const s = getState();
  const roomId = voice.roomId;
  const inDmCall = roomId && s.dms[roomId];
  const alone = inDmCall && (s.voice[roomId] || []).every((p) => p.userId === s.me?.id);
  if (alone) startLoop('calling');
  else stopLoop('calling');
}

let ringTimer = null;

function onCallRing({ roomId, callerId }) {
  const s = getState();
  if (voice.roomId === roomId) return;
  setState({ incomingCall: { roomId, callerId, at: Date.now() } });
  if (s.me?.status !== 'dnd') {
    startLoop('ringtone');
    notify('Incoming call', `${displayName(s.users[callerId])} is calling you`, () => openHome(roomId));
    native?.flash?.();
  }
  clearTimeout(ringTimer);
  ringTimer = setTimeout(() => clearIncoming(roomId), 45000);
}

function clearIncoming(roomId) {
  const cur = getState().incomingCall;
  if (cur && (!roomId || cur.roomId === roomId)) {
    setState({ incomingCall: null });
    stopLoop('ringtone');
    clearTimeout(ringTimer);
  }
  syncCallingLoop();
}

export async function joinVoice(roomId) {
  try {
    await voice.join(roomId);
    syncCallingLoop();
    if (voice.micError === 'denied') toast('Microphone access was blocked. You joined listen-only.', 'error');
  } catch (err) {
    toast(err.message || 'Could not join voice', 'error');
  }
}

export function leaveVoice() {
  voice.leave();
  stopLoop('calling');
}

export async function startCall(dmId, { video = false } = {}) {
  openHome(dmId);
  await joinVoice(dmId);
  if (video && voice.roomId === dmId) voice.startCamera().catch((e) => toast(e.message, 'error'));
}

export async function acceptCall() {
  const cur = getState().incomingCall;
  if (!cur) return;
  clearIncoming(cur.roomId);
  openHome(cur.roomId);
  await joinVoice(cur.roomId);
}

export function declineCall() {
  const cur = getState().incomingCall;
  if (!cur) return;
  clearIncoming(cur.roomId);
  call('call:decline', { roomId: cur.roomId }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Notifications, badge, activity                                      */
/* ------------------------------------------------------------------ */

function notify(title, body, onClick) {
  const { settings } = getState();
  if (!settings.desktopNotifications || document.hasFocus()) return;
  if (!('Notification' in window)) return;
  const show = () => {
    const n = new Notification(title, { body: body.slice(0, 180), silent: true, icon: './icon.png' });
    n.onclick = () => { native?.focus?.(); window.focus(); onClick?.(); };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && show());
}

function drawBadge(count) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#f04a5d';
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${count > 9 ? 16 : 20}px Segoe UI, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(count > 99 ? '99+' : String(count), 16, 17);
  return c.toDataURL();
}

let lastBadge = -1;
export function updateBadge() {
  const s = getState();
  const count = Object.values(s.unreadDm).reduce((a, b) => a + b, 0) + Object.values(s.mentions).reduce((a, b) => a + b, 0)
    + Object.values(s.relationships).filter((t) => t === 'incoming').length;
  if (count === lastBadge) return;
  lastBadge = count;
  document.title = count ? `(${count}) Bliscord` : 'Bliscord';
  native?.setBadge?.(count ? drawBadge(count) : null, count);
}

let activityTracking = false;
function setupActivityTracking() {
  if (activityTracking) return;
  activityTracking = true;
  let idle = false;
  const setIdle = (value) => {
    if (idle === value) return;
    idle = value;
    if (getSocket()?.connected) call('presence:idle', { idle }).catch(() => {});
  };
  if (native?.onIdle) {
    native.onIdle(setIdle);
    return;
  }
  let last = Date.now();
  const bump = () => { last = Date.now(); setIdle(false); };
  window.addEventListener('mousemove', bump, { passive: true });
  window.addEventListener('keydown', bump);
  setInterval(() => { if (Date.now() - last > 10 * 60 * 1000) setIdle(true); }, 30000);
}
