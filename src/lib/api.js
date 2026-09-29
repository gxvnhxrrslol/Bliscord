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

export function defaultServerUrl() {
  if (native?.config?.serverUrl) return native.config.serverUrl;
  if (location.protocol.startsWith('http') && !import.meta.env.DEV) return location.origin;
  return 'http://localhost:3000';
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

async function post(path, body, token) {
  let res;
  try {
    res = await fetch(getServerUrl() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error('Could not reach the server');
  }
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
