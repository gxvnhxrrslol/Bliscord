import { useEffect, useState } from 'react';
import { getState, setState, useStore } from '../lib/store';
import { call, assetUrl } from '../lib/api';
import { joinServer, selectServer, toast, updateServer, updateProfile, openModal } from '../lib/actions';
import { can, P } from '../lib/perms';
import { colorFor } from '../lib/format';
import { Button, Field, Select, ServerGlyph } from './ui';
import { TAG_ICONS, TagChip } from './Badges';
import Icon from './Icons';

export const DISCOVER_CATEGORIES = [
  { id: 'gaming', label: 'Gaming', icon: Icon.Gamepad },
  { id: 'music', label: 'Music', icon: Icon.Music },
  { id: 'entertainment', label: 'Entertainment', icon: Icon.Sparkle },
  { id: 'science', label: 'Science & Tech', icon: Icon.Code },
  { id: 'education', label: 'Education', icon: Icon.Book },
  { id: 'student', label: 'Student Hubs', icon: Icon.Users },
  { id: 'community', label: 'Community', icon: Icon.Heart },
];

/* ------------------------------------------------------------------ */
/* Discover page                                                       */
/* ------------------------------------------------------------------ */

export function DiscoverSidebar() {
  const category = useStore((s) => s.view.category || null);
  return (
    <div className="discover-side">
      <div className="discover-side-title">Discover</div>
      <nav>
        <button className={`discover-nav${!category ? ' active' : ''}`} onClick={() => openDiscover(null)}>
          <Icon.Compass size={19} /> Home
        </button>
        {DISCOVER_CATEGORIES.map((c) => (
          <button key={c.id} className={`discover-nav${category === c.id ? ' active' : ''}`} onClick={() => openDiscover(c.id)}>
            <c.icon size={19} /> {c.label}
          </button>
        ))}
      </nav>
      <button className="discover-submit" onClick={() => openModal('discoverySubmit')}>
        <Icon.Upload size={17} /> List your server
      </button>
    </div>
  );
}

export function openDiscover(category = null) {
  setState({ view: { kind: 'discover', category } });
}

function DiscoverCard({ server }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (server.joined) { selectServer(server.id); return; }
    setBusy(true);
    try { await joinServer(server.inviteCode); } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  const banner = assetUrl(server.banner);
  return (
    <button className="discover-card" onClick={open} disabled={busy}>
      <div className="discover-banner" style={banner ? { backgroundImage: `url("${banner}")` } : { '--c': colorFor(server.id) }} />
      <div className="discover-icon"><ServerGlyph server={server} size={52} /></div>
      <div className="discover-card-body">
        <h3>
          {server.official && <span className="discover-verified" data-tip="Official"><Icon.Seal size={16} /></span>}
          {server.name}
          {server.tag && <TagChip tag={server.tag} tip={null} />}
        </h3>
        <p>{server.description}</p>
        <div className="discover-stats">
          <span><i className="dot online" />{server.onlineCount.toLocaleString()} Online</span>
          <span><i className="dot" />{server.memberCount.toLocaleString()} Members</span>
          {server.joined && <span className="discover-joined">Joined</span>}
        </div>
      </div>
    </button>
  );
}

export function DiscoverView() {
  const category = useStore((s) => s.view.category || null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    setList(null);
    const t = setTimeout(() => {
      call('discovery:list', { category, query: query.trim() }).then((r) => live && setList(r)).catch(() => live && setList([]));
    }, query ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [category, query]);
  const cat = DISCOVER_CATEGORIES.find((c) => c.id === category);

  return (
    <div className="discover">
      <header className="discover-tabs">
        <Icon.Compass size={20} className="discover-logo" />
        <button className={!category ? 'active' : ''} onClick={() => openDiscover(null)}>Home</button>
        {DISCOVER_CATEGORIES.map((c) => (
          <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => openDiscover(c.id)}>{c.label}</button>
        ))}
        <label className="discover-search">
          <Icon.Search size={15} />
          <input value={query} placeholder="Search" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </header>
      <div className="discover-scroll">
        <section className="discover-hero">
          <h1>{cat ? cat.label : <>Find your community<br />on Bliscord</>}</h1>
        </section>
        <section className="discover-section">
          <h2>{query ? 'Results' : cat ? `Popular in ${cat.label}` : 'Featured Servers'}</h2>
          {!list ? (
            <div className="discover-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="discover-card skeleton" />)}</div>
          ) : list.length ? (
            <div className="discover-grid">{list.map((s) => <DiscoverCard key={s.id} server={s} />)}</div>
          ) : (
            <div className="discover-empty">
              <Icon.Compass size={38} />
              <span>No servers here yet</span>
              <Button variant="soft" onClick={() => openModal('discoverySubmit')}>List your server</Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Listing request                                                     */
/* ------------------------------------------------------------------ */

const STATUS_TEXT = { pending: 'Waiting for review', approved: 'Listed on Discover', rejected: 'Not approved' };

export function DiscoveryForm({ serverId, onDone }) {
  const [data, setData] = useState(undefined);
  const [category, setCategory] = useState('gaming');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(undefined);
    call('discovery:status', { serverId }).then((d) => {
      if (!live) return;
      setData(d);
      if (d) { setCategory(d.category); setDescription(d.description); }
      else setDescription(getState().servers[serverId]?.description || '');
    }).catch(() => live && setData(null));
    return () => { live = false; };
  }, [serverId]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await call('discovery:submit', { serverId, category, description });
      toast(r.status === 'approved' ? 'Listing updated' : 'Request sent', 'success');
      setData((d) => ({ ...d, category, description, status: r.status, note: '' }));
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const withdraw = async () => {
    try { await call('discovery:withdraw', { serverId }); setData(null); } catch (e) { toast(e.message, 'error'); }
  };

  if (data === undefined) return <div className="discover-status"><span className="spinner" /></div>;
  return (
    <>
      {data && (
        <div className={`discover-status ${data.status}`}>
          <b>{STATUS_TEXT[data.status]}</b>
          {data.note && <span>{data.note}</span>}
        </div>
      )}
      <Field label="Category">
        <div className="discover-cats">
          {DISCOVER_CATEGORIES.map((c) => (
            <button key={c.id} className={`discover-cat${category === c.id ? ' active' : ''}`} onClick={() => setCategory(c.id)}>
              <c.icon size={17} /> {c.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Description">
        <textarea className="input textarea" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="modal-footer">
        {data && <Button variant="ghost" onClick={withdraw}>{data.status === 'approved' ? 'Remove listing' : 'Cancel request'}</Button>}
        <Button loading={busy} disabled={description.trim().length < 10} onClick={submit}>
          {data?.status === 'approved' ? 'Update listing' : data ? 'Resubmit' : 'Submit request'}
        </Button>
      </div>
    </>
  );
}

export function DiscoverySubmitModalBody({ close }) {
  const state = getState();
  const servers = state.serverOrder.map((id) => state.servers[id]).filter((s) => s && can(state, s.id, P.MANAGE_SERVER));
  const [serverId, setServerId] = useState(servers[0]?.id || '');
  return (
    <div className="modal-body">
      <h2>List your server on Discover</h2>
      {servers.length ? (
        <>
          <Field label="Server">
            <Select value={serverId} options={servers.map((s) => ({ value: s.id, label: s.name }))} onChange={setServerId} />
          </Field>
          <DiscoveryForm key={serverId} serverId={serverId} onDone={close} />
        </>
      ) : (
        <span className="modal-sub">You need to own or manage a server first</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Server tag editor (server settings)                                 */
/* ------------------------------------------------------------------ */

const TAG_COLORS = ['#4f7cff', '#2bb3ff', '#1fc7a8', '#3fcf6e', '#ffc24f', '#ff8a4f', '#ff5c7a', '#e05cff', '#8a6cff', '#c9d1e0'];

export function ServerTagTab({ server }) {
  const me = useStore((s) => s.me);
  const initial = () => server.tag || { text: '', icon: 'star', color: '#4f7cff' };
  const [draft, setDraft] = useState(initial);
  const [emoji, setEmoji] = useState(server.tag && !TAG_ICONS[server.tag.icon] ? server.tag.icon : '');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const wearing = me.profile?.tagServer === server.id;

  const save = async () => {
    setBusy(true);
    try { await updateServer(server.id, { tag: draft }); } catch { /* toast shown */ }
    setBusy(false);
  };
  const wear = async (on) => {
    try { await updateProfile({ profile: { ...(me.profile || {}), tagServer: on ? server.id : undefined } }); toast(on ? 'Tag added to your profile' : 'Tag removed', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());

  return (
    <>
      <h1>Server Tag</h1>
      <div className="tag-editor">
        <div className="tag-preview">
          <div className="tag-preview-line">
            <span className="tag-preview-name">{me.displayName}</span>
            <TagChip tag={draft.text ? draft : { ...draft, text: 'TAG' }} size="lg" tip={null} />
          </div>
          <div className="tag-preview-line small">
            <span className="tag-preview-name">{me.displayName}</span>
            <TagChip tag={draft.text ? draft : { ...draft, text: 'TAG' }} tip={null} />
            <span className="tag-preview-time">Today at 12:00</span>
          </div>
        </div>
        <Field label="Tag">
          <input
            className="input tag-input"
            value={draft.text}
            maxLength={5}
            placeholder="BLSC"
            onChange={(e) => set('text', e.target.value.replace(/\s/g, ''))}
          />
        </Field>
        <Field label="Icon">
          <div className="tag-icons">
            {Object.entries(TAG_ICONS).map(([key, I]) => (
              <button key={key} className={`tag-icon${draft.icon === key ? ' active' : ''}`} onClick={() => { set('icon', key); setEmoji(''); }} style={{ '--tag': draft.color }}>
                <I size={18} strokeWidth={2.2} />
              </button>
            ))}
            <input
              className={`input tag-emoji${emoji && draft.icon === emoji ? ' active' : ''}`}
              value={emoji}
              placeholder="Emoji"
              maxLength={8}
              onChange={(e) => { const v = e.target.value.trim(); setEmoji(v); if (v) set('icon', v); }}
            />
          </div>
        </Field>
        <Field label="Color">
          <div className="swatches big">
            {TAG_COLORS.map((c) => (
              <button key={c} className={`swatch${draft.color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => set('color', c)} />
            ))}
            <label className={`swatch custom${!TAG_COLORS.includes(draft.color) ? ' active' : ''}`} style={{ background: !TAG_COLORS.includes(draft.color) ? draft.color : undefined }}>
              <Icon.Palette size={16} />
              <input type="color" value={draft.color} onChange={(e) => set('color', e.target.value)} />
            </label>
          </div>
        </Field>
        {server.tag && (
          <div className="settings-block">
            <div className="switch-row">
              <span>Show this tag next to my name</span>
              <Button variant={wearing ? 'ghost' : 'soft'} onClick={() => wear(!wearing)}>{wearing ? 'Remove' : 'Use tag'}</Button>
            </div>
          </div>
        )}
        {server.tag && <Button variant="ghost" className="tag-remove" onClick={() => updateServer(server.id, { tag: null }).then(() => setDraft({ text: '', icon: 'star', color: '#4f7cff' })).catch(() => {})}>Remove server tag</Button>}
      </div>
      {dirty && draft.text && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="ghost" onClick={() => setDraft(initial())}>Reset</Button>
          <Button loading={busy} onClick={save}>Save changes</Button>
        </div>
      )}
    </>
  );
}

export function DiscoveryTab({ server }) {
  return (
    <>
      <h1>Discovery</h1>
      <DiscoveryForm serverId={server.id} />
    </>
  );
}

/** Profile setting: which server tag to wear. */
export function TagPicker() {
  const me = useStore((s) => s.me);
  const servers = useStore((s) => s.serverOrder.map((id) => s.servers[id]).filter((srv) => srv?.tag));
  if (!servers.length) return null;
  const current = me.profile?.tagServer || '';
  const choose = (id) => updateProfile({ profile: { ...(me.profile || {}), tagServer: id || undefined } }).catch((e) => toast(e.message, 'error'));
  return (
    <Field label="Server tag">
      <div className="tag-choices">
        <button className={`tag-choice${!current ? ' active' : ''}`} onClick={() => choose('')}>None</button>
        {servers.map((srv) => (
          <button key={srv.id} className={`tag-choice${current === srv.id ? ' active' : ''}`} onClick={() => choose(srv.id)}>
            <TagChip tag={srv.tag} tip={null} />
            <span>{srv.name}</span>
          </button>
        ))}
      </div>
    </Field>
  );
}
