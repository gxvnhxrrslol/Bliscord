// Seeds a local development server with two demo accounts, a friendship,
// a server with channels and some message history.
// Usage: node scripts/seed-dev.mjs [serverUrl]
// Demo logins: nova / bliscord-dev   and   atlas / bliscord-dev
import { io } from 'socket.io-client';

const URL = process.argv[2] || 'http://localhost:3000';
const PASSWORD = 'bliscord-dev';

async function post(path, body) {
  const r = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}

async function account(username, displayName) {
  try {
    return (await post('/api/auth/register', { username, displayName, email: `${username}@bliscord.test`, password: PASSWORD })).token;
  } catch {
    return (await post('/api/auth/login', { login: username, password: PASSWORD })).token;
  }
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, transports: ['websocket'] });
    s.once('ready', (ready) => resolve({ s, ready }));
    s.once('connect_error', reject);
  });
}

const call = (s, event, payload) => new Promise((resolve, reject) => {
  s.timeout(5000).emit(event, payload, (err, res) => (err ? reject(err) : res.ok ? resolve(res.data) : reject(new Error(res.error))));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const nova = await connect(await account('nova', 'Nova'));
  const atlas = await connect(await account('atlas', 'Atlas'));
  const novaId = nova.ready.user.id;
  const atlasId = atlas.ready.user.id;

  await call(nova.s, 'user:update', { bio: 'Building things at night.\nCoffee, synthwave, pixel art.', customStatus: 'shipping Bliscord', pronouns: 'they/them', bannerColor: '#4f7cff' });
  await call(atlas.s, 'user:update', { bio: 'Map nerd. Always up for a call.', customStatus: 'exploring', bannerColor: '#1fc7a8' });

  if (!nova.ready.relationships.some((r) => r.id === atlasId && r.type === 'friend')) {
    await call(nova.s, 'friend:request', { username: 'atlas' }).catch(() => {});
    await call(atlas.s, 'friend:accept', { userId: novaId }).catch(() => {});
  }

  let server = nova.ready.servers.find((s) => s.name === 'Bliscord HQ');
  if (!server) {
    server = await call(nova.s, 'server:create', { name: 'Bliscord HQ' });
    await call(nova.s, 'channel:create', { serverId: server.id, name: 'announcements', type: 'text' });
    await call(nova.s, 'channel:create', { serverId: server.id, name: 'Gaming', type: 'voice' });
    await call(atlas.s, 'server:join', { code: server.inviteCode });
    const general = server.channels.find((c) => c.type === 'text');
    await call(nova.s, 'channel:update', { channelId: general.id, topic: 'Say hi and hang out' });
    const lines = [
      [nova, 'Welcome to **Bliscord HQ**'],
      [atlas, 'this looks so clean'],
      [atlas, 'the new dock is really nice'],
      [nova, 'Try the `Liquid Glass` theme in Settings > Appearance'],
      [atlas, '@nova calls work from here to Toronto too?'],
      [nova, 'Yep, as long as the server has a TURN relay set up for strict networks.'],
    ];
    for (const [who, content] of lines) {
      await call(who.s, 'message:send', { channelId: general.id, content });
      await wait(40);
    }
  }

  const dm = await call(nova.s, 'dm:open', { userId: atlasId });
  const history = await call(nova.s, 'messages:fetch', { channelId: dm.id });
  if (!history.length) {
    await call(atlas.s, 'message:send', { channelId: dm.id, content: 'hey! call later?' });
    await call(nova.s, 'message:send', { channelId: dm.id, content: 'for sure, ping me' });
  }

  console.log('Seeded. Log in as nova or atlas with password', PASSWORD);
  nova.s.disconnect();
  atlas.s.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
