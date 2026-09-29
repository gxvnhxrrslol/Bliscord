import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  closeAllModals, deleteServer, kickMember, openModal, reorderChannels, resetInvite, serverChannels, setMemberRole,
  toast, transferServer, updateServer,
} from '../lib/actions';
import { assetUrl } from '../lib/api';
import { colorFor, displayName, fullDate } from '../lib/format';
import { Avatar, Button, Field, ServerGlyph, copyText, pickFiles, uploadImage } from './ui';
import { SettingsLayer } from './SettingsModal';
import Icon from './Icons';

function OverviewTab({ server }) {
  const initial = () => ({ name: server.name, icon: server.icon, banner: server.banner, description: server.description });
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());

  const upload = async (key, max) => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
    if (!file) return;
    setBusy(key);
    try {
      const url = await uploadImage(file, max);
      setDraft((d) => ({ ...d, [key]: url }));
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(null);
  };

  const save = async () => {
    setBusy('save');
    try { await updateServer(server.id, draft); } catch { /* toast shown */ }
    setBusy(null);
  };

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
          {draft.icon && <button className="link-btn subtle" onClick={() => setDraft((d) => ({ ...d, icon: null }))}>Remove</button>}
        </div>
        <div className="server-overview-fields">
          <Field label="Server name">
            <input className="input" value={draft.name} maxLength={100} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea className="input textarea" rows={3} maxLength={300} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </Field>
        </div>
      </div>
      <div className="settings-block">
        <h3>Banner</h3>
        <button className="banner-edit" onClick={() => upload('banner', 1600)} style={{ background: banner ? undefined : `linear-gradient(135deg, ${colorFor(server.id)}, var(--bg-3))` }}>
          {banner && <img src={banner} alt="" />}
          <span className="avatar-edit-overlay">{busy === 'banner' ? <span className="spinner" style={{ width: 20, height: 20 }} /> : <Icon.Camera size={22} />}</span>
        </button>
        {draft.banner && <button className="link-btn subtle" onClick={() => setDraft((d) => ({ ...d, banner: null }))}>Remove banner</button>}
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

function ChannelsTab({ server }) {
  const channelsMap = useStore((s) => s.channels);
  const channels = useMemo(() => serverChannels({ channels: channelsMap }, server.id), [channelsMap, server.id]);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);

  const drop = (targetId) => {
    if (!drag || drag === targetId) return;
    const ids = channels.map((c) => c.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(targetId), 0, drag);
    reorderChannels(server.id, ids);
    setDrag(null);
    setOver(null);
  };

  return (
    <>
      <div className="settings-title-row">
        <h1>Channels</h1>
        <Button onClick={() => openModal('createChannel', { serverId: server.id })}><Icon.Plus size={16} /> Create channel</Button>
      </div>
      <div className="list-card">
        {channels.map((c) => (
          <div
            key={c.id}
            className={`list-row draggable${over === c.id ? ' drop-target' : ''}${drag === c.id ? ' dragging' : ''}`}
            draggable
            onDragStart={() => setDrag(c.id)}
            onDragOver={(e) => { e.preventDefault(); setOver(c.id); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={() => drop(c.id)}
          >
            <Icon.Grip size={16} className="grip" />
            {c.type === 'voice' ? <Icon.Speaker size={18} /> : <Icon.Hash size={18} />}
            <span className="list-row-name">{c.name}</span>
            {c.topic && <span className="list-row-sub">{c.topic}</span>}
            <div className="list-row-actions">
              <button className="round-btn" onClick={() => openModal('channelSettings', { channelId: c.id })} data-tip="Edit"><Icon.Edit size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function MembersTab({ server }) {
  const members = useStore((s) => s.members[server.id]);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me.id);
  const myRole = members?.[meId]?.role;
  const [q, setQ] = useState('');
  const list = Object.values(members || {})
    .map((m) => ({ m, u: users[m.userId] }))
    .filter((x) => x.u && `${x.u.displayName} ${x.u.username} ${x.m.nickname || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => ({ owner: 0, admin: 1, member: 2 }[a.m.role] - { owner: 0, admin: 1, member: 2 }[b.m.role]) || displayName(a.u, a.m).localeCompare(displayName(b.u, b.m)));

  return (
    <>
      <div className="settings-title-row">
        <h1>Members</h1>
        <span className="muted">{Object.keys(members || {}).length}</span>
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" />
      <div className="list-card">
        {list.map(({ m, u }) => (
          <div key={u.id} className="list-row">
            <Avatar user={u} size={32} status={u.presence} />
            <div className="list-row-stack">
              <span className="list-row-name">{displayName(u, m)}</span>
              <span className="list-row-sub">@{u.username} - joined {fullDate(m.joinedAt)}</span>
            </div>
            <span className={`role-tag ${m.role}`}>{m.role === 'owner' ? <Icon.Crown size={12} /> : m.role === 'admin' ? <Icon.Shield size={12} /> : null}{m.role}</span>
            <div className="list-row-actions">
              {myRole === 'owner' && u.id !== meId && (
                <>
                  <button className="round-btn" onClick={() => setMemberRole(server.id, u.id, m.role === 'admin' ? 'member' : 'admin')} data-tip={m.role === 'admin' ? 'Remove admin' : 'Make admin'}>
                    <Icon.Shield size={16} />
                  </button>
                  <button className="round-btn" data-tip="Transfer ownership" onClick={() => openModal('confirm', {
                    title: 'Transfer ownership',
                    body: `Make ${displayName(u, m)} the owner of ${server.name}? You will become an admin.`,
                    confirm: 'Transfer',
                    danger: true,
                    onConfirm: () => transferServer(server.id, u.id),
                  })}><Icon.Crown size={16} /></button>
                </>
              )}
              {u.id !== meId && m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member')) && (
                <button className="round-btn no" data-tip="Kick" onClick={() => openModal('confirm', {
                  title: `Kick ${displayName(u, m)}`,
                  body: 'They can rejoin with a new invite.',
                  confirm: 'Kick',
                  danger: true,
                  onConfirm: () => kickMember(server.id, u.id),
                })}><Icon.Logout size={16} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function InvitesTab({ server }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h1>Invites</h1>
      <Field label="Invite code">
        <div className={`copy-box${copied ? ' copied' : ''}`}>
          <span className="mono">{server.inviteCode}</span>
          <Button onClick={async () => { await copyText(server.inviteCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </Field>
      <Button variant="soft" onClick={() => resetInvite(server.id)}><Icon.Refresh size={15} /> Generate new code</Button>
    </>
  );
}

export default function ServerSettingsModal({ serverId, tab: initialTab = 'overview' }) {
  const server = useStore((s) => s.servers[serverId]);
  const isOwner = useStore((s) => s.servers[serverId]?.ownerId === s.me.id);
  const [tab, setTab] = useState(initialTab);
  if (!server) return null;
  const nav = [
    { heading: server.name },
    { id: 'overview', label: 'Overview', icon: Icon.Settings },
    { id: 'channels', label: 'Channels', icon: Icon.Hash },
    { id: 'members', label: 'Members', icon: Icon.Users },
    { id: 'invites', label: 'Invites', icon: Icon.Link },
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
      {tab === 'channels' && <ChannelsTab server={server} />}
      {tab === 'members' && <MembersTab server={server} />}
      {tab === 'invites' && <InvitesTab server={server} />}
    </SettingsLayer>
  );
}
