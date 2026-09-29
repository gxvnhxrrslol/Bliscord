import { getState } from './store';

// Sound files live in public/sounds. If a file is missing the app falls back
// to a synthesized tone so nothing breaks.
const FILES = {
  ringtone: './sounds/ringtone.mp3',
  calling: './sounds/calling.mp3',
  message: './sounds/notification.mp3',
};

let ctx = null;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freqs, { duration = 0.12, gap = 0.02, type = 'sine', volume = 0.12, attack = 0.008 } = {}) {
  const c = audioCtx();
  let t = c.currentTime + 0.01;
  for (const f of freqs) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    t += duration + gap;
  }
}

const SYNTH = {
  message: () => tone([880, 1318.5], { duration: 0.14, volume: 0.09 }),
  join: () => tone([523.25, 783.99], { duration: 0.1, volume: 0.08 }),
  leave: () => tone([783.99, 523.25], { duration: 0.1, volume: 0.08 }),
  mute: () => tone([392], { duration: 0.08, volume: 0.07, type: 'triangle' }),
  unmute: () => tone([587.33], { duration: 0.08, volume: 0.07, type: 'triangle' }),
  deafen: () => tone([440, 293.66], { duration: 0.08, volume: 0.07, type: 'triangle' }),
  undeafen: () => tone([293.66, 440], { duration: 0.08, volume: 0.07, type: 'triangle' }),
  ringtone: () => tone([659.25, 830.61, 987.77, 830.61], { duration: 0.16, gap: 0.04, volume: 0.1 }),
  calling: () => tone([440, 554.37], { duration: 0.35, gap: 0.1, volume: 0.06 }),
};

const available = {};
async function probe(name) {
  if (name in available) return available[name];
  available[name] = await new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'auto';
    a.oncanplaythrough = () => resolve(true);
    a.onerror = () => resolve(false);
    a.src = FILES[name];
    setTimeout(() => resolve(false), 3000);
  });
  return available[name];
}

function applySink(el) {
  const id = getState().settings.outputDeviceId;
  if (id && id !== 'default' && el.setSinkId) el.setSinkId(id).catch(() => {});
}

export function playSound(name) {
  const { settings } = getState();
  if (!settings.soundsEnabled) return;
  if (FILES[name]) {
    probe(name).then((ok) => {
      if (!ok) return SYNTH[name]?.();
      const a = new Audio(FILES[name]);
      a.volume = 0.6;
      applySink(a);
      a.play().catch(() => SYNTH[name]?.());
    });
    return;
  }
  try { SYNTH[name]?.(); } catch { /* audio unavailable */ }
}

const loops = {};

/** Start a looping sound (ringtone / outgoing call). Returns nothing; call stopLoop(name). */
export function startLoop(name) {
  if (loops[name]) return;
  const handle = { stopped: false };
  loops[name] = handle;
  probe(name).then((ok) => {
    if (handle.stopped) return;
    if (ok) {
      const a = new Audio(FILES[name]);
      a.loop = true;
      a.volume = name === 'ringtone' ? 0.7 : 0.45;
      applySink(a);
      a.play().catch(() => {});
      handle.audio = a;
    } else {
      const period = name === 'ringtone' ? 2200 : 3000;
      SYNTH[name]?.();
      handle.timer = setInterval(() => SYNTH[name]?.(), period);
    }
  });
}

export function stopLoop(name) {
  const handle = loops[name];
  if (!handle) return;
  handle.stopped = true;
  handle.audio?.pause();
  if (handle.timer) clearInterval(handle.timer);
  delete loops[name];
}
