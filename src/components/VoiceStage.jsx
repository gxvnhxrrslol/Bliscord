import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getState, setState, updateSettings, useStore, withKey, withoutKey } from '../lib/store';
import { acceptCall, declineCall, joinVoice, leaveVoice, openHome, openMenu, openPopout, selectChannel } from '../lib/actions';
import { useVoice, voice } from '../lib/voice';
import { toggleCamera, toggleScreen } from '../lib/media';
import { assetUrl } from '../lib/api';
import { colorFor, displayName, duration } from '../lib/format';
import { Avatar, Button, Slider } from './ui';
import { ChatHeader } from './ChatView';
import { voiceMemberMenu } from './Sidebars';
import { can, P } from '../lib/perms';
import Icon from './Icons';

function useVideo(stream) {
  const ref = useRef(null);
  const [hasFrames, setHasFrames] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setHasFrames(false);
    el.srcObject = stream || null;
    if (!stream) return undefined;
    const check = () => setHasFrames(el.videoWidth > 0);
    el.addEventListener('loadeddata', check);
    el.addEventListener('resize', check);
    el.play().catch(() => {});
    const t = setInterval(check, 1000);
    return () => {
      clearInterval(t);
      el.removeEventListener('loadeddata', check);
      el.removeEventListener('resize', check);
    };
  }, [stream]);
  return [ref, hasFrames];
}

function volumeMenu(e, userId) {
  const user = getState().users[userId];
  openMenu(e, [
    {
      render: () => <VolumeItem userId={userId} />,
    },
    { separator: true },
    { label: 'Profile', icon: Icon.User, onClick: () => openPopout(userId, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 }) },
    { label: `Reset volume for ${displayName(user)}`, icon: Icon.Refresh, onClick: () => {
      const { userVolumes } = getState().settings;
      const next = { ...userVolumes };
      delete next[userId];
      updateSettings({ userVolumes: next });
      voice.refreshVolumes();
    } },
  ]);
}

function VolumeItem({ userId }) {
  const vol = useStore((s) => s.settings.userVolumes[userId] ?? 100);
  return (
    <div className="menu-custom">
      <span className="menu-custom-label">User volume</span>
      <Slider
        value={vol}
        onChange={(v) => {
          updateSettings({ userVolumes: { ...getState().settings.userVolumes, [userId]: v } });
          voice.refreshVolumes();
        }}
        format={(v) => `${v}%`}
      />
    </div>
  );
}

function toggleStreamFlag(key, userId) {
  setState((s) => ({ [key]: s[key][userId] ? withoutKey(s[key], userId) : withKey(s[key], userId, true) }));
  voice.refreshVolumes();
}

function StreamVolumeItem({ userId }) {
  const vol = useStore((s) => s.settings.streamVolumes?.[userId] ?? 100);
  return (
    <div className="menu-custom">
      <span className="menu-custom-label">Stream volume</span>
      <Slider
        value={vol}
        onChange={(v) => {
          updateSettings({ streamVolumes: { ...getState().settings.streamVolumes, [userId]: v } });
          voice.refreshVolumes();
        }}
        format={(v) => `${v}%`}
      />
    </div>
  );
}

function streamMenu(e, userId) {
  const { mutedStreams, hiddenStreams } = getState();
  openMenu(e, [
    { render: () => <StreamVolumeItem userId={userId} /> },
    { separator: true },
    { label: 'Mute stream audio', icon: Icon.SpeakerOff, checked: Boolean(mutedStreams[userId]), onClick: () => toggleStreamFlag('mutedStreams', userId) },
    { label: hiddenStreams[userId] ? 'Show stream' : 'Hide stream', icon: hiddenStreams[userId] ? Icon.Eye : Icon.EyeOff, onClick: () => toggleStreamFlag('hiddenStreams', userId) },
  ]);
}

function Tile({ tileKey, kind, userId, stream, state, speaking, isSelf, focused, onFocus, connecting, calling }) {
  const user = useStore((s) => s.users[userId]);
  const isStream = kind === 'screen' && !isSelf;
  const hidden = useStore((s) => isStream && Boolean(s.hiddenStreams[userId]));
  const streamMuted = useStore((s) => isStream && Boolean(s.mutedStreams[userId]));
  const [videoRef, hasFrames] = useVideo(hidden ? null : stream);
  const box = useRef(null);
  const showVideo = Boolean(stream) && hasFrames;
  const color = user?.bannerColor || user?.accentColor || colorFor(userId);
  const avatar = assetUrl(user?.avatar);

  const fullscreen = (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else box.current?.requestFullscreen?.();
  };

  return (
    <div
      ref={box}
      className={`tile tile-${kind}${speaking && kind === 'user' ? ' speaking' : ''}${focused ? ' focused' : ''}${showVideo ? ' has-video' : ''}${calling ? ' calling' : ''}`}
      style={{ '--tile-color': color }}
      onClick={() => onFocus(tileKey)}
      onContextMenu={(e) => {
        if (isStream) { streamMenu(e, userId); return; }
        const { voice: rooms, channels } = getState();
        const roomId = Object.keys(rooms).find((rid) => rooms[rid].some((p) => p.userId === userId));
        const ch = roomId && channels[roomId];
        if (ch && state) voiceMemberMenu(e, { state, serverId: ch.serverId, channelId: ch.id });
        else if (!isSelf) volumeMenu(e, userId);
      }}
    >
      {!showVideo && (
        <div className="tile-idle">
          {avatar && kind === 'user' && <div className="tile-bg" style={{ backgroundImage: `url(${avatar})` }} />}
          {kind === 'user' ? (
            <div className="tile-avatar">
              <Avatar user={user} size={focused ? 96 : 72} speaking={speaking} />
              {calling && <span className="calling-ring" />}
            </div>
          ) : hidden ? (
            <button className="tile-hidden" onClick={(e) => { e.stopPropagation(); toggleStreamFlag('hiddenStreams', userId); }}>
              <Icon.EyeOff size={26} />
              <span>Show stream</span>
            </button>
          ) : (
            <div className="tile-screen-wait"><Icon.Screen size={34} /></div>
          )}
        </div>
      )}
      <video
        ref={videoRef}
        className={`tile-video${isSelf && kind === 'user' ? ' mirror' : ''}`}
        autoPlay
        playsInline
        muted
        style={{ opacity: showVideo ? 1 : 0 }}
      />
      <div className="tile-label">
        {kind === 'screen' && <span className="live-badge">LIVE</span>}
        <span>{displayName(user)}</span>
        {streamMuted && <Icon.SpeakerOff size={14} />}
        {kind === 'user' && (state?.deafened || state?.serverDeafened ? <Icon.HeadphonesOff size={14} /> : (state?.muted || state?.serverMuted) && <Icon.MicOff size={14} />)}
      </div>
      {connecting && !isSelf && <div className="tile-connecting"><span className="spinner" style={{ width: 18, height: 18 }} /></div>}
      {showVideo && (
        <button className="tile-fs" onClick={fullscreen} aria-label="Fullscreen">
          <Icon.Fullscreen size={16} />
        </button>
      )}
    </div>
  );
}

function bestColumns(n, width, height, aspect = 16 / 9) {
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min(width / cols, (height / rows) * aspect);
    if (w > best.size) best = { cols, size: w };
  }
  return best;
}

function Controls({ compact }) {
  const v = useVoice();
  const muted = v.muted || v.deafened || v.serverMuted || v.serverDeafened;
  const canVideo = useStore((s) => {
    const ch = v.roomId && s.channels[v.roomId];
    return !ch || can(s, ch.serverId, P.VIDEO, ch.id);
  });
  return (
    <div className={`stage-controls glass-strong${compact ? ' compact' : ''}`}>
      <button className={`sc-btn${muted ? ' off' : ''}`} onClick={() => voice.setMuted(!muted)} data-tip={muted ? 'Unmute' : 'Mute'}>
        {muted ? <Icon.MicOff size={20} /> : <Icon.Mic size={20} />}
      </button>
      <button className={`sc-btn${v.deafened ? ' off' : ''}`} onClick={() => voice.setDeafened(!v.deafened)} data-tip={v.deafened ? 'Undeafen' : 'Deafen'}>
        {v.deafened ? <Icon.HeadphonesOff size={20} /> : <Icon.Headphones size={20} />}
      </button>
      <button className={`sc-btn${v.cameraStream ? ' on' : ''}`} onClick={toggleCamera} disabled={!canVideo} data-tip={v.cameraStream ? 'Turn off camera' : 'Turn on camera'}>
        {v.cameraStream ? <Icon.Video size={20} /> : <Icon.VideoOff size={20} />}
      </button>
      <button className={`sc-btn${v.screenStream ? ' on' : ''}`} onClick={toggleScreen} disabled={!canVideo} data-tip={v.screenStream ? 'Stop sharing' : 'Share your screen'}>
        {v.screenStream ? <Icon.ScreenOff size={20} /> : <Icon.Screen size={20} />}
      </button>
      <button className="sc-btn leave" onClick={leaveVoice} data-tip="Disconnect">
        <Icon.PhoneOff size={22} />
      </button>
    </div>
  );
}

function CallTimer({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="call-timer">{duration(Date.now() - since)}</span>;
}

export function Stage({ roomId, compact = false, extraTiles = [] }) {
  const states = useStore((s) => s.voice[roomId]) || [];
  const meId = useStore((s) => s.me.id);
  const v = useVoice();
  // Focus is kept in the store so it survives leaving the call view (shown as a pop-out preview).
  const focus = useStore((s) => (s.stageFocus?.roomId === roomId ? s.stageFocus.key : null));
  const setFocus = (fn) => {
    const next = typeof fn === 'function' ? fn(focus) : fn;
    setState({ stageFocus: next ? { roomId, key: next } : null });
  };
  useEffect(() => {
    setState({ stageVisible: roomId });
    return () => setState((s) => (s.stageVisible === roomId ? { stageVisible: null } : null));
  }, [roomId]);
  const grid = useRef(null);
  const [layout, setLayout] = useState({ cols: 1, size: 0 });

  const tiles = useMemo(() => {
    const list = [];
    for (const st of states) {
      const self = st.userId === meId;
      const remote = v.remote[st.userId] || {};
      if (st.screen) {
        const stream = self ? v.screenStream : remote[st.screenStreamId];
        list.push({ key: `s-${st.userId}`, kind: 'screen', userId: st.userId, stream, state: st, isSelf: self });
      }
    }
    for (const st of states) {
      const self = st.userId === meId;
      const remote = v.remote[st.userId] || {};
      const stream = st.video ? (self ? v.cameraStream : remote[st.cameraStreamId]) : null;
      const pc = v.peerStates[st.userId];
      list.push({
        key: `u-${st.userId}`, kind: 'user', userId: st.userId, stream, state: st, isSelf: self,
        connecting: !self && v.roomId === roomId && pc !== 'connected',
      });
    }
    return [...list, ...extraTiles];
  }, [states, meId, v, roomId, extraTiles]);

  const focused = focus && tiles.find((t) => t.key === focus) ? focus : null;
  const main = focused ? tiles.filter((t) => t.key === focused) : tiles;
  const strip = focused ? tiles.filter((t) => t.key !== focused) : [];

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return undefined;
    const measure = () => {
      const gap = 10;
      const n = main.length || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const best = bestColumns(n, w - gap * 2, h - gap * 2);
      const rows = Math.ceil(n / best.cols);
      const size = Math.min((w - gap * (best.cols + 1)) / best.cols, ((h - gap * (rows + 1)) / rows) * (16 / 9));
      setLayout({ cols: best.cols, size: Math.max(120, size) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [main.length, focused]);

  const toggleFocus = (key) => setFocus((cur) => (cur === key ? null : key));

  return (
    <div className={`stage${compact ? ' compact' : ''}${focused ? ' has-focus' : ''}`}>
      <div className="stage-grid" ref={grid}>
        <div className="stage-grid-inner" style={{ gridTemplateColumns: `repeat(${layout.cols}, ${layout.size}px)` }}>
          {main.map((t) => (
            <Tile
              key={t.key}
              tileKey={t.key}
              {...t}
              focused={focused === t.key}
              speaking={v.speaking.has(t.userId)}
              onFocus={toggleFocus}
            />
          ))}
        </div>
      </div>
      {strip.length > 0 && (
        <div className="stage-strip">
          {strip.map((t) => (
            <Tile key={t.key} tileKey={t.key} {...t} speaking={v.speaking.has(t.userId)} onFocus={toggleFocus} />
          ))}
        </div>
      )}
      {v.roomId === roomId && <Controls compact={compact} />}
    </div>
  );
}

export function VoiceChannelView({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  const states = useStore((s) => s.voice[channelId]) || [];
  const users = useStore((s) => s.users);
  const v = useVoice();
  if (!channel) return null;
  const joined = v.roomId === channelId;

  return (
    <div className="chat voice-view">
      <ChatHeader icon={<Icon.Speaker size={22} className="header-icon" />} title={channel.name}>
        {joined && v.joinedAt && <CallTimer since={v.joinedAt} />}
      </ChatHeader>
      {joined ? (
        <Stage roomId={channelId} />
      ) : (
        <div className="voice-lobby">
          <div className="lobby-avatars">
            {states.slice(0, 6).map((st) => <Avatar key={st.userId} user={users[st.userId]} size={64} />)}
            {!states.length && <div className="lobby-empty"><Icon.Speaker size={40} /></div>}
          </div>
          <h2>{channel.name}</h2>
          <p>{states.length ? `${states.map((st) => displayName(users[st.userId])).slice(0, 3).join(', ')}${states.length > 3 ? ` and ${states.length - 3} more` : ''}` : 'No one is here yet'}</p>
          <Button className="btn-lg" loading={v.joining} onClick={() => joinVoice(channelId)}>
            Join Voice
          </Button>
        </div>
      )}
    </div>
  );
}

export function CallStage({ roomId }) {
  const v = useVoice();
  const states = useStore((s) => s.voice[roomId]) || [];
  const dm = useStore((s) => s.dms[roomId]);
  const incoming = useStore((s) => s.incomingCall?.roomId === roomId);
  const meId = useStore((s) => s.me.id);
  const joined = v.roomId === roomId;
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.42));

  // While ringing, show the person being called; once they have joined and left, their tile goes away.
  const ringing = useStore((s) => s.outgoingRing === roomId);
  const extraTiles = useMemo(() => (joined && ringing && dm
    ? [{ key: `c-${dm.recipientId}`, kind: 'user', userId: dm.recipientId, stream: null, state: null, isSelf: false, calling: true }]
    : []), [joined, ringing, dm]);

  const startDrag = (e) => {
    const startY = e.clientY;
    const start = height;
    const move = (ev) => setHeight(Math.max(200, Math.min(window.innerHeight * 0.75, start + ev.clientY - startY)));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="call-stage" style={{ height: joined ? height : undefined }}>
      {joined ? (
        <Stage roomId={roomId} compact extraTiles={extraTiles} />
      ) : (
        <div className="call-invite">
          <div className="lobby-avatars">
            {states.filter((st) => st.userId !== meId).map((st) => <CallAvatar key={st.userId} userId={st.userId} />)}
          </div>
          <div className="call-invite-actions">
            <Button className="btn-call accept" onClick={() => (incoming ? acceptCall() : joinVoice(roomId))} data-tip="Join call">
              <Icon.Phone size={20} />
            </Button>
            {incoming && (
              <Button className="btn-call decline" onClick={declineCall} data-tip="Decline">
                <Icon.PhoneOff size={20} />
              </Button>
            )}
          </div>
        </div>
      )}
      {joined && <div className="call-resize" onMouseDown={startDrag} />}
    </div>
  );
}

function CallAvatar({ userId }) {
  const user = useStore((s) => s.users[userId]);
  return (
    <div className="call-avatar">
      <Avatar user={user} size={72} />
      <span className="calling-ring" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pop-out preview of the focused stream while browsing elsewhere      */
/* ------------------------------------------------------------------ */

const PIP_W = 320;
const PIP_H = 180;

function loadPipPos() {
  try { return JSON.parse(localStorage.getItem('bliscord.pipPos')) || null; } catch { return null; }
}

export function StreamPip() {
  const v = useVoice();
  const focus = useStore((s) => s.stageFocus);
  const visible = useStore((s) => s.stageVisible);
  const st = useStore((s) => (focus ? (s.voice[focus.roomId] || []).find((x) => x.userId === focus.key.slice(2)) : null));
  const user = useStore((s) => (focus ? s.users[focus.key.slice(2)] : null));
  const meId = useStore((s) => s.me?.id);
  const [pos, setPos] = useState(loadPipPos);
  const drag = useRef(null);
  const box = useRef(null);

  let stream = null;
  if (focus && st && v.roomId === focus.roomId) {
    const self = st.userId === meId;
    const remote = v.remote[st.userId] || {};
    if (focus.key.startsWith('s-') && st.screen) stream = self ? v.screenStream : remote[st.screenStreamId];
    if (focus.key.startsWith('u-') && st.video) stream = self ? v.cameraStream : remote[st.cameraStreamId];
  }
  const [ref] = useVideo(stream);
  const show = Boolean(stream) && visible !== focus?.roomId;

  // Keep the preview inside the window when it resizes.
  const clamp = (p) => {
    const w = box.current?.offsetWidth || PIP_W;
    const h = box.current?.offsetHeight || PIP_H;
    return { x: Math.min(Math.max(8, p.x), window.innerWidth - w - 8), y: Math.min(Math.max(40, p.y), window.innerHeight - h - 8) };
  };
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!show) return null;

  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = box.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, sx: e.clientX, sy: e.clientY };
    const move = (ev) => {
      const d = drag.current;
      if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 4) d.moved = true;
      if (d.moved) setPos(clamp({ x: ev.clientX - d.dx, y: ev.clientY - d.dy }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.current?.classList.remove('dragging');
      if (!drag.current.moved) openCall();
      else setPos((p) => { try { localStorage.setItem('bliscord.pipPos', JSON.stringify(p)); } catch { /* ignore */ } return p; });
    };
    box.current.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const openCall = () => {
    const s = getState();
    if (s.dms[focus.roomId]) openHome(focus.roomId);
    else if (s.channels[focus.roomId]) selectChannel(s.channels[focus.roomId].serverId, focus.roomId);
  };

  const style = pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 };
  return (
    <div className="stream-pip" ref={box} style={style} onPointerDown={onDown}>
      <video ref={ref} autoPlay playsInline muted />
      <div className="pip-bar">
        <span className="pip-name">
          {focus.key.startsWith('s-') ? <Icon.Screen size={14} /> : <Icon.Video size={14} />}
          {displayName(user)}
        </span>
        <button className="pip-close" onClick={() => setState({ stageFocus: null })} aria-label="Close preview"><Icon.X size={14} /></button>
      </div>
    </div>
  );
}
