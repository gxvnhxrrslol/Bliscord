import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  joinVoice, leaveVoice, openHome, openMenu, openModal, openPopout, selectChannel, serverChannels, setStatus, leaveServer,
  deleteChannel, markRead,
} from '../lib/actions';
import { useVoice, voice } from '../lib/voice';
import { toggleCamera, toggleScreen } from '../lib/media';
import { displayName } from '../lib/format';
import { assetUrl } from '../lib/api';
import { Avatar, StatusDot, copyText } from './ui';
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

function VoiceMember({ state, speaking, serverId }) {
  const user = useStore((s) => s.users[state.userId]);
  const member = useStore((s) => s.members[serverId]?.[state.userId]);
  if (!user) return null;
  return (
    <div
      className={`voice-member${speaking ? ' speaking' : ''}`}
      onClick={(e) => openPopout(user.id, e.currentTarget.getBoundingClientRect(), serverId)}
    >
      <Avatar user={user} size={22} speaking={speaking} />
      <span className="voice-member-name">{displayName(user, member)}</span>
      <span className="voice-member-flags">
        {state.screen && <span className="live-badge">LIVE</span>}
        {state.video && <Icon.Video size={14} />}
        {state.deafened ? <Icon.HeadphonesOff size={14} className="flag-off" /> : state.muted && <Icon.MicOff size={14} className="flag-off" />}
      </span>
    </div>
  );
}

function ChannelRow({ channel, active, canManage }) {
  const unread = useStore((s) => channel.type === 'text' && channel.lastMessageId && channel.lastMessageId > (s.readStates[channel.id] || ''));
  const mentions = useStore((s) => s.mentions[channel.id] || 0);
  const participants = useStore((s) => s.voice[channel.id]);
  const v = useVoice();
  const isVoice = channel.type === 'voice';

  const open = () => {
    selectChannel(channel.serverId, channel.id);
    if (isVoice && v.roomId !== channel.id) joinVoice(channel.id);
  };

  const menu = (e) => openMenu(e, [
    ...(channel.type === 'text' ? [{ label: 'Mark as read', icon: Icon.Check, onClick: () => markRead(channel.id, channel.lastMessageId) }] : []),
    ...(isVoice && v.roomId !== channel.id ? [{ label: 'Join voice', icon: Icon.Speaker, onClick: open }] : []),
    { label: 'Copy channel ID', icon: Icon.Copy, onClick: () => copyText(channel.id) },
    ...(canManage ? [
      { separator: true },
      { label: 'Edit channel', icon: Icon.Settings, onClick: () => openModal('channelSettings', { channelId: channel.id }) },
      { label: 'Delete channel', icon: Icon.Trash, danger: true, onClick: () => openModal('confirm', {
        title: `Delete ${isVoice ? '' : '#'}${channel.name}`,
        body: 'This cannot be undone.',
        confirm: 'Delete channel',
        danger: true,
        onConfirm: () => deleteChannel(channel.id),
      }) },
    ] : []),
  ]);

  return (
    <>
      <div className={`channel-row${active ? ' active' : ''}${unread ? ' unread' : ''}`} onClick={open} onContextMenu={menu}>
        {unread && !active && <span className="channel-pill" />}
        <span className="channel-icon">{isVoice ? <Icon.Speaker size={18} /> : <Icon.Hash size={18} />}</span>
        <span className="channel-name">{channel.name}</span>
        {mentions > 0 && <span className="badge">{mentions}</span>}
        {canManage && (
          <button className="channel-gear" onClick={(e) => { e.stopPropagation(); openModal('channelSettings', { channelId: channel.id }); }} data-tip="Edit channel">
            <Icon.Settings size={14} />
          </button>
        )}
      </div>
      {isVoice && participants?.length > 0 && (
        <div className="voice-members">
          {participants.map((p) => (
            <VoiceMember key={p.userId} state={p} serverId={channel.serverId} speaking={v.roomId === channel.id && v.speaking.has(p.userId)} />
          ))}
        </div>
      )}
    </>
  );
}

function ChannelGroup({ title, channels, activeId, canManage, onAdd }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="channel-group">
      <div className="section-head clickable" onClick={() => setOpen((o) => !o)}>
        <span className={`caret${open ? '' : ' closed'}`}><Icon.ChevronDown size={12} strokeWidth={2.4} /></span>
        <span>{title}</span>
        {canManage && (
          <button className="section-add" onClick={(e) => { e.stopPropagation(); onAdd(); }} data-tip="Create channel">
            <Icon.Plus size={15} />
          </button>
        )}
      </div>
      {channels.filter((c) => open || c.id === activeId).map((c) => (
        <ChannelRow key={c.id} channel={c} active={c.id === activeId} canManage={canManage} />
      ))}
    </div>
  );
}

export function ServerSidebar({ serverId }) {
  const server = useStore((s) => s.servers[serverId]);
  const channelsMap = useStore((s) => s.channels);
  const activeId = useStore((s) => s.view.channelId);
  const role = useStore((s) => s.members[serverId]?.[s.me.id]?.role);
  const canManage = role === 'owner' || role === 'admin';
  const channels = useMemo(() => serverChannels({ channels: channelsMap }, serverId), [channelsMap, serverId]);

  if (!server) return null;
  const banner = assetUrl(server.banner);

  const headerMenu = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left + 8, clientY: rect.bottom + 6 }, [
      { label: 'Invite people', icon: Icon.UserPlus, accent: true, onClick: () => openModal('invite', { serverId }) },
      ...(canManage ? [
        { label: 'Server settings', icon: Icon.Settings, onClick: () => openModal('serverSettings', { serverId }) },
        { label: 'Create channel', icon: Icon.PlusCircle, onClick: () => openModal('createChannel', { serverId }) },
      ] : []),
      { label: 'Change nickname', icon: Icon.Edit, onClick: () => openModal('nickname', { serverId }) },
      ...(role !== 'owner' ? [{ separator: true }, { label: 'Leave server', icon: Icon.Logout, danger: true, onClick: () => openModal('confirm', {
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
        <ChannelGroup
          title="Text Channels"
          channels={channels.filter((c) => c.type === 'text')}
          activeId={activeId}
          canManage={canManage}
          onAdd={() => openModal('createChannel', { serverId, type: 'text' })}
        />
        <ChannelGroup
          title="Voice Channels"
          channels={channels.filter((c) => c.type === 'voice')}
          activeId={activeId}
          canManage={canManage}
          onAdd={() => openModal('createChannel', { serverId, type: 'voice' })}
        />
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
        <button className={`vp-btn${v.cameraStream ? ' on' : ''}`} onClick={toggleCamera} data-tip={v.cameraStream ? 'Turn off camera' : 'Turn on camera'}>
          {v.cameraStream ? <Icon.Video size={18} /> : <Icon.VideoOff size={18} />}
        </button>
        <button className={`vp-btn${v.screenStream ? ' on' : ''}`} onClick={toggleScreen} data-tip={v.screenStream ? 'Stop sharing' : 'Share your screen'}>
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
          className={`up-btn${v.muted || v.deafened ? ' off' : ''}`}
          onClick={() => voice.setMuted(!(v.muted || v.deafened))}
          data-tip={v.muted || v.deafened ? 'Unmute' : 'Mute'}
        >
          {v.muted || v.deafened ? <Icon.MicOff size={18} /> : <Icon.Mic size={18} />}
        </button>
        <button className={`up-btn${v.deafened ? ' off' : ''}`} onClick={() => voice.setDeafened(!v.deafened)} data-tip={v.deafened ? 'Undeafen' : 'Deafen'}>
          {v.deafened ? <Icon.HeadphonesOff size={18} /> : <Icon.Headphones size={18} />}
        </button>
        <button className="up-btn gear" onClick={() => openModal('settings')} data-tip="Settings">
          <Icon.Settings size={18} />
        </button>
      </div>
    </div>
  );
}
