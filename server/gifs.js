// GIF search through KLIPY (the successor to the Tenor API).
// The API key comes from KLIPY_API_KEY or a klipy-key.txt file in the data folder,
// so it never ships inside the client.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './db.js';

const KEY_FILE = path.join(DATA_DIR, 'klipy-key.txt');
const API = process.env.KLIPY_API_BASE || 'https://api.klipy.com/api/v1';

let keyCache = { value: '', checkedAt: 0 };
export function klipyKey() {
  if (process.env.KLIPY_API_KEY) return process.env.KLIPY_API_KEY.trim();
  if (Date.now() - keyCache.checkedAt > 30_000) {
    let value = '';
    try { value = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { /* not set up */ }
    keyCache = { value, checkedAt: Date.now() };
  }
  return keyCache.value;
}

export const GIF_CATEGORIES = [
  'happy', 'sad', 'laugh', 'love', 'dance', 'hype', 'yes', 'no',
  'thank you', 'facepalm', 'clap', 'wow', 'angry', 'bruh', 'hug', 'confused',
  'good night', 'celebrate', 'shrug', 'cat', 'dog', 'anime', 'gaming', 'meme',
];

/** Picks the first variant that exists, e.g. file.md.gif, then file.sm.gif. */
function variant(file, sizes, formats) {
  for (const size of sizes) {
    for (const format of formats) {
      const v = file?.[size]?.[format];
      if (v?.url) return v;
    }
  }
  return null;
}

function normalize(item) {
  if (!item || typeof item !== 'object' || item.type === 'ad' || !item.file) return null;
  const full = variant(item.file, ['md', 'hd', 'sm'], ['gif']);
  const preview = variant(item.file, ['sm', 'xs', 'md'], ['webp', 'gif']) || full;
  if (!full?.url) return null;
  return {
    id: String(item.id ?? item.slug ?? full.url),
    title: String(item.title || '').slice(0, 120),
    url: full.url,
    preview: preview.url,
    width: Number(full.width) || Number(preview.width) || 0,
    height: Number(full.height) || Number(preview.height) || 0,
  };
}

const cache = new Map();
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = fn().catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { value, expires: Date.now() + ttl });
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return value;
}

export class GifError extends Error {}

async function klipy(endpoint, params, customer) {
  const key = klipyKey();
  if (!key) throw new GifError('GIFs are not set up on this server');
  const url = new URL(`${API}/${encodeURIComponent(key)}/gifs/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  if (customer) url.searchParams.set('customer_id', customer);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.result === false) {
    const reason = [].concat(body?.errors?.message || []).join(' ');
    if (/key/i.test(reason) || res.status === 401 || res.status === 403) throw new GifError('The GIF API key was rejected');
    throw new GifError('GIF search is unavailable');
  }
  const list = Array.isArray(body?.data?.data) ? body.data.data : Array.isArray(body?.data) ? body.data : [];
  return { items: list.map(normalize).filter(Boolean), hasNext: Boolean(body?.data?.has_next) };
}

// A stable anonymous id per user so KLIPY can rank results without learning who anyone is.
const customerId = (uid) => crypto.createHash('sha256').update('bliscord:' + uid).digest('hex').slice(0, 32);

export function searchGifs(uid, query, page = 1) {
  const qs = String(query || '').trim().slice(0, 100).toLowerCase();
  const p = Math.min(Math.max(1, Number(page) || 1), 50);
  if (!qs) return trendingGifs(uid, p);
  return cached(`s:${qs}:${p}`, 10 * 60_000, () => klipy('search', { q: qs, page: p, per_page: 30, content_filter: 'medium' }, customerId(uid)));
}

export function trendingGifs(uid, page = 1) {
  const p = Math.min(Math.max(1, Number(page) || 1), 50);
  return cached(`t:${p}`, 10 * 60_000, () => klipy('trending', { page: p, per_page: 30, content_filter: 'medium' }, customerId(uid)));
}

export function gifCategories(uid) {
  return cached('categories', 6 * 60 * 60_000, async () => {
    const trending = await trendingGifs(uid, 1);
    const previews = await Promise.all(GIF_CATEGORIES.map((name) => searchGifs(uid, name, 1)
      .then((r) => r.items[0]?.preview || null)
      .catch(() => null)));
    return {
      trending: trending.items[0]?.preview || null,
      categories: GIF_CATEGORIES.map((name, i) => ({ name, preview: previews[i] })),
    };
  });
}

