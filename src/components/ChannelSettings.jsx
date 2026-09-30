import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { deleteChannel, closeAllModals, fetchFollows, openMenu, openModal, setChannelPermissions, unfollowChannel, updateChannel, updateServer } from '../lib/actions';
import { displayName } from '../lib/format';
import { has, P, usePerms } from '../lib/perms';
import { CHANNEL_SCOPED, PERMISSION_GROUPS } from '../../shared/permissions.js';
import { Avatar, Button, Field, Select, ServerGlyph, Slider, Switch } from './ui';
import { SettingsLayer } from './SettingsModal';
import { CHANNEL_TYPE_LABELS } from './channelUi';
import Icon from './Icons';

const SLOWMODE = [
  [0, 'Off'], [5, '5 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'],
  [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [3600, '1 hour'], [7200, '2 hours'], [21600, '6 hours'],
];

const TEXT_ONLY = ['SEND_MESSAGES', 'READ_HISTORY', 'ATTACH_FILES', 'MENTION_EVERYONE', 'MANAGE_MESSAGES'];
const VOICE_ONLY = ['CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS'];

function groupsFor(type) {
  return PERMISSION_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter(([key]) => {
      if (!(CHANNEL_SCOPED & P[key])) return false;
      if (type === 'voice' && TEXT_ONLY.includes(key)) return false;
      if ((type === 'text' || type === 'announcement') && VOICE_ONLY.includes(key)) return false;
      return true;
    }),
  })).filter((g) => g.items.length);
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewTab({ channel }) {
  const channelsMap = useStore((s) => s.channels);
  const categories = useMemo(() => Object.values(channelsMap).filter((c) => c.serverId === channel.serverId && c.type === 'category'), [channelsMap, channel.serverId]);
  const isText = channel.type === 'text' || channel.type === 'announcement';
  const initial = () => ({ name: channel.name, type: channel.type, topic: channel.topic || '', slowmode: channel.slowmode || 0, userLimit: channel.userLimit || 0, parentId: channel.parentId || '' });
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(initial()); }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    const patch = { name: draft.name };
    if (isText) Object.assign(patch, { type: draft.type, topic: draft.topic, slowmode: draft.slowmode });
    if (channel.type === 'voice') patch.userLimit = draft.userLimit;
    if (channel.type !== 'category') patch.parentId = draft.parentId || null;
    try { await updateChannel(channel.id, patch); } catch { /* toast shown */ }
    setBusy(false);
  };

  return (
    <>
      <h1>Overview</h1>
      <Field label={channel.type === 'category' ? 'Category name' : 'Channel name'}>
        <input
          className="input"
          value={draft.name}
          maxLength={100}
          onChange={(e) => set('name', isText ? e.target.value.toLowerCase().replace(/\s+/g, '-') : e.target.value)}
        />
      </Field>
      {isText && (
        <Field label="Channel type">
          <div className="seg">
            {[['text', Icon.Hash, 'Text'], ['announcement', Icon.Megaphone, 'Announcement']].map(([t, I, label]) => (
              <button key={t} className={draft.type === t ? 'active' : ''} onClick={() => set('type', t)}>
                <I size={15} /> {label}
              </button>
            ))}
          </div>
        </Field>
      )}
      {isText && (
        <Field label="Topic">
          <textarea className="input textarea" rows={3} maxLength={1024} value={draft.topic} onChange={(e) => set('topic', e.target.value)} />
        </Field>
      )}
      {isText && (
        <Field label="Slowmode">
          <Select value={String(draft.slowmode)} options={SLOWMODE.map(([v, l]) => ({ value: String(v), label: l }))} onChange={(v) => set('slowmode', Number(v))} />
        </Field>
      )}
      {channel.type === 'voice' && (
        <Field label="User limit">
          <Slider value={draft.userLimit} min={0} max={99} onChange={(v) => set('userLimit', v)} format={(v) => (v ? `${v}` : 'None')} />
        </Field>
      )}
      {channel.type !== 'category' && (
        <Field label="Category">
          <Select
            value={draft.parentId}
            options={[{ value: '', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => set('parentId', v)}
          />
        </Field>
      )}
      {isText && <SpecialChannel channel={channel} />}
      {isText && <FollowedChannels channel={channel} />}
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="ghost" onClick={() => setDraft(initial())}>Reset</Button>
          <Button loading={busy} disabled={!draft.name.trim()} onClick={save}>Save changes</Button>
        </div>
      )}
    </>
  );
}

/** Rules channel and welcome message channel switches, saved right away. */
function SpecialChannel({ channel }) {
  const server = useStore((s) => s.servers[channel.serverId]);
  const perms = usePerms(channel.serverId);
  if (!server || !has(perms, P.MANAGE_SERVER)) return null;
  const isRules = server.rulesChannelId === channel.id;
  const isSystem = server.systemChannelId === channel.id;
  return (
    <Field label="Use this channel for">
      <div className="settings-block">
        <div className="switch-row">
          <span><Icon.Book size={15} className="inline-icon" /> Rules channel</span>
          <Switch checked={isRules} onChange={(v) => updateServer(server.id, { rulesChannelId: v ? channel.id : null }).catch(() => {})} />
        </div>
        <div className="switch-row">
          <span><Icon.UserPlus size={15} className="inline-icon" /> Welcome messages</span>
          <Switch checked={isSystem} onChange={(v) => updateServer(server.id, { systemChannelId: v ? channel.id : null }).catch(() => {})} />
        </div>
      </div>
    </Field>
  );
}

/** Announcement channels from other servers that post into this one. */
function FollowedChannels({ channel }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    fetchFollows(channel.id).then((d) => live && setData(d)).catch(() => {});
    return () => { live = false; };
  }, [channel.id]);
  if (!data || (!data.following.length && !(channel.type === 'announcement' && data.followers))) return null;
  return (
    <Field label="Following">
      {channel.type === 'announcement' && data.followers > 0 && (
        <div className="follow-row">
          <Icon.Follow size={18} />
          <div className="follow-meta"><b>{data.followers} {data.followers === 1 ? 'channel follows' : 'channels follow'} this one</b></div>
        </div>
      )}
      <div className="follow-list">
        {data.following.map((f) => (
          <div className="follow-row" key={f.channelId}>
            <ServerGlyph server={{ id: f.serverId, name: f.serverName, icon: f.serverIcon }} size={32} />
            <div className="follow-meta"><b>{f.serverName}</b><small>#{f.channelName}</small></div>
            <Button
              variant="ghost"
              onClick={async () => {
                const following = await unfollowChannel(f.channelId, channel.id).catch(() => null);
                if (following) setData((d) => ({ ...d, following }));
              }}
            >
              Unfollow
            </Button>
          </div>
        ))}
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

function TriState({ value, onChange, disabled }) {
  return (
    <div className={`tri${disabled ? ' disabled' : ''}`}>
      <button className={`tri-btn deny${value === 'deny' ? ' on' : ''}`} disabled={disabled} onClick={() => onChange('deny')} aria-label="Deny"><Icon.X size={14} strokeWidth={2.6} /></button>
      <button className={`tri-btn neutral${value === 'neutral' ? ' on' : ''}`} disabled={disabled} onClick={() => onChange('neutral')} aria-label="Inherit"><span className="tri-slash" /></button>
      <button className={`tri-btn allow${value === 'allow' ? ' on' : ''}`} disabled={disabled} onClick={() => onChange('allow')} aria-label="Allow"><Icon.Check size={14} strokeWidth={2.6} /></button>
    </div>
  );
}

function PermissionsTab({ channel }) {
  const roles = useStore((s) => s.roles[channel.serverId] || []);
  const members = useStore((s) => s.members[channel.serverId] || {});
  const users = useStore((s) => s.users);
  const parent = useStore((s) => (channel.parentId ? s.channels[channel.parentId] : null));
  const everyoneId = channel.serverId;

  const initial = () => {
    const source = channel.synced && parent ? parent.overwrites : channel.overwrites;
    const list = (source || []).map((o) => ({ ...o }));
    if (!list.some((o) => o.id === everyoneId)) list.unshift({ id: everyoneId, type: 'role', allow: 0, deny: 0 });
    return { synced: Boolean(channel.synced && parent), overwrites: list };
  };
  const [draft, setDraft] = useState(initial);
  const [selected, setSelected] = useState(everyoneId);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(initial()); }, [channel.id, channel.synced, JSON.stringify(channel.overwrites), JSON.stringify(parent?.overwrites)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());

  const nameOf = (o) => {
    if (o.type === 'member') return displayName(users[o.id], members[o.id]);
    if (o.id === everyoneId) return '@everyone';
    return roles.find((r) => r.id === o.id)?.name || 'Deleted role';
  };
  const colorOf = (o) => (o.type === 'role' ? roles.find((r) => r.id === o.id)?.color : null);
  const current = draft.overwrites.find((o) => o.id === selected) || draft.overwrites[0];

  const setFlag = (flag, state) => setDraft((d) => ({
    synced: false,
    overwrites: d.overwrites.map((o) => {
      if (o.id !== current.id) return o;
      const allow = state === 'allow' ? o.allow | flag : o.allow & ~flag;
      const deny = state === 'deny' ? o.deny | flag : o.deny & ~flag;
      return { ...o, allow, deny };
    }),
  }));

  const addTarget = (e) => {
    const taken = new Set(draft.overwrites.map((o) => o.id));
    const roleItems = roles.filter((r) => r.id !== everyoneId && !taken.has(r.id)).map((r) => ({
      label: r.name, icon: Icon.Tag, onClick: () => { setDraft((d) => ({ synced: false, overwrites: [...d.overwrites, { id: r.id, type: 'role', allow: 0, deny: 0 }] })); setSelected(r.id); },
    }));
    const memberItems = Object.keys(members).filter((id) => !taken.has(id)).slice(0, 25).map((id) => ({
      label: displayName(users[id], members[id]), icon: Icon.User, onClick: () => { setDraft((d) => ({ synced: false, overwrites: [...d.overwrites, { id, type: 'member', allow: 0, deny: 0 }] })); setSelected(id); },
    }));
    openMenu(e, [...roleItems, ...(roleItems.length && memberItems.length ? [{ separator: true }] : []), ...memberItems]);
  };

  const removeTarget = (id) => {
    setDraft((d) => ({ synced: false, overwrites: d.overwrites.filter((o) => o.id !== id) }));
    setSelected(everyoneId);
  };

  const save = async () => {
    setBusy(true);
    try { await setChannelPermissions(channel.id, draft.overwrites, draft.synced); } catch { /* toast shown */ }
    setBusy(false);
  };

  const makePrivate = (on) => {
    setDraft((d) => ({
      synced: false,
      overwrites: d.overwrites.map((o) => (o.id === everyoneId
        ? { ...o, allow: o.allow & ~P.VIEW_CHANNEL, deny: on ? o.deny | P.VIEW_CHANNEL : o.deny & ~P.VIEW_CHANNEL }
        : o)),
    }));
  };
  const everyone = draft.overwrites.find((o) => o.id === everyoneId);
  const isPrivate = Boolean(everyone && has(everyone.deny, P.VIEW_CHANNEL));

  return (
    <>
      <h1>Permissions</h1>
      {parent && (
        <div className="switch-row">
          <span>Sync permissions with {parent.name}</span>
          <Switch checked={draft.synced} onChange={(v) => setDraft(v ? { synced: true, overwrites: initial().synced ? initial().overwrites : (parent.overwrites || []).map((o) => ({ ...o })) } : { ...draft, synced: false })} />
        </div>
      )}
      <div className="switch-row">
        <span><Icon.Lock size={15} className="inline-icon" /> Private {channel.type === 'category' ? 'category' : 'channel'}</span>
        <Switch checked={isPrivate} onChange={makePrivate} />
      </div>
      <div className="perm-layout">
        <div className="perm-targets">
          <div className="perm-targets-head">
            <span className="field-label">Roles and members</span>
            <button className="section-add" onClick={addTarget} data-tip="Add"><Icon.Plus size={16} /></button>
          </div>
          {draft.overwrites.map((o) => (
            <button key={o.id} className={`perm-target${current?.id === o.id ? ' active' : ''}`} onClick={() => setSelected(o.id)}>
              {o.type === 'member' ? <Avatar user={users[o.id]} size={20} decorate={false} /> : <span className="role-dot" style={{ background: colorOf(o) || 'var(--text-3)' }} />}
              <span className="perm-target-name">{nameOf(o)}</span>
              {o.id !== everyoneId && (
                <span className="perm-target-remove" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); removeTarget(o.id); }}><Icon.X size={12} /></span>
              )}
            </button>
          ))}
        </div>
        <div className="perm-flags">
          {current && groupsFor(channel.type).map((g) => (
            <div key={g.title} className="perm-group">
              <h3>{g.title}</h3>
              {g.items.map(([key, label]) => {
                const flag = P[key];
                const state = has(current.allow, flag) ? 'allow' : has(current.deny, flag) ? 'deny' : 'neutral';
                return (
                  <div key={key} className="switch-row">
                    <span>{label}</span>
                    <TriState value={state} onChange={(st) => setFlag(flag, st)} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="ghost" onClick={() => setDraft(initial())}>Reset</Button>
          <Button loading={busy} onClick={save}>Save changes</Button>
        </div>
      )}
    </>
  );
}

export default function ChannelSettingsModal({ channelId, tab: initialTab = 'overview' }) {
  const channel = useStore((s) => s.channels[channelId]);
  const perms = usePerms(channel?.serverId, channelId);
  const canEdit = has(perms, P.MANAGE_CHANNELS);
  const canPerms = has(perms, P.MANAGE_ROLES);
  const [tab, setTab] = useState(canEdit ? initialTab : 'permissions');
  if (!channel) return null;
  const label = channel.type === 'category' ? channel.name.toUpperCase() : `${channel.type === 'voice' ? '' : '#'}${channel.name}`;
  const nav = [
    { heading: `${label} - ${CHANNEL_TYPE_LABELS[channel.type]}` },
    ...(canEdit ? [{ id: 'overview', label: 'Overview', icon: Icon.Settings }] : []),
    ...(canPerms ? [{ id: 'permissions', label: 'Permissions', icon: Icon.Lock }] : []),
    ...(canEdit ? [{ separator: true }, {
      id: 'delete',
      label: `Delete ${channel.type === 'category' ? 'category' : 'channel'}`,
      icon: Icon.Trash,
      danger: true,
      onClick: () => openModal('confirm', {
        title: `Delete ${label}`,
        body: channel.type === 'category' ? 'The channels inside it will be kept.' : 'This cannot be undone.',
        confirm: 'Delete',
        danger: true,
        onConfirm: async () => { await deleteChannel(channelId); closeAllModals(); },
      }),
    }] : []),
  ];
  return (
    <SettingsLayer nav={nav} tab={tab} setTab={setTab}>
      {tab === 'overview' && <OverviewTab channel={channel} />}
      {tab === 'permissions' && <PermissionsTab channel={channel} />}
    </SettingsLayer>
  );
}
