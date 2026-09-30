import { useMemo, useState } from 'react';
import { getState, updateSettings, useStore } from '../lib/store';
import {
  channelTree, deleteChannel, joinVoice, leaveServer, leaveVoice, markRead, moderateVoice, openHome, openMenu, openModal,
  openPopout, selectChannel, setStatus,
} from '../lib/actions';
import { useVoice, voice } from '../lib/voice';
import { toggleCamera, toggleScreen } from '../lib/media';
import { displayName } from '../lib/format';
import { assetUrl } from '../lib/api';
import { has, P, permsFor, roleColor, usePerms } from '../lib/perms';
import { Avatar, Slider, StatusDot, copyText } from './ui';
import { ChannelIcon, isPrivateChannel } from './channelUi';
import { VerifiedMark } from './Badges';
import Icon from './Icons';

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

const HIDDEN_KEY = 'bliscord.hiddenDms';
function loadHidden() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}'); } catch { return {}; }
}

function DmRow({ dm, active, onHide }) {
  const user = useStore((s) => s.users[dm.recipientId]);
  const unread = useStore((s) => s.unreadDm[dm.id] || 0);
  const inCall = useStore((s) => (s.voice[dm.id] || []).length > 0);
  if (!user) return null;
  return (
    <div
      className={`nav-row dm-row${active ? ' active' : ''}${unread ? ' unread' : ''}`}
      onClick={() => openHome(dm.id)}
      onContextMenu={(e) => openMenu(e, [
        { label: 'Profile', icon: Icon.User, onClick: () => openPopout(user.id, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 }) },
        { label: 'Mark as read', icon: Icon.Check, onClick: () => markRead(dm.id, dm.lastMessageId) },
        { label: 'Close conversation', icon: Icon.X, onClick: onHide },
      ])}
    >
      <Avatar user={user} size={34} status={user.presence} />
      <div className="nav-row-text">
        <span className="nav-row-name">{displayName(user)}<VerifiedMark user={user} size={14} /></span>
        {user.customStatus && <span className="nav-row-sub">{user.customStatus}</span>}
      </div>
      {inCall && <Icon.Phone size={15} className="dm-call-icon" />}
      {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      <button className="row-close" onClick={(e) => { e.stopPropagation(); onHide(); }} aria-label="Close">
        <Icon.X size={14} />
      </button>
    </div>
  );
}

export function HomeSidebar() {
  const home = useStore((s) => s.view.home);
  const dms = useStore((s) => s.dms);
  const pending = useStore((s) => Object.values(s.relationships).filter((t) => t === 'incoming').length);
  const [hidden, setHidden] = useState(loadHidden);

  const list = useMemo(() => Object.values(dms)
    .filter((d) => d.id === home || (d.lastMessageAt && (!hidden[d.id] || (d.lastMessageId || '') > hidden[d.id])))
    .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt)), [dms, home, hidden]);

  const hide = (dm) => {
    const next = { ...hidden, [dm.id]: dm.lastMessageId || '0' };
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (home === dm.id) openHome('friends');
  };

  return (
    <div className="sidebar-content">
      <div className="sidebar-top">
        <button className="search-trigger" onClick={() => openModal('quickSwitcher')}>
          <Icon.Search size={15} />
          <span>Find a conversation</span>
          <kbd>Ctrl K</kbd>
        </button>
      </div>
      <div className="sidebar-scroll">
        <div className={`nav-row nav-main${home === 'friends' ? ' active' : ''}`} onClick={() => openHome('friends')}>
          <span className="nav-icon"><Icon.Users size={20} /></span>
          <span className="nav-row-name">Friends</span>
          {pending > 0 && <span className="badge">{pending}</span>}
        </div>
        <div className="section-head">
          <span>Direct Messages</span>
          <button className="section-add" onClick={() => openModal('newDm')} data-tip="New message">
            <Icon.Plus size={15} />
          </button>
        </div>
        <div className="dm-list">
          {list.map((dm) => <DmRow key={dm.id} dm={dm} active={home === dm.id} onHide={() => hide(dm)} />)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

function VoiceVolumeItem({ userId }) {
  const vol = useStore((s) => s.settings.userVolumes[userId] ?? 100);
  return (
    <div className="menu-custom">
      <span className="menu-custom-label">User volume</span>
      <Slider
        value={vol}
        onChange={(val) => { updateSettings({ userVolumes: { ...getState().settings.userVolumes, [userId]: val } }); voice.refreshVolumes(); }}
        format={(val) => `${val}%`}
      />
    </div>
  );
}

export function voiceMemberMenu(e, { state, serverId, channelId }) {
  const s = getState();
  const isMe = state.userId === s.me.id;
  const perms = serverId ? permsFor(s, serverId, channelId) : 0;
  const user = s.users[state.userId];
  const items = [
    { label: 'Profile', icon: Icon.User, onClick: () => openPopout(state.userId, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 }, serverId) },
  ];
  if (!isMe) items.push({ render: () => <VoiceVolumeItem userId={state.userId} /> });
  const mod = [];
  if (has(perms, P.MUTE_MEMBERS)) mod.push({ label: 'Server mute', icon: Icon.MicOff, checked: Boolean(state.serverMuted), onClick: () => moderateVoice(state.userId, { serverMuted: !state.serverMuted }) });
  if (has(perms, P.DEAFEN_MEMBERS)) mod.push({ label: 'Server deafen', icon: Icon.HeadphonesOff, checked: Boolean(state.serverDeafened), onClick: () => moderateVoice(state.userId, { serverDeafened: !state.serverDeafened }) });
  if (has(perms, P.MOVE_MEMBERS) && !isMe) mod.push({ label: `Disconnect ${displayName(user)}`, icon: Icon.PhoneOff, danger: true, onClick: () => moderateVoice(state.userId, { disconnect: true }) });
  if (mod.length) items.push({ separator: true }, ...mod);
  openMenu(e, items);
}

function VoiceFlags({ state }) {
  if (state.serverDeafened) return <Icon.HeadphonesOff size={14} className="flag-server" />;
  if (state.deafened) return <Icon.HeadphonesOff size={14} className="flag-off" />;
  if (state.serverMuted) return <Icon.MicOff size={14} className="flag-server" />;
  if (state.muted) return <Icon.MicOff size={14} className="flag-off" />;
  return null;
}

function VoiceMember({ state, speaking, serverId, channelId }) {
  const user = useStore((s) => s.users[state.userId]);
  const member = useStore((s) => s.members[serverId]?.[state.userId]);
  const color = useStore((s) => roleColor(s, serverId, state.userId));
  if (!user) return null;
  return (
    <div
      className={`voice-member${speaking ? ' speaking' : ''}`}
      onClick={(e) => openPopout(user.id, e.currentTarget.getBoundingClientRect(), serverId)}
      onContextMenu={(e) => voiceMemberMenu(e, { state, serverId, channelId })}
    >
      <Avatar user={user} size={22} speaking={speaking} />
      <span className="voice-member-name" style={{ color: color || undefined }}>{displayName(user, member)}</span>
      <span className="voice-member-flags">
        {state.screen && <span className="live-badge">LIVE</span>}
        {state.video && <Icon.Video size={14} />}
        <VoiceFlags state={state} />
      </span>
    </div>
  );
}

function ChannelRow({ channel, active, server }) {
  const isText = channel.type === 'text' || channel.type === 'announcement';
  const unread = useStore((s) => isText && channel.lastMessageId && channel.lastMessageId > (s.readStates[channel.id] || ''));
  const mentions = useStore((s) => s.mentions[channel.id] || 0);
  const participants = useStore((s) => s.voice[channel.id]);
  const perms = usePerms(channel.serverId, channel.id);
  const isPrivate = useStore((s) => isPrivateChannel(s, channel));
  const v = useVoice();
  const isVoice = channel.type === 'voice';
  const canEdit = has(perms, P.MANAGE_CHANNELS) || has(perms, P.MANAGE_ROLES);
  const full = isVoice && channel.userLimit > 0 && (participants?.length || 0) >= channel.userLimit;

  const open = () => {
    selectChannel(channel.serverId, channel.id);
    if (isVoice && v.roomId !== channel.id && has(perms, P.CONNECT)) joinVoice(channel.id);
  };

  const menu = (e) => openMenu(e, [
    ...(isText ? [{ label: 'Mark as read', icon: Icon.Check, onClick: () => markRead(channel.id, channel.lastMessageId) }] : []),
    ...(isVoice && v.roomId !== channel.id && has(perms, P.CONNECT) ? [{ label: 'Join voice', icon: Icon.Speaker, onClick: open }] : []),
    { label: 'Copy channel ID', icon: Icon.Copy, onClick: () => copyText(channel.id) },
    ...(canEdit ? [{ separator: true }, { label: 'Edit channel', icon: Icon.Settings, onClick: () => openModal('channelSettings', { channelId: channel.id }) }] : []),
    ...(has(perms, P.MANAGE_CHANNELS) ? [{ label: 'Delete channel', icon: Icon.Trash, danger: true, onClick: () => openModal('confirm', {
      title: `Delete ${isVoice ? '' : '#'}${channel.name}`,
      body: 'This cannot be undone.',
      confirm: 'Delete channel',
      danger: true,
      onConfirm: () => deleteChannel(channel.id),
    }) }] : []),
  ]);

  return (
    <>
      <div className={`channel-row${active ? ' active' : ''}${unread ? ' unread' : ''}`} onClick={open} onContextMenu={menu}>
        {unread && !active && <span className="channel-pill" />}
        <span className="channel-icon"><ChannelIcon channel={channel} server={server} isPrivate={isPrivate} /></span>
        <span className="channel-name">{channel.name}</span>
        {isVoice && channel.userLimit > 0 && (
          <span className={`user-limit${full ? ' full' : ''}`}>
            {String(participants?.length || 0).padStart(2, '0')}/{String(channel.userLimit).padStart(2, '0')}
          </span>
        )}
        {mentions > 0 && <span className="badge">{mentions}</span>}
        {canEdit && (
          <button className="channel-gear" onClick={(e) => { e.stopPropagation(); openModal('channelSettings', { channelId: channel.id }); }} data-tip="Edit channel">
            <Icon.Settings size={14} />
          </button>
        )}
      </div>
      {isVoice && participants?.length > 0 && (
        <div className="voice-members">
          {participants.map((p) => (
            <VoiceMember key={p.userId} state={p} serverId={channel.serverId} channelId={channel.id} speaking={v.roomId === channel.id && v.speaking.has(p.userId)} />
          ))}
        </div>
      )}
    </>
  );
}

const COLLAPSED_KEY = 'bliscord.collapsedCategories';
function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'); } catch { return {}; }
}

function CategoryGroup({ category, channels, activeId, server, collapsed, onToggle }) {
  const perms = usePerms(category.serverId, category.id);
  const canCreate = has(perms, P.MANAGE_CHANNELS);
  const menu = (e) => openMenu(e, [
    { label: collapsed ? 'Expand category' : 'Collapse category', icon: Icon.ChevronDown, onClick: onToggle },
    ...(canCreate ? [
      { separator: true },
      { label: 'Create channel', icon: Icon.PlusCircle, onClick: () => openModal('createChannel', { serverId: category.serverId, parentId: category.id }) },
      { label: 'Edit category', icon: Icon.Settings, onClick: () => openModal('channelSettings', { channelId: category.id }) },
      { label: 'Delete category', icon: Icon.Trash, danger: true, onClick: () => openModal('confirm', {
        title: `Delete ${category.name}`,
        body: 'The channels inside it will be kept.',
        confirm: 'Delete category',
        danger: true,
        onConfirm: () => deleteChannel(category.id),
      }) },
    ] : []),
  ]);
  return (
    <div className="channel-group">
      <div className="section-head clickable" onClick={onToggle} onContextMenu={menu}>
        <span className={`caret${collapsed ? ' closed' : ''}`}><Icon.ChevronDown size={12} strokeWidth={2.4} /></span>
        <span>{category.name}</span>
        {canCreate && (
          <button
            className="section-add"
            onClick={(e) => { e.stopPropagation(); openModal('createChannel', { serverId: category.serverId, parentId: category.id }); }}
            data-tip="Create channel"
          >
            <Icon.Plus size={15} />
          </button>
        )}
      </div>
      {channels.filter((c) => !collapsed || c.id === activeId).map((c) => (
        <ChannelRow key={c.id} channel={c} active={c.id === activeId} server={server} />
      ))}
    </div>
  );
}

export function ServerSidebar({ serverId }) {
  const server = useStore((s) => s.servers[serverId]);
  const channelsMap = useStore((s) => s.channels);
  const activeId = useStore((s) => s.view.channelId);
  const isOwner = useStore((s) => s.servers[serverId]?.ownerId === s.me.id);
  const perms = usePerms(serverId);
  const tree = useMemo(() => channelTree({ channels: channelsMap }, serverId), [channelsMap, serverId]);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  if (!server) return null;
  const banner = assetUrl(server.banner);
  const canSettings = [P.MANAGE_SERVER, P.MANAGE_ROLES, P.MANAGE_CHANNELS, P.KICK_MEMBERS, P.BAN_MEMBERS].some((f) => has(perms, f));

  const toggle = (id) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const headerMenu = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left + 8, clientY: rect.bottom + 6 }, [
      ...(has(perms, P.CREATE_INVITE) ? [{ label: 'Invite people', icon: Icon.UserPlus, accent: true, onClick: () => openModal('invite', { serverId }) }] : []),
      ...(canSettings ? [{ label: 'Server settings', icon: Icon.Settings, onClick: () => openModal('serverSettings', { serverId }) }] : []),
      ...(has(perms, P.MANAGE_CHANNELS) ? [
        { label: 'Create channel', icon: Icon.PlusCircle, onClick: () => openModal('createChannel', { serverId }) },
        { label: 'Create category', icon: Icon.FolderPlus, onClick: () => openModal('createChannel', { serverId, type: 'category' }) },
      ] : []),
      ...(has(perms, P.CHANGE_NICKNAME) ? [{ label: 'Change nickname', icon: Icon.Edit, onClick: () => openModal('nickname', { serverId }) }] : []),
      ...(!isOwner ? [{ separator: true }, { label: 'Leave server', icon: Icon.Logout, danger: true, onClick: () => openModal('confirm', {
        title: `Leave ${server.name}`,
        body: 'You will need a new invite to join again.',
        confirm: 'Leave server',
        danger: true,
        onConfirm: () => leaveServer(serverId),
      }) }] : []),
    ]);
  };

  return (
    <div className="sidebar-content">
      <button className={`server-header${banner ? ' has-banner' : ''}`} onClick={headerMenu}>
        {banner && <img className="server-banner" src={banner} alt="" draggable={false} />}
        <span className="server-header-row">
          <span className="server-name">{server.name}</span>
          <Icon.ChevronDown size={16} />
        </span>
      </button>
      <div className="sidebar-scroll">
        {tree.loose.length > 0 && (
          <div className="channel-group loose">
            {tree.loose.map((c) => <ChannelRow key={c.id} channel={c} active={c.id === activeId} server={server} />)}
          </div>
        )}
        {tree.categories.map(({ category, channels }) => (
          <CategoryGroup
            key={category.id}
            category={category}
            channels={channels}
            activeId={activeId}
            server={server}
            collapsed={Boolean(collapsed[category.id])}
            onToggle={() => toggle(category.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voice connection card                                               */
/* ------------------------------------------------------------------ */

export function VoicePanel() {
  const v = useVoice();
  const ping = useStore((s) => s.ping);
  const room = useStore((s) => {
    if (!v.roomId) return null;
    const ch = s.channels[v.roomId];
    if (ch) return { title: ch.name, sub: s.servers[ch.serverId]?.name, serverId: ch.serverId, channelId: ch.id };
    const dm = s.dms[v.roomId];
    if (dm) return { title: displayName(s.users[dm.recipientId]), sub: 'Direct call', dmId: dm.id };
    return null;
  });
  const canVideo = useStore((s) => {
    const ch = v.roomId && s.channels[v.roomId];
    return !ch || has(permsFor(s, ch.serverId, ch.id), P.VIDEO);
  });
  if (!v.roomId || !room) return null;

  const quality = ping == null ? 'good' : ping < 120 ? 'good' : ping < 250 ? 'fair' : 'poor';
  const goTo = () => (room.dmId ? openHome(room.dmId) : selectChannel(room.serverId, room.channelId));

  return (
    <div className="voice-panel">
      <div className="voice-panel-top">
        <div className={`voice-status ${v.joining ? 'connecting' : quality}`} data-tip={ping != null ? `${ping} ms` : undefined}>
          <Icon.Signal size={16} strokeWidth={2.2} />
          <span>{v.joining ? 'Connecting' : 'Voice Connected'}</span>
        </div>
        <button className="voice-panel-where" onClick={goTo}>
          {room.title}
          <span> / {room.sub}</span>
        </button>
      </div>
      <div className="voice-panel-actions">
        <button className={`vp-btn${v.cameraStream ? ' on' : ''}`} onClick={toggleCamera} disabled={!canVideo} data-tip={v.cameraStream ? 'Turn off camera' : 'Turn on camera'}>
          {v.cameraStream ? <Icon.Video size={18} /> : <Icon.VideoOff size={18} />}
        </button>
        <button className={`vp-btn${v.screenStream ? ' on' : ''}`} onClick={toggleScreen} disabled={!canVideo} data-tip={v.screenStream ? 'Stop sharing' : 'Share your screen'}>
          <Icon.Screen size={18} />
        </button>
        <button className="vp-btn danger" onClick={leaveVoice} data-tip="Disconnect">
          <Icon.PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* User panel                                                          */
/* ------------------------------------------------------------------ */

const STATUS_LABELS = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };

export function UserPanel() {
  const me = useStore((s) => s.me);
  const v = useVoice();
  if (!me) return null;
  const muted = v.muted || v.deafened || v.serverMuted || v.serverDeafened;
  const deaf = v.deafened || v.serverDeafened;

  const statusMenu = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left, clientY: rect.top - 8, anchor: 'above' }, [
      ...['online', 'idle', 'dnd', 'invisible'].map((st) => ({
        label: STATUS_LABELS[st],
        icon: (p) => <StatusDot status={st === 'invisible' ? 'offline' : st} size={p.size - 6} />,
        checked: me.status === st,
        onClick: () => setStatus(st),
      })),
      { separator: true },
      { label: 'Edit profile', icon: Icon.Edit, onClick: () => openModal('settings', { tab: 'profile' }) },
      { label: 'Copy username', icon: Icon.Copy, onClick: () => copyText(me.username) },
    ]);
  };

  return (
    <div className="user-panel glass-strong">
      <button className="user-panel-id" onClick={statusMenu}>
        <Avatar user={me} size={34} status={me.status === 'invisible' ? 'offline' : me.presence === 'offline' ? me.status : me.presence} speaking={v.speaking.has(me.id)} />
        <span className="user-panel-text">
          <span className="user-panel-name">{me.displayName}</span>
          <span className="user-panel-sub">
            <span className="sub-a">{me.customStatus || STATUS_LABELS[me.status]}</span>
            <span className="sub-b">@{me.username}</span>
          </span>
        </span>
      </button>
      <div className="user-panel-actions">
        <button
          className={`up-btn${muted ? ' off' : ''}${v.serverMuted ? ' server' : ''}`}
          onClick={() => voice.setMuted(!(v.muted || v.deafened))}
          data-tip={v.serverMuted ? 'Server muted' : muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <Icon.MicOff size={18} /> : <Icon.Mic size={18} />}
        </button>
        <button
          className={`up-btn${deaf ? ' off' : ''}${v.serverDeafened ? ' server' : ''}`}
          onClick={() => voice.setDeafened(!v.deafened)}
          data-tip={v.serverDeafened ? 'Server deafened' : v.deafened ? 'Undeafen' : 'Deafen'}
        >
          {deaf ? <Icon.HeadphonesOff size={18} /> : <Icon.Headphones size={18} />}
        </button>
        <button className="up-btn gear" onClick={() => openModal('settings')} data-tip="Settings">
          <Icon.Settings size={18} />
        </button>
      </div>
    </div>
  );
}
