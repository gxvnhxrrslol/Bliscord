import { useSyncExternalStore } from 'react';
import { call, getSocket, native } from './api';
import { getState } from './store';
import { playSound } from './sounds';

export const SCREEN_QUALITY = {
  '720p30': { label: '720p', fps: 30, width: 1280, height: 720, bitrate: 2_500_000 },
  '1080p30': { label: '1080p', fps: 30, width: 1920, height: 1080, bitrate: 4_500_000 },
  '1080p60': { label: '1080p', fps: 60, width: 1920, height: 1080, bitrate: 8_000_000 },
  '1440p60': { label: '1440p', fps: 60, width: 2560, height: 1440, bitrate: 12_000_000 },
};

const CAMERA_BITRATE = 1_500_000;
const REMOTE_SPEAKING_THRESHOLD = 0.012;
const GATE_HOLD_MS = 280;

function rms(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

class VoiceEngine {
  constructor() {
    this.listeners = new Set();
    this.roomId = null;
    this.joining = false;
    this.joinedAt = null;
    this.muted = false;
    this.deafened = false;
    this.micError = null;
    this.graph = null;
    this.micStream = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.screenQuality = null;
    this.peers = new Map();
    this.speaking = new Set();
    this.iceServers = [];
    this.levelListeners = new Set();
    this.lastVoiceAt = 0;
    this.testing = false;
    this.loop = null;
    this.snapshot = this.makeSnapshot();
  }

  /* ---------------- subscription ---------------- */

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  makeSnapshot() {
    const remote = {};
    const peerStates = {};
    for (const [id, peer] of this.peers) {
      remote[id] = Object.fromEntries(peer.streams);
      peerStates[id] = peer.pc.connectionState;
    }
    return {
      roomId: this.roomId,
      joining: this.joining,
      joinedAt: this.joinedAt,
      muted: this.muted || Boolean(this.roomId && !this.micStream && !this.joining),
      deafened: this.deafened,
      micError: this.micError,
      cameraStream: this.cameraStream,
      screenStream: this.screenStream,
      speaking: new Set(this.speaking),
      remote,
      peerStates,
    };
  }

  emit() {
    this.snapshot = this.makeSnapshot();
    for (const l of this.listeners) l();
  }

  get myId() {
    return getState().me?.id;
  }

  /* ---------------- audio graph ---------------- */

  ensureGraph() {
    if (this.graph) {
      if (this.graph.ctx.state === 'suspended') this.graph.ctx.resume().catch(() => {});
      return this.graph;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const dest = ctx.createMediaStreamDestination();
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const inputGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    inputGain.connect(analyser);
    inputGain.connect(gate);
    gate.connect(dest);
    this.graph = { ctx, dest, gate, inputGain, analyser, source: null, buf: new Float32Array(1024) };
    this.sendStream = dest.stream;
    this.sendTrack = dest.stream.getAudioTracks()[0];
    return this.graph;
  }

  async acquireMic() {
    const s = getState().settings;
    const audio = {
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      channelCount: 1,
    };
    if (s.inputDeviceId && s.inputDeviceId !== 'default') audio.deviceId = { exact: s.inputDeviceId };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (err) {
      if (audio.deviceId) {
        delete audio.deviceId;
        try { return await navigator.mediaDevices.getUserMedia({ audio, video: false }); } catch { /* fall through */ }
      }
      this.micError = err?.name === 'NotAllowedError' ? 'denied' : 'unavailable';
      return null;
    }
  }

  async ensureMic() {
    const g = this.ensureGraph();
    if (this.micStream) return;
    const stream = await this.acquireMic();
    if (!stream) { this.emit(); return; }
    this.micError = null;
    this.micStream = stream;
    g.source = g.ctx.createMediaStreamSource(stream);
    g.source.connect(g.inputGain);
    this.startLoop();
  }

  releaseMic() {
    if (!this.micStream) return;
    this.micStream.getTracks().forEach((t) => t.stop());
    this.graph?.source?.disconnect();
    if (this.graph) this.graph.source = null;
    this.micStream = null;
  }

  /** Re-acquire the microphone after a device or processing change. The outgoing track stays the same. */
  async reloadMic() {
    if (!this.micStream) return;
    this.releaseMic();
    await this.ensureMic();
  }

  startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), 50);
  }

  stopLoop() {
    clearInterval(this.loop);
    this.loop = null;
  }

  tick() {
    const g = this.graph;
    if (!g) return;
    const threshold = getState().settings.inputSensitivity;
    const now = performance.now();
    const level = g.source ? rms(g.analyser, g.buf) : 0;
    for (const l of this.levelListeners) l(level, threshold);
    if (level > threshold) this.lastVoiceAt = now;
    const open = !this.muted && !this.deafened && now - this.lastVoiceAt < GATE_HOLD_MS;
    g.gate.gain.setTargetAtTime(open ? 1 : 0, g.ctx.currentTime, 0.015);

    const next = new Set();
    if (open && this.roomId && this.myId) next.add(this.myId);
    for (const [id, peer] of this.peers) {
      for (const a of peer.analysers.values()) {
        if (rms(a, g.buf) > REMOTE_SPEAKING_THRESHOLD) { next.add(id); break; }
      }
    }
    let changed = next.size !== this.speaking.size;
    if (!changed) for (const id of next) if (!this.speaking.has(id)) { changed = true; break; }
    if (changed) { this.speaking = next; this.emit(); }
    if (!this.roomId && !this.testing) this.stopLoop();
  }

  onLevel(fn) {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  async startTest() {
    this.testing = true;
    await this.ensureMic();
    this.startLoop();
  }

  stopTest() {
    this.testing = false;
    if (!this.roomId) this.releaseMic();
  }

  /* ---------------- room lifecycle ---------------- */

  async join(roomId) {
    if (this.roomId === roomId || this.joining) return;
    if (this.roomId) await this.leave({ silent: true });
    this.joining = true;
    this.roomId = roomId;
    this.emit();
    try {
      await this.ensureMic();
      this.startLoop();
      await this.connect(roomId);
      this.joinedAt = Date.now();
      playSound('join');
    } catch (err) {
      this.roomId = null;
      this.cleanupMedia();
      throw err;
    } finally {
      this.joining = false;
      this.emit();
    }
  }

  async connect(roomId) {
    const res = await call('voice:join', { roomId });
    if (this.roomId !== roomId) return;
    this.iceServers = res.iceServers || [];
    for (const p of res.participants) this.createPeer(p.userId);
    await this.pushState();
  }

  /** Called after the socket reconnects: rebuild all peer connections for the current room. */
  async rejoin() {
    if (!this.roomId) return;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    try {
      await this.connect(this.roomId);
    } catch {
      this.leave({ local: true });
    }
    this.emit();
  }

  leave({ silent = false, local = false } = {}) {
    if (!this.roomId) return;
    if (!local) getSocket()?.emit('voice:leave', {}, () => {});
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.cleanupMedia();
    this.roomId = null;
    this.joinedAt = null;
    this.speaking = new Set();
    if (!silent) playSound('leave');
    this.emit();
  }

  cleanupMedia() {
    this.stopCamera({ silent: true });
    this.stopScreen({ silent: true });
    if (!this.testing) this.releaseMic();
  }

  pushState() {
    if (!this.roomId) return Promise.resolve();
    return call('voice:state', {
      muted: this.muted || this.deafened || !this.micStream,
      deafened: this.deafened,
      video: Boolean(this.cameraStream),
      screen: Boolean(this.screenStream),
      cameraStreamId: this.cameraStream?.id || null,
      screenStreamId: this.screenStream?.id || null,
    }).catch(() => {});
  }

  /** Server says who is in our room; close connections to anyone who left. */
  onRoomUpdate(roomId, states) {
    if (roomId !== this.roomId) return;
    const present = new Set(states.map((s) => s.userId));
    for (const id of [...this.peers.keys()]) {
      if (!present.has(id)) this.closePeer(id);
    }
    this.emit();
  }

  /* ---------------- peers ---------------- */

  createPeer(userId) {
    if (this.peers.has(userId)) return this.peers.get(userId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 2, bundlePolicy: 'max-bundle' });
    const peer = {
      userId,
      pc,
      polite: String(this.myId) < String(userId),
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      streams: new Map(),
      senders: { audio: null, camera: [], screen: [] },
      audioEls: new Map(),
      analysers: new Map(),
    };
    this.peers.set(userId, peer);

    this.ensureGraph();
    peer.senders.audio = pc.addTrack(this.sendTrack, this.sendStream);
    if (this.cameraStream) peer.senders.camera = this.cameraStream.getTracks().map((t) => pc.addTrack(t, this.cameraStream));
    if (this.screenStream) peer.senders.screen = this.screenStream.getTracks().map((t) => pc.addTrack(t, this.screenStream));

    const send = (data) => getSocket()?.emit('rtc:signal', { to: userId, data }, () => {});

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        send({ description: pc.localDescription });
      } catch (err) {
        console.warn('[voice] negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => candidate && send({ candidate });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.emit();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      peer.streams.set(stream.id, stream);
      if (track.kind === 'audio') this.attachAudio(peer, stream);
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) {
          peer.streams.delete(stream.id);
          this.detachAudio(peer, stream.id);
        }
        this.emit();
      };
      track.onunmute = () => this.emit();
      track.onended = () => this.emit();
      this.emit();
    };
    this.emit();
    return peer;
  }

  closePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    for (const id of [...peer.audioEls.keys()]) this.detachAudio(peer, id);
    this.peers.delete(userId);
    this.speaking.delete(userId);
  }

  onSignal({ from, roomId, data }) {
    if (!this.roomId || roomId !== this.roomId || !data) return;
    const peer = this.peers.get(from) || this.createPeer(from);
    peer.queue = peer.queue.then(() => this.handleSignal(peer, data)).catch((err) => console.warn('[voice] signal error', err));
  }

  async handleSignal(peer, { description, candidate }) {
    const { pc } = peer;
    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        getSocket()?.emit('rtc:signal', { to: peer.userId, data: { description: pc.localDescription } }, () => {});
      }
      this.applyEncodings(peer);
    } else if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn('[voice] bad candidate', err);
      }
    }
  }

  async applyEncodings(peer) {
    const tune = async (sender, maxBitrate, maxFramerate) => {
      if (!sender?.track) return;
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      params.encodings[0].maxBitrate = maxBitrate;
      if (maxFramerate) params.encodings[0].maxFramerate = maxFramerate;
      if (sender.track.kind === 'video') params.degradationPreference = maxFramerate >= 60 ? 'maintain-framerate' : 'maintain-resolution';
      await sender.setParameters(params).catch(() => {});
    };
    for (const s of peer.senders.camera) if (s.track?.kind === 'video') await tune(s, CAMERA_BITRATE, 30);
    const q = this.screenQuality;
    if (q) for (const s of peer.senders.screen) if (s.track?.kind === 'video') await tune(s, q.bitrate, q.fps);
  }

  /* ---------------- remote audio ---------------- */

  outputVolumeFor(userId) {
    const { outputVolume, userVolumes } = getState().settings;
    const uv = userVolumes[userId] ?? 100;
    return Math.max(0, Math.min(1, (outputVolume / 100) * (uv / 100)));
  }

  attachAudio(peer, stream) {
    if (peer.audioEls.has(stream.id)) return;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = stream;
    el.muted = this.deafened;
    el.volume = this.outputVolumeFor(peer.userId);
    const sink = getState().settings.outputDeviceId;
    if (sink && sink !== 'default' && el.setSinkId) el.setSinkId(sink).catch(() => {});
    el.style.display = 'none';
    document.body.appendChild(el);
    el.play().catch(() => {});
    peer.audioEls.set(stream.id, el);

    const g = this.ensureGraph();
    try {
      const src = g.ctx.createMediaStreamSource(stream);
      const analyser = g.ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      peer.analysers.set(stream.id, analyser);
    } catch { /* stream without audio yet */ }
  }

  detachAudio(peer, streamId) {
    const el = peer.audioEls.get(streamId);
    if (el) { el.srcObject = null; el.remove(); }
    peer.audioEls.delete(streamId);
    peer.analysers.get(streamId)?.disconnect();
    peer.analysers.delete(streamId);
  }

  refreshVolumes() {
    for (const peer of this.peers.values()) {
      for (const el of peer.audioEls.values()) {
        el.volume = this.outputVolumeFor(peer.userId);
        el.muted = this.deafened;
      }
    }
  }

  async setOutputDevice(deviceId) {
    for (const peer of this.peers.values()) {
      for (const el of peer.audioEls.values()) if (el.setSinkId) await el.setSinkId(deviceId || 'default').catch(() => {});
    }
  }

  /* ---------------- controls ---------------- */

  async setMuted(muted) {
    if (!muted && this.deafened) {
      this.deafened = false;
      this.refreshVolumes();
    }
    this.muted = muted;
    playSound(muted ? 'mute' : 'unmute');
    if (!muted && this.roomId && !this.micStream) await this.ensureMic();
    this.pushState();
    this.emit();
  }

  setDeafened(deafened) {
    this.deafened = deafened;
    this.refreshVolumes();
    playSound(deafened ? 'deafen' : 'undeafen');
    this.pushState();
    this.emit();
  }

  async startCamera() {
    if (this.cameraStream || !this.roomId) return;
    const stream = await this.openCamera();
    if (!this.roomId) { stream.getTracks().forEach((t) => t.stop()); return; }
    this.cameraStream = stream;
    stream.getVideoTracks()[0].onended = () => this.stopCamera();
    for (const peer of this.peers.values()) {
      peer.senders.camera = stream.getTracks().map((t) => peer.pc.addTrack(t, stream));
    }
    this.pushState();
    this.emit();
  }

  /** Open the preferred camera, falling back to any other camera that works. */
  async openCamera() {
    const { videoDeviceId } = getState().settings;
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const order = [videoDeviceId, ...devices.map((d) => d.deviceId)].filter((id, i, all) => id && all.indexOf(id) === i);
    let lastError;
    for (const id of order.length ? order : [null]) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: id ? { ...base, deviceId: { exact: id } } : base, audio: false });
      } catch (err) {
        lastError = err;
        if (err?.name === 'NotAllowedError') break;
      }
    }
    throw lastError;
  }

  stopCamera({ silent = false } = {}) {
    if (!this.cameraStream) return;
    for (const peer of this.peers.values()) {
      for (const s of peer.senders.camera) { try { peer.pc.removeTrack(s); } catch { /* closed */ } }
      peer.senders.camera = [];
    }
    this.cameraStream.getTracks().forEach((t) => t.stop());
    this.cameraStream = null;
    if (!silent) this.pushState();
    this.emit();
  }

  async switchCamera(deviceId) {
    if (!this.cameraStream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    const track = stream.getVideoTracks()[0];
    const old = this.cameraStream.getVideoTracks()[0];
    for (const peer of this.peers.values()) {
      const sender = peer.senders.camera.find((s) => s.track === old);
      await sender?.replaceTrack(track);
    }
    this.cameraStream.removeTrack(old);
    old.stop();
    this.cameraStream.addTrack(track);
    track.onended = () => this.stopCamera();
    this.emit();
  }

  async startScreen({ quality = '1080p30', audio = false } = {}) {
    if (!this.roomId) return;
    const q = SCREEN_QUALITY[quality] || SCREEN_QUALITY['1080p30'];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps, max: q.fps } },
      audio,
    });
    if (!this.roomId) { stream.getTracks().forEach((t) => t.stop()); return; }
    if (this.screenStream) this.stopScreen({ silent: true });
    const vt = stream.getVideoTracks()[0];
    vt.contentHint = q.fps >= 60 ? 'motion' : 'detail';
    try {
      await vt.applyConstraints({ width: { max: q.width }, height: { max: q.height }, frameRate: { max: q.fps } });
    } catch { /* keep native size */ }
    vt.onended = () => this.stopScreen();
    this.screenStream = stream;
    this.screenQuality = q;
    for (const peer of this.peers.values()) {
      peer.senders.screen = stream.getTracks().map((t) => peer.pc.addTrack(t, stream));
    }
    this.pushState();
    this.emit();
  }

  stopScreen({ silent = false } = {}) {
    if (!this.screenStream) return;
    for (const peer of this.peers.values()) {
      for (const s of peer.senders.screen) { try { peer.pc.removeTrack(s); } catch { /* closed */ } }
      peer.senders.screen = [];
    }
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenQuality = null;
    if (!silent) this.pushState();
    this.emit();
  }

  async getStats() {
    const out = {};
    for (const [id, peer] of this.peers) {
      try {
        const report = await peer.pc.getStats();
        report.forEach((s) => {
          if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime !== undefined) {
            out[id] = { rtt: Math.round(s.currentRoundTripTime * 1000) };
          }
        });
      } catch { /* closed */ }
    }
    return out;
  }
}

export const voice = new VoiceEngine();

export function useVoice() {
  return useSyncExternalStore(voice.subscribe, () => voice.snapshot, () => voice.snapshot);
}

export const isElectron = Boolean(native?.isElectron);
