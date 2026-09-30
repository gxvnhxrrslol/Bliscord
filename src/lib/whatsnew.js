import CHANGELOG from '../changelog.json';
import { native } from './api';
import { openModal } from './actions';

const LAST_SEEN_KEY = 'bliscord.lastSeenVersion';
const SEEN_NEWS_KEY = 'bliscord.seenNews';

export const APP_VERSION = native?.version || __APP_VERSION__;
export { CHANGELOG };

function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

/** Announcements published in news.json on GitHub: [{ id, date, title, body }]. */
async function fetchNews() {
  const url = native?.config?.newsUrl;
  if (!url) return [];
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github.raw+json' },
      signal: AbortSignal.timeout(5000),
    });
    const list = res.ok ? await res.json() : [];
    return Array.isArray(list) ? list.filter((n) => n && n.id && n.title) : [];
  } catch {
    return [];
  }
}

let checked = false;

/** After launch, show what changed since the last version this person saw, plus any unread news. */
export async function checkWhatsNew() {
  if (checked) return;
  checked = true;

  let lastSeen = read(LAST_SEEN_KEY, null);
  if (!lastSeen) {
    // Before 1.1.0 nothing was recorded: existing users were on 1.0.0, new installs see nothing.
    let existing = false;
    try { existing = Boolean(localStorage.getItem('bliscord.settings')); } catch { /* ignore */ }
    lastSeen = existing ? '1.0.0' : APP_VERSION;
  }
  const entries = CHANGELOG.filter((e) => cmp(e.version, lastSeen) > 0 && cmp(e.version, APP_VERSION) <= 0);
  write(LAST_SEEN_KEY, APP_VERSION);

  const seen = new Set(read(SEEN_NEWS_KEY, []));
  const news = (await fetchNews()).filter((n) => !seen.has(n.id));
  write(SEEN_NEWS_KEY, [...seen, ...news.map((n) => n.id)].slice(-200));

  if (entries.length || news.length) openModal('whatsNew', { entries, news });
}

export function showChangelog() {
  openModal('whatsNew', { entries: CHANGELOG, news: [] });
}
