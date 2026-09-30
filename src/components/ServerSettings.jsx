import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  channelTree, closeAllModals, createRole, deleteRole, deleteServer, fetchBans, openModal, reorderChannels, reorderRoles,
  resetInvite, setMemberRoles, toast, unbanMember, updateRole, updateServer,
} from '../lib/actions';
import { assetUrl } from '../lib/api';
import { colorFor, displayName, fullDate } from '../lib/format';
import { has, myTopPosition, P, permsFor, usePerms } from '../lib/perms';
import { PERMISSION_GROUPS } from '../../shared/permissions.js';
import { Avatar, Button, Field, Select, ServerGlyph, Switch, copyText, pickFiles, uploadImage } from './ui';
import { SettingsLayer } from './SettingsModal';
import { memberMenu, openRolePicker } from './MemberList';
import { ChannelIcon, isPrivateChannel } from './channelUi';
import Icon from './Icons';
import { DiscoveryTab, ServerTagTab } from './Discover';

const ROLE_COLORS = ['#4f7cff', '#2bb3ff', '#1fc7a8', '#3fcf6e', '#ffc24f', '#ff8a4f', '#ff5c7a', '#e05cff', '#8a6cff', '#99aab5'];

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewTab({ server }) {
  const channelsMap = useStore((s) => s.channels);
  const textChannels = useMemo(() => Object.values(channelsMap)
    .filter((c) => c.serverId === server.id && (c.type === 'text' || c.type === 'announcement')), [channelsMap, server.id]);
  const initial = () => ({
    name: server.name, icon: server.icon, banner: server.banner, description: server.description,
    systemChannelId: server.systemChannelId || '', rulesChannelId: server.rulesChannelId || '', joinMessages: server.joinMessages,
  });
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const upload = async (key, max) => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
    if (!file) return;
    setBusy(key);
    try { set(key, await uploadImage(file, max)); } catch (err) { toast(err.message, 'error'); }
    setBusy(null);
  };

  const save = async () => {
    setBusy('save');
    try { await updateServer(server.id, { ...draft, systemChannelId: draft.systemChannelId || null, rulesChannelId: draft.rulesChannelId || null }); } catch { /* toast shown */ }
    setBusy(null);
  };

  const channelOptions = [{ value: '', label: 'None' }, ...textChannels.map((c) => ({ value: c.id, label: `#${c.name}` }))];
  const banner = assetUrl(draft.banner);
  return (
    <>
      <h1>Overview</h1>
      <div className="server-overview">
        <div className="server-icon-edit">
          <button className="avatar-edit square" onClick={() => upload('icon', 512)}>
            <ServerGlyph server={{ ...server, icon: draft.icon }} size={96} />
            <span className="avatar-edit-overlay"><Icon.Camera size={22} /></span>
          </button>
          {draft.icon && <button className="link-btn subtle" onClick={() => set('icon', null)}>Remove</button>}
        </div>
        <div className="server-overview-fields">
          <Field label="Server name">
            <input className="input" value={draft.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea className="input textarea" rows={3} maxLength={300} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="settings-block">
        <h3>Banner</h3>
        <button className="banner-edit" onClick={() => upload('banner', 1600)} style={{ background: banner ? undefined : `linear-gradient(135deg, ${colorFor(server.id)}, var(--bg-3))` }}>
          {banner && <img src={banner} alt="" />}
          <span className="avatar-edit-overlay">{busy === 'banner' ? <span className="spinner" style={{ width: 20, height: 20 }} /> : <Icon.Camera size={22} />}</span>
        </button>
        {draft.banner && <button className="link-btn subtle" onClick={() => set('banner', null)}>Remove banner</button>}
      </div>
      <div className="settings-block">
        <h3>Welcome messages</h3>
        <div className="switch-row"><span>Post a message when someone joins</span><Switch checked={draft.joinMessages} onChange={(v) => set('joinMessages', v)} /></div>
        <Field label="Channel">
          <Select value={draft.systemChannelId} options={channelOptions} onChange={(v) => set('systemChannelId', v)} />
        </Field>
      </div>
      <div className="settings-block">
        <h3>Rules channel</h3>
        <Select value={draft.rulesChannelId} options={channelOptions} onChange={(v) => set('rulesChannelId', v)} />
      </div>
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="ghost" onClick={() => setDraft(initial())}>Reset</Button>
          <Button loading={busy === 'save'} disabled={!draft.name.trim()} onClick={save}>Save changes</Button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

function PermissionToggles({ value, onChange, disabled, mine }) {
  return PERMISSION_GROUPS.map((group) => (
    <div key={group.title} className="perm-group">
      <h3>{group.title}</h3>
      {group.items.map(([key, label]) => {
        const flag = P[key];
        const on = has(value, flag);
        const cantGrant = !on && !has(mine, P.ADMINISTRATOR) && !has(mine, flag);
        return (
          <div key={key} className="switch-row">
            <span>{label}</span>
            <Switch checked={on} disabled={disabled || cantGrant} onChange={(v) => onChange(v ? value | flag : value & ~flag)} />
          </div>
        );
      })}
    </div>
  ));
}

function RoleEditor({ server, role }) {
  const isEveryone = role.id === server.id;
  const members = useStore((s) => s.members[server.id] || {});
  const users = useStore((s) => s.users);
  const top = useStore((s) => myTopPosition(s, server.id));
  const mine = useStore((s) => permsFor(s, server.id));
  const locked = !isEveryone && role.position >= top;
  const initial = () => ({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions });
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState(isEveryone ? 'permissions' : 'display');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(initial()); setTab(isEveryone ? 'permissions' : 'display'); }, [role.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try { await updateRole(role.id, draft); toast('Role saved', 'success'); } catch { /* toast shown */ }
    setBusy(false);
  };

  const holders = Object.values(members).filter((m) => m.roles?.includes(role.id)).map((m) => ({ m, u: users[m.userId] })).filter((x) => x.u);

  return (
    <div className="role-editor">
      <div className="role-editor-head">
        <h2>Edit role <span className="role-editor-name" style={{ color: draft.color || undefined }}>{isEveryone ? '@everyone' : draft.name}</span></h2>
        <nav className="seg small">
          {!isEveryone && <button className={tab === 'display' ? 'active' : ''} onClick={() => setTab('display')}>Display</button>}
          <button className={tab === 'permissions' ? 'active' : ''} onClick={() => setTab('permissions')}>Permissions</button>
          {!isEveryone && <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members ({holders.length})</button>}
        </nav>
      </div>

      {tab === 'display' && (
        <div className="role-editor-body">
          <Field label="Role name">
            <input className="input" value={draft.name} maxLength={100} disabled={locked} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Role color">
            <div className="swatches big">
              <button className={`swatch none${!draft.color ? ' active' : ''}`} disabled={locked} onClick={() => set('color', null)} data-tip="Default">
                <Icon.Block size={16} />
              </button>
              {ROLE_COLORS.map((c) => (
                <button key={c} className={`swatch${draft.color === c ? ' active' : ''}`} disabled={locked} style={{ background: c }} onClick={() => set('color', c)} />
              ))}
              <label className={`swatch custom${draft.color && !ROLE_COLORS.includes(draft.color) ? ' active' : ''}`} style={{ background: draft.color && !ROLE_COLORS.includes(draft.color) ? draft.color : undefined }} data-tip="Custom">
                <Icon.Palette size={16} />
                <input type="color" value={draft.color || '#4f7cff'} disabled={locked} onChange={(e) => set('color', e.target.value)} />
              </label>
            </div>
          </Field>
          <div className="settings-block">
            <div className="switch-row"><span>Display members separately in the member list</span><Switch checked={draft.hoist} disabled={locked} onChange={(v) => set('hoist', v)} /></div>
            <div className="switch-row"><span>Allow anyone to @mention this role</span><Switch checked={draft.mentionable} disabled={locked} onChange={(v) => set('mentionable', v)} /></div>
          </div>
        </div>
      )}

      {tab === 'permissions' && (
        <div className="role-editor-body">
          <div className="row-end">
            <Button variant="ghost" disabled={locked} onClick={() => set('permissions', 0)}>Clear permissions</Button>
          </div>
          <PermissionToggles value={draft.permissions} onChange={(v) => set('permissions', v)} disabled={locked} mine={mine} />
        </div>
      )}

      {tab === 'members' && (
        <div className="role-editor-body">
          <div className="row-end">
            <Button disabled={locked} onClick={(e) => openModal('addRoleMembers', { serverId: server.id, roleId: role.id })}>
              <Icon.UserPlus size={15} /> Add members
            </Button>
          </div>
          <div className="list-card">
            {holders.map(({ m, u }) => (
              <div key={u.id} className="list-row">
                <Avatar user={u} size={28} />
                <span className="list-row-name">{displayName(u, m)}</span>
                <span className="list-row-sub">@{u.username}</span>
                <div className="list-row-actions">
                  <button className="round-btn no" disabled={locked} data-tip="Remove" onClick={() => setMemberRoles(server.id, u.id, m.roles.filter((id) => id !== role.id))}>
                    <Icon.X size={15} />
                  </button>
                </div>
              </div>
            ))}
            {!holders.length && <div className="pick-empty">No members have this role</div>}
          </div>
        </div>
      )}

      {!isEveryone && !locked && (
        <button className="link-btn danger-link" onClick={() => openModal('confirm', {
          title: `Delete ${role.name}`,
          body: 'Members with this role will lose it.',
          confirm: 'Delete role',
          danger: true,
          onConfirm: () => deleteRole(role.id),
        })}><Icon.Trash size={14} /> Delete role</button>
      )}

      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="ghost" onClick={() => setDraft(initial())}>Reset</Button>
          <Button loading={busy} onClick={save}>Save changes</Button>
        </div>
      )}
    </div>
  );
}

function RolesTab({ server }) {
  const roles = useStore((s) => s.roles[server.id] || []);
  const members = useStore((s) => s.members[server.id] || {});
  const top = useStore((s) => myTopPosition(s, server.id));
  const [selected, setSelected] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const role = roles.find((r) => r.id === selected) || roles.find((r) => r.id !== server.id) || roles.find((r) => r.id === server.id);
  const counts = useMemo(() => {
    const out = {};
    for (const m of Object.values(members)) for (const id of m.roles || []) out[id] = (out[id] || 0) + 1;
    return out;
  }, [members]);

  const drop = (targetId) => {
    if (!drag || drag === targetId) return;
    const ids = roles.filter((r) => r.id !== server.id).map((r) => r.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(targetId), 0, drag);
    reorderRoles(server.id, ids);
    setDrag(null);
    setOver(null);
  };

  const create = async () => {
    const r = await createRole(server.id).catch(() => null);
    if (r) setSelected(r.id);
  };

  return (
    <>
      <div className="settings-title-row">
        <h1>Roles</h1>
        <Button onClick={create}><Icon.Plus size={16} /> Create role</Button>
      </div>
      <div className="roles-layout">
        <div className="roles-list">
          {roles.map((r) => {
            const isEveryone = r.id === server.id;
            const movable = !isEveryone && r.position < top;
            return (
              <button
                key={r.id}
                className={`role-row${role?.id === r.id ? ' active' : ''}${over === r.id ? ' drop-target' : ''}`}
                draggable={movable}
                onDragStart={() => setDrag(r.id)}
                onDragOver={(e) => { if (drag && !isEveryone) { e.preventDefault(); setOver(r.id); } }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                onDrop={() => drop(r.id)}
                onClick={() => setSelected(r.id)}
              >
                {movable && <Icon.Grip size={14} className="grip" />}
                <span className="role-dot" style={{ background: r.color || 'var(--text-3)' }} />
                <span className="role-row-name">{isEveryone ? '@everyone' : r.name}</span>
                {!isEveryone && <span className="role-row-count"><Icon.Users size={13} /> {counts[r.id] || 0}</span>}
                {!movable && !isEveryone && <Icon.Lock size={13} className="role-lock" />}
              </button>
            );
          })}
        </div>
        {role && <RoleEditor key={role.id} server={server} role={role} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

function ChannelsTab({ server }) {
  const channelsMap = useStore((s) => s.channels);
  const tree = useMemo(() => channelTree({ channels: channelsMap }, server.id), [channelsMap, server.id]);
  const privateIds = useStore((s) => Object.values(s.channels).filter((c) => c.serverId === server.id && isPrivateChannel(s, c)).map((c) => c.id));
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);

  const flatten = (loose, groups) => [
    ...loose.map((c) => ({ id: c.id, parentId: null })),
    ...groups.flatMap((g) => [{ id: g.category.id, parentId: null }, ...g.channels.map((c) => ({ id: c.id, parentId: g.category.id }))]),
  ];

  const drop = (target) => {
    if (!drag || drag === target.id) { setDrag(null); setOver(null); return; }
    const dragged = channelsMap[drag];
    let loose = tree.loose.filter((c) => c.id !== drag);
    let groups = tree.categories.map((g) => ({ category: g.category, channels: g.channels.filter((c) => c.id !== drag) }));
    if (dragged.type === 'category') {
      const moving = tree.categories.find((g) => g.category.id === drag);
      groups = groups.filter((g) => g.category.id !== drag);
      const targetCat = target.type === 'category' ? target.id : target.parentId;
      const idx = targetCat ? groups.findIndex((g) => g.category.id === targetCat) : groups.length;
      groups.splice(idx < 0 ? groups.length : idx, 0, moving);
    } else if (target.type === 'category') {
      groups = groups.map((g) => (g.category.id === target.id ? { ...g, channels: [...g.channels, dragged] } : g));
    } else if (!target.parentId) {
      loose.splice(loose.findIndex((c) => c.id === target.id), 0, dragged);
    } else {
      groups = groups.map((g) => {
        if (g.category.id !== target.parentId) return g;
        const list = [...g.channels];
        list.splice(list.findIndex((c) => c.id === target.id), 0, dragged);
        return { ...g, channels: list };
      });
    }
    reorderChannels(server.id, flatten(loose, groups));
    setDrag(null);
    setOver(null);
  };

  const row = (c, depth = 0) => (
    <div
      key={c.id}
      className={`list-row draggable channel-list-row depth-${depth}${c.type === 'category' ? ' category' : ''}${over === c.id ? ' drop-target' : ''}${drag === c.id ? ' dragging' : ''}`}
      draggable
      onDragStart={() => setDrag(c.id)}
      onDragOver={(e) => { e.preventDefault(); setOver(c.id); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onDrop={() => drop(c)}
    >
      <Icon.Grip size={16} className="grip" />
      {c.type === 'category' ? <Icon.Folder size={18} /> : <ChannelIcon channel={c} server={server} isPrivate={privateIds.includes(c.id)} />}
      <span className="list-row-name">{c.type === 'category' ? c.name.toUpperCase() : c.name}</span>
      {c.topic && <span className="list-row-sub">{c.topic}</span>}
      <div className="list-row-actions">
        {c.type === 'category' && (
          <button className="round-btn" onClick={() => openModal('createChannel', { serverId: server.id, parentId: c.id })} data-tip="Create channel"><Icon.Plus size={16} /></button>
        )}
        <button className="round-btn" onClick={() => openModal('channelSettings', { channelId: c.id })} data-tip="Edit"><Icon.Edit size={16} /></button>
      </div>
    </div>
  );

  return (
    <>
      <div className="settings-title-row">
        <h1>Channels</h1>
        <div className="btn-row">
          <Button variant="soft" onClick={() => openModal('createChannel', { serverId: server.id, type: 'category' })}><Icon.FolderPlus size={16} /> Category</Button>
          <Button onClick={() => openModal('createChannel', { serverId: server.id })}><Icon.Plus size={16} /> Channel</Button>
        </div>
      </div>
      <div className="list-card">
        {tree.loose.map((c) => row(c))}
        {tree.categories.map((g) => [row(g.category), ...g.channels.map((c) => row(c, 1))])}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Members, bans, invites                                              */
/* ------------------------------------------------------------------ */

function MembersTab({ server }) {
  const members = useStore((s) => s.members[server.id]);
  const users = useStore((s) => s.users);
  const roles = useStore((s) => s.roles[server.id] || []);
  const canRoles = has(usePerms(server.id), P.MANAGE_ROLES);
  const [q, setQ] = useState('');
  const list = Object.values(members || {})
    .map((m) => ({ m, u: users[m.userId] }))
    .filter((x) => x.u && `${x.u.displayName} ${x.u.username} ${x.m.nickname || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => displayName(a.u, a.m).localeCompare(displayName(b.u, b.m)));

  return (
    <>
      <div className="settings-title-row">
        <h1>Members</h1>
        <span className="muted">{Object.keys(members || {}).length}</span>
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" />
      <div className="list-card">
        {list.map(({ m, u }) => (
          <div key={u.id} className="list-row member-admin-row" onContextMenu={(e) => memberMenu(e, { userId: u.id, serverId: server.id })}>
            <Avatar user={u} size={32} status={u.presence} />
            <div className="list-row-stack">
              <span className="list-row-name">{displayName(u, m)}{server.ownerId === u.id && <Icon.Crown size={13} className="owner-crown" />}</span>
              <span className="list-row-sub">@{u.username} - joined {fullDate(m.joinedAt)}</span>
            </div>
            <div className="role-chips inline">
              {roles.filter((r) => m.roles?.includes(r.id)).map((r) => (
                <span key={r.id} className="role-chip"><span className="role-chip-dot" style={{ background: r.color || 'var(--text-3)' }} />{r.name}</span>
              ))}
              {canRoles && (
                <button className="role-chip add" onClick={(e) => openRolePicker(e, server.id, u.id)} data-tip="Edit roles"><Icon.Plus size={13} strokeWidth={2.6} /></button>
              )}
            </div>
            <div className="list-row-actions">
              <button className="round-btn" onClick={(e) => memberMenu(e, { userId: u.id, serverId: server.id })} data-tip="More"><Icon.MoreV size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BansTab({ server }) {
  const [bans, setBans] = useState(null);
  const load = () => fetchBans(server.id).then(setBans).catch((err) => toast(err.message, 'error'));
  useEffect(() => { load(); }, [server.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <h1>Bans</h1>
      <div className="list-card">
        {bans === null && <div className="pick-empty"><span className="spinner" style={{ width: 18, height: 18 }} /></div>}
        {bans?.map((b) => (
          <div key={b.user.id} className="list-row">
            <Avatar user={b.user} size={32} />
            <div className="list-row-stack">
              <span className="list-row-name">{displayName(b.user)}</span>
              <span className="list-row-sub">@{b.user.username}{b.reason ? ` - ${b.reason}` : ''}</span>
            </div>
            <div className="list-row-actions">
              <Button variant="soft" onClick={async () => { await unbanMember(server.id, b.user.id).catch(() => {}); load(); }}>Unban</Button>
            </div>
          </div>
        ))}
        {bans?.length === 0 && <div className="pick-empty">No bans</div>}
      </div>
    </>
  );
}

function InvitesTab({ server }) {
  const [copied, setCopied] = useState(false);
  const canReset = has(usePerms(server.id), P.MANAGE_SERVER);
  return (
    <>
      <h1>Invites</h1>
      <Field label="Invite code">
        <div className={`copy-box${copied ? ' copied' : ''}`}>
          <span className="mono">{server.inviteCode}</span>
          <Button onClick={async () => { await copyText(server.inviteCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </Field>
      {canReset && <Button variant="soft" onClick={() => resetInvite(server.id)}><Icon.Refresh size={15} /> Generate new code</Button>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export default function ServerSettingsModal({ serverId, tab: initialTab }) {
  const server = useStore((s) => s.servers[serverId]);
  const isOwner = useStore((s) => s.servers[serverId]?.ownerId === s.me.id);
  const perms = usePerms(serverId);
  const tabs = [
    has(perms, P.MANAGE_SERVER) && { id: 'overview', label: 'Overview', icon: Icon.Settings },
    has(perms, P.MANAGE_ROLES) && { id: 'roles', label: 'Roles', icon: Icon.Tag },
    has(perms, P.MANAGE_CHANNELS) && { id: 'channels', label: 'Channels', icon: Icon.Hash },
    [P.KICK_MEMBERS, P.BAN_MEMBERS, P.MANAGE_ROLES, P.MANAGE_NICKNAMES].some((f) => has(perms, f)) && { id: 'members', label: 'Members', icon: Icon.Users },
    has(perms, P.BAN_MEMBERS) && { id: 'bans', label: 'Bans', icon: Icon.Block },
    has(perms, P.CREATE_INVITE) && { id: 'invites', label: 'Invites', icon: Icon.Link },
    has(perms, P.MANAGE_SERVER) && { id: 'tag', label: 'Server Tag', icon: Icon.Tag },
    has(perms, P.MANAGE_SERVER) && { id: 'discovery', label: 'Discovery', icon: Icon.Compass },
  ].filter(Boolean);
  const [tab, setTab] = useState(initialTab || tabs[0]?.id);
  if (!server) return null;

  const nav = [
    { heading: server.name },
    ...tabs,
    ...(isOwner ? [{ separator: true }, {
      id: 'delete',
      label: 'Delete server',
      icon: Icon.Trash,
      danger: true,
      onClick: () => openModal('confirm', {
        title: `Delete ${server.name}`,
        body: 'This permanently deletes the server, its channels and messages.',
        confirm: 'Delete server',
        danger: true,
        onConfirm: async () => { await deleteServer(serverId); closeAllModals(); },
      }),
    }] : []),
  ];
  return (
    <SettingsLayer nav={nav} tab={tab} setTab={setTab}>
      {tab === 'overview' && <OverviewTab server={server} />}
      {tab === 'roles' && <RolesTab server={server} />}
      {tab === 'channels' && <ChannelsTab server={server} />}
      {tab === 'members' && <MembersTab server={server} />}
      {tab === 'bans' && <BansTab server={server} />}
      {tab === 'invites' && <InvitesTab server={server} />}
      {tab === 'tag' && <ServerTagTab server={server} />}
      {tab === 'discovery' && <DiscoveryTab server={server} />}
    </SettingsLayer>
  );
}

