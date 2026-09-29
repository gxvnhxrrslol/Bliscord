import crypto from 'node:crypto';

// ICE (STUN/TURN) configuration handed to clients so calls connect across
// networks and countries. STUN alone works for most home connections; a TURN
// relay is needed for strict NATs, corporate networks and mobile carriers.
//
// Supported environment variables (use any one TURN option):
//   TURN_URLS          comma separated, e.g. "turn:turn.example.com:3478,turns:turn.example.com:5349"
//   TURN_USERNAME      static username
//   TURN_CREDENTIAL    static password
//   TURN_SECRET        coturn "use-auth-secret" shared secret (generates short-lived credentials)
//   METERED_DOMAIN     e.g. "yourapp.metered.live"
//   METERED_API_KEY    Metered TURN API key
//   CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN   Cloudflare Realtime TURN

const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

let remoteCache = { at: 0, servers: null };

async function fetchRemote() {
  if (remoteCache.servers && Date.now() - remoteCache.at < 30 * 60 * 1000) return remoteCache.servers;
  let servers = null;
  try {
    if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
      const r = await fetch(`https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`);
      if (r.ok) servers = await r.json();
    } else if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      });
      if (r.ok) {
        const body = await r.json();
        servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
      }
    }
  } catch (err) {
    console.warn('[ice] TURN credential fetch failed:', err.message);
  }
  if (servers) remoteCache = { at: Date.now(), servers };
  return servers || remoteCache.servers;
}

export async function getIceServers(userId) {
  const list = [...STUN];
  const urls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:${userId}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    list.push({ urls, username, credential });
  } else if (urls.length) {
    list.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  const remote = await fetchRemote();
  if (remote) list.push(...remote);
  return list;
}

export function turnConfigured() {
  return Boolean(process.env.TURN_URLS || process.env.METERED_API_KEY || process.env.CLOUDFLARE_TURN_KEY_ID);
}
