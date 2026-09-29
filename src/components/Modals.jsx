import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, updateSettings, useStore } from '../lib/store';
import {
  createChannel, createServer, joinServer, openDm, openHome, previewInvite, resetInvite, selectChannel,
  selectServer, setNickname, toast, updateChannel, deleteChannel, openModal,
} from '../lib/actions';
import { assetUrl, native } from '../lib/api';
import { goLive } from '../lib/media';
import { SCREEN_QUALITY } from '../lib/voice';
import { displayName } from '../lib/format';
import { Avatar, Button, Field, ServerGlyph, Spinner, Switch, copyText, pickFiles, uploadImage, Modal } from './ui';
import SettingsModal from './SettingsModal';
import ServerSettingsModal from './ServerSettings';
import Icon from './Icons';

/* ---------------- Image picker ---------------- */

export function ImagePick({ value, onChange, shape = 'circle', size = 88, maxSize = 512, label }) {
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadImage(file, maxSize));
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <button type="button" className={`image-pick ${shape}${value ? ' has-image' : ''}`} style={{ width: size, height: shape === 'wide' ? size * 0.4 : size }} onClick={pick}>
      {value ? <img src={assetUrl(value)} alt="" /> : (
        <span className="image-pick-empty">
          <Icon.Camera size={22} />
          {label && <span>{label}</span>}
        </span>
      )}
      <span className="image-pick-plus">{busy ? <Spinner size={12} /> : <Icon.Plus size={12} strokeWidth={3} />}</span>
    </button>
  );
}


/* ---------------- Create / join server ---------------- */

function CreateServerModal({ mode: initialMode = 'choose' }) {
  const me = useStore((s) => s.me);
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState(`${me.displayName}'s server`);
  const [icon, setIcon] = useState(null);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'join' || code.trim().length < 6) { setPreview(null); return undefined; }
    const t = setTimeout(async () => {
      try {
        setPreview(await previewInvite(code.trim()));
        setError('');
      } catch (err) {
        setPreview(null);
        setError(err.message);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [code, mode]);

  const create = async (close) => {
    setBusy(true);
    try {
      await createServer(name.trim(), icon);
      close();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const join = async (close) => {
    setBusy(true);
    try {
      await joinServer(code.trim());
      close();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal size="sm">
      {(close) => (
        <div className="modal-body center">
          {mode === 'choose' && (
            <div className="step">
              <h2>Your place to hang out</h2>
              <div className="choice-list">
                <button className="choice" onClick={() => setMode('create')}>
                  <span className="choice-icon"><Icon.Sparkle size={22} /></span>
                  <span className="choice-text">Create a server</span>
                  <Icon.ChevronRight size={18} />
                </button>
                <button className="choice" onClick={() => setMode('join')}>
                  <span className="choice-icon"><Icon.Compass size={22} /></span>
                  <span className="choice-text">Join with an invite</span>
                  <Icon.ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
          {mode === 'create' && (
            <div className="step">
              <h2>Create a server</h2>
              <ImagePick value={icon} onChange={setIcon} label="Icon" />
              <Field label="Server name" error={error}>
                <input className="input" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create(close)} />
              </Field>
              <div className="modal-footer">
                <Button variant="ghost" onClick={() => { setMode('choose'); setError(''); }}>Back</Button>
                <Button loading={busy} disabled={!name.trim()} onClick={() => create(close)}>Create</Button>
              </div>
            </div>
          )}
          {mode === 'join' && (
            <div className="step">
              <h2>Join a server</h2>
              <Field label="Invite code" error={error}>
                <input className="input mono" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="aB3dEf9h" onKeyDown={(e) => e.key === 'Enter' && preview && join(close)} spellCheck={false} />
              </Field>
              {preview && (
                <div className="invite-preview">
                  <ServerGlyph server={preview} size={52} />
                  <div className="invite-preview-text">
                    <strong>{preview.name}</strong>
                    <span><i className="dot online" />{preview.onlineCount} online <i className="dot" />{preview.memberCount} members</span>
                  </div>
                </div>
              )}
              <div className="modal-footer">
                <Button variant="ghost" onClick={() => { setMode('choose'); setError(''); }}>Back</Button>
                <Button loading={busy} disabled={!preview} onClick={() => join(close)}>{preview?.joined ? 'Open' : 'Join'}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Invite ---------------- */

function InviteModal({ serverId }) {
  const server = useStore((s) => s.servers[serverId]);
  const role = useStore((s) => s.members[serverId]?.[s.me.id]?.role);
  const [copied, setCopied] = useState(false);
  if (!server) return null;
  const copy = async () => {
    await copyText(server.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Modal size="sm">
      <div className="modal-body">
        <div className="modal-title-row">
          <ServerGlyph server={server} size={40} />
          <h2>Invite friends to {server.name}</h2>
        </div>
        <Field label="Invite code">
          <div className={`copy-box${copied ? ' copied' : ''}`}>
            <span className="mono">{server.inviteCode}</span>
            <Button onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </Field>
        {(role === 'owner' || role === 'admin') && (
          <button className="link-btn subtle" onClick={() => resetInvite(serverId)}>
            <Icon.Refresh size={14} /> New code
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- Channels ---------------- */

function CreateChannelModal({ serverId, type: initialType = 'text' }) {
  const [type, setType] = useState(initialType);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (close) => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const ch = await createChannel(serverId, name, type);
      close();
      selectChannel(serverId, ch.id);
    } catch {
      setBusy(false);
    }
  };
  return (
    <Modal size="sm">
      {(close) => (
        <div className="modal-body">
          <h2>Create channel</h2>
          <div className="type-cards">
            {[['text', Icon.Hash, 'Text'], ['voice', Icon.Speaker, 'Voice']].map(([t, I, label]) => (
              <button key={t} className={`type-card${type === t ? ' active' : ''}`} onClick={() => setType(t)}>
                <I size={22} />
                <span>{label}</span>
                <span className="radio" />
              </button>
            ))}
          </div>
          <Field label="Channel name">
            <div className="input-icon">
              {type === 'text' ? <Icon.Hash size={17} /> : <Icon.Speaker size={17} />}
              <input
                className="input"
                autoFocus
                value={name}
                maxLength={100}
                placeholder={type === 'text' ? 'new-channel' : 'Hangout'}
                onChange={(e) => setName(type === 'text' ? e.target.value.toLowerCase().replace(/\s+/g, '-') : e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create(close)}
              />
            </div>
          </Field>
          <div className="modal-footer">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button loading={busy} disabled={!name.trim()} onClick={() => create(close)}>Create</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChannelSettingsModal({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  const [name, setName] = useState(channel?.name || '');
  const [topic, setTopic] = useState(channel?.topic || '');
  const [busy, setBusy] = useState(false);
  if (!channel) return null;
  const save = async (close) => {
    setBusy(true);
    try {
      await updateChannel(channelId, { name, ...(channel.type === 'text' ? { topic } : {}) });
      close();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Modal size="sm">
      {(close) => (
        <div className="modal-body">
          <h2>Edit channel</h2>
          <Field label="Channel name">
            <input className="input" autoFocus value={name} maxLength={100} onChange={(e) => setName(channel.type === 'text' ? e.target.value.toLowerCase().replace(/\s+/g, '-') : e.target.value)} />
          </Field>
          {channel.type === 'text' && (
            <Field label="Topic">
              <textarea className="input textarea" value={topic} maxLength={1024} rows={3} onChange={(e) => setTopic(e.target.value)} />
            </Field>
          )}
          <div className="modal-footer spread">
            <Button variant="danger-ghost" onClick={() => openModal('confirm', {
              title: `Delete ${channel.type === 'text' ? '#' : ''}${channel.name}`,
              body: 'This cannot be undone.',
              confirm: 'Delete channel',
              danger: true,
              onConfirm: async () => { await deleteChannel(channelId); close(); },
            })}>Delete</Button>
            <div className="footer-group">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button loading={busy} disabled={!name.trim()} onClick={() => save(close)}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function NicknameModal({ serverId }) {
  const me = useStore((s) => s.me);
  const member = useStore((s) => s.members[serverId]?.[s.me.id]);
  const [value, setValue] = useState(member?.nickname || '');
  return (
    <Modal size="sm">
      {(close) => (
        <div className="modal-body">
          <h2>Change nickname</h2>
          <Field label="Nickname">
            <input className="input" autoFocus value={value} maxLength={32} placeholder={me.displayName} onChange={(e) => setValue(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter') { await setNickname(serverId, value); close(); } }} />
          </Field>
          <div className="modal-footer">
            <Button variant="ghost" onClick={async () => { await setNickname(serverId, ''); close(); }}>Reset</Button>
            <Button onClick={async () => { await setNickname(serverId, value); close(); }}>Save</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Confirm & image ---------------- */

function ConfirmModal({ title, body, confirm = 'Confirm', danger, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal size="sm">
      {(close) => (
        <div className="modal-body">
          <h2>{title}</h2>
          {body && <p className="modal-text">{body}</p>}
          <div className="modal-footer">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              loading={busy}
              autoFocus
              onClick={async () => {
                setBusy(true);
                try { await onConfirm?.(); } catch { /* toast shown */ }
                close();
              }}
            >
              {confirm}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ImageModal({ src, name }) {
  return (
    <Modal bare size="full" className="image-modal">
      {(close) => (
        <div className="image-view" onClick={close}>
          <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
          <a className="image-open" href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open original</a>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Screen picker (desktop app) ---------------- */

function ScreenPickerModal() {
  const quality = useStore((s) => s.settings.screenQuality);
  const [sources, setSources] = useState(null);
  const [tab, setTab] = useState('screen');
  const [selected, setSelected] = useState(null);
  const [audio, setAudio] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await native.screen.getSources();
      if (alive) setSources(list);
    };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const list = (sources || []).filter((s) => (tab === 'screen' ? s.isScreen : !s.isScreen));

  return (
    <Modal size="lg">
      {(close) => (
        <div className="modal-body screen-picker">
          <h2>Share your screen</h2>
          <nav className="seg">
            <button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}><Icon.Screen size={16} /> Screens</button>
            <button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}><Icon.Grid size={16} /> Applications</button>
          </nav>
          <div className="source-grid">
            {!sources && <div className="source-loading"><Spinner /></div>}
            {list.map((s) => (
              <button key={s.id} className={`source${selected === s.id ? ' active' : ''}`} onClick={() => setSelected(s.id)} onDoubleClick={() => { goLive({ sourceId: s.id, quality, audio }); close(); }}>
                <span className="source-thumb"><img src={s.thumbnail} alt="" /></span>
                <span className="source-name">
                  {s.appIcon && <img src={s.appIcon} alt="" />}
                  <span>{s.name}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="stream-options">
            <div className="quality-group">
              <span className="field-label">Quality</span>
              <div className="seg small">
                {Object.entries(SCREEN_QUALITY).map(([k, q]) => (
                  <button key={k} className={quality === k ? 'active' : ''} onClick={() => updateSettings({ screenQuality: k })}>
                    {q.label}<small>{q.fps}fps</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="inline-switch">
              <span className="field-label">Sound</span>
              <Switch checked={audio} onChange={setAudio} />
            </label>
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button disabled={!selected} onClick={() => { goLive({ sourceId: selected, quality, audio }); close(); }}>
              <Icon.Screen size={16} /> Go Live
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Quick switcher ---------------- */

function QuickSwitcherModal() {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const state = getState();

  const results = useMemo(() => {
    const items = [];
    const needle = q.trim().toLowerCase();
    const match = (s) => !needle || s.toLowerCase().includes(needle);
    for (const dm of Object.values(state.dms)) {
      const u = state.users[dm.recipientId];
      if (u && match(`${u.displayName} ${u.username}`)) items.push({ key: dm.id, kind: 'dm', user: u, label: displayName(u), sub: `@${u.username}`, go: () => openHome(dm.id), rank: dm.lastMessageAt || 0 });
    }
    for (const [id, type] of Object.entries(state.relationships)) {
      if (type !== 'friend' || Object.values(state.dms).some((d) => d.recipientId === id)) continue;
      const u = state.users[id];
      if (u && match(`${u.displayName} ${u.username}`)) items.push({ key: `f${id}`, kind: 'dm', user: u, label: displayName(u), sub: `@${u.username}`, go: () => openDm(id), rank: 0 });
    }
    for (const c of Object.values(state.channels)) {
      if (match(c.name)) items.push({ key: c.id, kind: c.type, label: c.name, sub: state.servers[c.serverId]?.name, go: () => selectChannel(c.serverId, c.id), rank: 0 });
    }
    for (const s of Object.values(state.servers)) {
      if (match(s.name)) items.push({ key: s.id, kind: 'server', server: s, label: s.name, go: () => selectServer(s.id), rank: 0 });
    }
    return items.sort((a, b) => b.rank - a.rank).slice(0, 30);
  }, [q, state]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <Modal size="md" className="switcher">
      {(close) => (
        <div className="modal-body">
          <input
            className="input input-lg"
            autoFocus
            value={q}
            placeholder="Where would you like to go?"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter' && results[index]) { results[index].go(); close(); }
            }}
          />
          <div className="switcher-list" ref={listRef}>
            {results.map((r, i) => (
              <button key={r.key} className={`switcher-item${i === index ? ' active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => { r.go(); close(); }}>
                {r.kind === 'dm' && <Avatar user={r.user} size={24} status={r.user.presence} />}
                {r.kind === 'server' && <ServerGlyph server={r.server} size={24} />}
                {r.kind === 'text' && <Icon.Hash size={20} />}
                {r.kind === 'voice' && <Icon.Speaker size={20} />}
                <span className="switcher-label">{r.label}</span>
                {r.sub && <span className="switcher-sub">{r.sub}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- New DM ---------------- */

function NewDmModal() {
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const [q, setQ] = useState('');
  const friends = Object.entries(relationships)
    .filter(([, t]) => t === 'friend')
    .map(([id]) => users[id])
    .filter((u) => u && `${u.displayName} ${u.username}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <Modal size="sm">
      {(close) => (
        <div className="modal-body">
          <h2>New message</h2>
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" />
          <div className="pick-list">
            {friends.map((u) => (
              <button key={u.id} className="pick-row" onClick={() => { openDm(u.id); close(); }}>
                <Avatar user={u} size={32} status={u.presence} />
                <span className="pick-name">{u.displayName}</span>
                <span className="pick-sub">@{u.username}</span>
              </button>
            ))}
            {!friends.length && <div className="pick-empty">No friends found</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export const MODALS = {
  createServer: CreateServerModal,
  invite: InviteModal,
  createChannel: CreateChannelModal,
  channelSettings: ChannelSettingsModal,
  nickname: NicknameModal,
  confirm: ConfirmModal,
  image: ImageModal,
  screenPicker: ScreenPickerModal,
  quickSwitcher: QuickSwitcherModal,
  newDm: NewDmModal,
  settings: SettingsModal,
  serverSettings: ServerSettingsModal,
};

