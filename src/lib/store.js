import { useRef, useSyncExternalStore } from 'react';

const SETTINGS_KEY = 'bliscord.settings';

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: '#4f7cff',
  glassScene: 'aurora',
  density: 'cozy',
  fontScale: 100,
  reduceMotion: false,
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  videoDeviceId: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  inputSensitivity: 0.02,
  outputVolume: 100,
  userVolumes: {},
  soundsEnabled: true,
  desktopNotifications: true,
  closeToTray: true,
  screenQuality: '1080p30',
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function initialState() {
  return {
    status: 'boot',
    connection: 'connecting',
    me: null,
    users: {},
    servers: {},
    serverOrder: [],
    channels: {},
    members: {},
    dms: {},
    relationships: {},
    messages: {},
    readStates: {},
    unreadDm: {},
    mentions: {},
    typing: {},
    replying: {},
    editing: null,
    voice: {},
    view: { kind: 'home', serverId: null, channelId: null, home: 'friends' },
    lastChannel: {},
    showMembers: true,
    modals: [],
    popout: null,
    menu: null,
    toasts: [],
    incomingCall: null,
    update: null,
    ping: null,
    settings: loadSettings(),
  };
}

let state = initialState();
const listeners = new Set();

export const getState = () => state;

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next) return;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function resetState() {
  const settings = state.settings;
  state = { ...initialState(), settings, status: 'auth' };
  for (const l of listeners) l();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

const EMPTY = Symbol('empty');

/** Subscribe to a slice of state. Selectors may return new objects/arrays; results are compared shallowly. */
export function useStore(selector) {
  const last = useRef(EMPTY);
  const getSnapshot = () => {
    const next = selector(state);
    if (last.current !== EMPTY && shallowEqual(last.current, next)) return last.current;
    last.current = next;
    return next;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function updateSettings(patch) {
  const settings = { ...state.settings, ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  setState({ settings });
}

/* ---------- small immutable helpers ---------- */

export const withKey = (obj, key, value) => ({ ...obj, [key]: value });
export function withoutKey(obj, key) {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}
