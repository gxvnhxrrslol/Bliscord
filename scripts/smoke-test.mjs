// End-to-end check of the realtime API with two simulated users.
// Usage: node scripts/smoke-test.mjs [serverUrl]
import { io } from 'socket.io-client';

const URL = process.argv[2] || 'http://localhost:3000';
const stamp = Date.now().toString(36);
let failures = 0;

function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

async function post(path, body) {
  const r = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, transports: ['websocket'] });
    s.once('ready', (data) => resolve({ s, ready: data }));
    s.once('connect_error', reject);
  });
}

const call = (s, event, payload) => new Promise((resolve, reject) => {
  s.timeout(5000).emit(event, payload, (err, res) => (err ? reject(err) : res.ok ? resolve(res.data) : reject(new Error(res.error))));
});

const next = (s, event, filter = () => true) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 5000);
  const h = (data) => { if (filter(data)) { clearTimeout(t); s.off(event, h); resolve(data); } };
  s.on(event, h);
});

async function main() {
  const a = await post('/api/auth/register', { username: `alice_${stamp}`, displayName: 'Alice', email: `a_${stamp}@test.dev`, password: 'password123' });
  const b = await post('/api/auth/register', { username: `bob_${stamp}`, displayName: 'Bob', email: `b_${stamp}@test.dev`, password: 'password123' });
  check('register two accounts', a.token && b.token);

  const login = await post('/api/auth/login', { login: `alice_${stamp}`, password: 'password123' });
  check('login with username', Boolean(login.token));

  const A = await connect(a.token);
  const B = await connect(b.token);
  check('ready payload', A.ready.user.username === `alice_${stamp}`);

  const bobGetsRequest = next(B.s, 'relationship:update', (r) => r.type === 'incoming');
  await call(A.s, 'friend:request', { username: `bob_${stamp}` });
  check('friend request delivered live', (await bobGetsRequest).id === A.ready.user.id);

  const aliceSeesFriend = next(A.s, 'relationship:update', (r) => r.type === 'friend');
  await call(B.s, 'friend:accept', { userId: A.ready.user.id });
  check('friend accept delivered live', (await aliceSeesFriend).type === 'friend');

  const dm = await call(A.s, 'dm:open', { userId: B.ready.user.id });
  const bobGetsDm = next(B.s, 'message:new', (m) => m.channelId === dm.id);
  await call(A.s, 'message:send', { channelId: dm.id, content: 'hello **bob**', nonce: 'n1' });
  check('direct message delivered live', (await bobGetsDm).content === 'hello **bob**');

  const typing = next(B.s, 'typing', (t) => t.channelId === dm.id);
  await call(A.s, 'typing', { channelId: dm.id });
  check('typing indicator', (await typing).userId === A.ready.user.id);

  const server = await call(A.s, 'server:create', { name: 'Test Server' });
  check('server created with categories and channels', server.channels.length === 4 && server.channels.some((c) => c.type === 'category'));
  const preview = await call(B.s, 'server:preview', { code: server.inviteCode });
  check('invite preview', preview.name === 'Test Server' && preview.memberCount === 1);

  const bobGetsServer = next(B.s, 'server:sync');
  const aliceSeesJoin = next(A.s, 'server:member_add');
  await call(B.s, 'server:join', { code: server.inviteCode });
  check('join delivers server to joiner', (await bobGetsServer).server.id === server.id);
  check('join announced to members', (await aliceSeesJoin).user.id === B.ready.user.id);

  const text = server.channels.find((c) => c.type === 'text');
  const voiceCh = server.channels.find((c) => c.type === 'voice');
  const bobGetsChannelMsg = next(B.s, 'message:new', (m) => m.channelId === text.id && m.kind === 'default');
  const sent = await call(A.s, 'message:send', { channelId: text.id, content: 'welcome' });
  check('channel message delivered live', (await bobGetsChannelMsg).id === sent.id);

  const edited = next(B.s, 'message:update');
  await call(A.s, 'message:edit', { messageId: sent.id, content: 'welcome!' });
  check('edit delivered live', (await edited).content === 'welcome!');

  const history = await call(B.s, 'messages:fetch', { channelId: text.id });
  check('history fetch', history.some((m) => m.id === sent.id));

  const profile = next(B.s, 'user:update', (u) => u.id === A.ready.user.id && u.bio === 'hi there');
  await call(A.s, 'user:update', { bio: 'hi there', customStatus: 'testing' });
  check('profile update delivered live', (await profile).customStatus === 'testing');

  const vj = await call(A.s, 'voice:join', { roomId: voiceCh.id });
  check('voice join returns ICE servers', vj.iceServers.length > 0);
  const aliceSeesBob = next(A.s, 'voice:update', (v) => v.states.length === 2);
  const vj2 = await call(B.s, 'voice:join', { roomId: voiceCh.id });
  check('second participant sees first', vj2.participants.length === 1);
  await aliceSeesBob;
  const signal = next(A.s, 'rtc:signal');
  await call(B.s, 'rtc:signal', { to: A.ready.user.id, data: { description: { type: 'offer', sdp: 'x' } } });
  check('WebRTC signal relayed', (await signal).from === B.ready.user.id);

  const ring = next(B.s, 'call:ring');
  await call(A.s, 'voice:join', { roomId: dm.id });
  check('DM call rings the recipient', (await ring).roomId === dm.id);
  const declined = next(A.s, 'call:declined');
  await call(B.s, 'call:decline', { roomId: dm.id });
  check('decline delivered', (await declined).userId === B.ready.user.id);

  // ---- Roles & permissions ----
  const role = await call(A.s, 'role:create', { serverId: server.id });
  await call(A.s, 'role:update', { roleId: role.id, name: 'Mods', color: '#ff5c7a', hoist: true, mentionable: true });
  const bobRoles = next(B.s, 'server:member_update', (u) => u.member.userId === B.ready.user.id && u.member.roles.includes(role.id));
  await call(A.s, 'member:roles', { serverId: server.id, userId: B.ready.user.id, roleIds: [role.id] });
  check('role assigned live', Boolean(await bobRoles));

  const bobSync1 = next(B.s, 'server:sync');
  const staff = await call(A.s, 'channel:create', { serverId: server.id, name: 'staff', type: 'text', private: true });
  const view1 = (await bobSync1).server.channels.map((c) => c.id);
  check('private channel hidden from others', !view1.includes(staff.id));
  let denied = false;
  try { await call(B.s, 'messages:fetch', { channelId: staff.id }); } catch { denied = true; }
  check('private channel history blocked', denied);

  const bobSync2 = next(B.s, 'server:sync');
  await call(A.s, 'channel:permissions', { channelId: staff.id, overwrites: [
    { id: server.id, type: 'role', allow: 0, deny: 1 },
    { id: role.id, type: 'role', allow: 1, deny: 0 },
  ] });
  check('role gets access to private channel', (await bobSync2).server.channels.some((c) => c.id === staff.id));

  const news = await call(A.s, 'channel:create', { serverId: server.id, name: 'announcements', type: 'announcement' });
  let blocked = false;
  try { await call(B.s, 'message:send', { channelId: news.id, content: 'hi' }); } catch { blocked = true; }
  check('announcement channel blocks members', blocked);
  await call(A.s, 'message:send', { channelId: news.id, content: 'update!' });
  check('owner can post announcements', true);

  const mentionMsg = next(B.s, 'message:new', (m) => m.content.startsWith('@Mods'));
  await call(A.s, 'message:send', { channelId: text.id, content: '@Mods please check' });
  check('role mention delivered', ((await mentionMsg).mentions.roles || []).includes(role.id));

  let noKick = false;
  try { await call(B.s, 'server:kick', { serverId: server.id, userId: A.ready.user.id }); } catch { noKick = true; }
  check('members cannot kick the owner', noKick);

  const bobRemoved = next(B.s, 'server:remove');
  await call(A.s, 'server:ban', { serverId: server.id, userId: B.ready.user.id, reason: 'test' });
  await bobRemoved;
  let banned = false;
  try { await call(B.s, 'server:join', { code: server.inviteCode }); } catch { banned = true; }
  check('banned user cannot rejoin', banned);
  await call(A.s, 'server:unban', { serverId: server.id, userId: B.ready.user.id });
  await call(B.s, 'server:join', { code: server.inviteCode });
  check('unbanned user can rejoin', true);

  const left = next(A.s, 'server:member_remove');
  await call(B.s, 'server:leave', { serverId: server.id });
  check('leave announced', (await left).userId === B.ready.user.id);

  A.s.disconnect();
  B.s.disconnect();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL ', err.message);
  process.exit(1);
});
