import { io } from 'socket.io-client';

const SERVER_KEY = 'bliscord.serverUrl';
const TOKEN_KEY = 'bliscord.token';

export const native = typeof window !== 'undefined' ? window.bliscord : undefined;

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

const DISCOVERED_KEY = 'bliscord.discoveredUrl';

export function defaultServerUrl() {
  if (native?.config?.serverUrl) return native.config.serverUrl;
  if (location.protocol.startsWith('http') && !import.meta.env.DEV) return location.origin;
  if (native?.config?.discoveryUrl && safeGet(DISCOVERED_KEY)) return safeGet(DISCOVERED_KEY);
  return 'http://localhost:3000';
}

/**
 * When the server runs behind a tunnel whose address changes, its current
 * address is published as JSON ({ "url": ... }) at config.discoveryUrl.
 * Returns true when the address changed.
 */
export async function discoverServer() {
  const source = native?.config?.discoveryUrl;
  if (!source || native?.config?.serverUrl || safeGet(SERVER_KEY)) return false;
  try {
    const res = await fetch(source, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github.raw+json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const { url } = await res.json();
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
    const clean = url.replace(/\/+$/, '');
    if (clean === safeGet(DISCOVERED_KEY)) return false;
    safeSet(DISCOVERED_KEY, clean);
    return true;
  } catch {
    return false;
  }
}

export function getServerUrl() {
  return (safeGet(SERVER_KEY) || defaultServerUrl()).replace(/\/+$/, '');
}

export function setServerUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  safeSet(SERVER_KEY, clean && clean !== defaultServerUrl() ? clean : null);
}

export const getToken = () => safeGet(TOKEN_KEY);
export const setToken = (t) => safeSet(TOKEN_KEY, t);

export function assetUrl(path) {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return getServerUrl() + path;
}

async function post(path, body, token, retried = false) {
  let res;
  try {
    res = await fetch(getServerUrl() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
  } catch {
    if (!retried && (await discoverServer())) return post(path, body, token, true);
    throw new Error('Could not reach the server');
  }
  if (res.status >= 520 && !retried && (await discoverServer())) return post(path, body, token, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const authApi = {
  login: (login, password) => post('/api/auth/login', { login, password }),
  register: (fields) => post('/api/auth/register', fields),
  logout: (token) => post('/api/auth/logout', {}, token).catch(() => {}),
};

export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', getServerUrl() + '/api/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

let socket = null;

export function connectSocket(token) {
  socket?.disconnect();
  socket = io(getServerUrl(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000,
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export const getSocket = () => socket;

export function call(event, payload = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Not connected'));
    socket.timeout(timeout).emit(event, payload, (err, res) => {
      if (err) return reject(new Error('The server took too long to respond'));
      if (!res?.ok) return reject(new Error(res?.error || 'Something went wrong'));
      resolve(res.data);
    });
  });
}
