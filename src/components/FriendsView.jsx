import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  acceptFriend, blockUser, openDm, openMenu, openPopout, removeFriend, sendFriendRequest, startCall, unblockUser,
} from '../lib/actions';
import { displayName } from '../lib/format';
import { Avatar, Button, Empty } from './ui';
import { ChatHeader } from './ChatView';
import Icon from './Icons';

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' },
];

const PRESENCE_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };

function FriendRow({ user, type }) {
  const sub = type === 'incoming' ? 'Incoming friend request'
    : type === 'outgoing' ? 'Outgoing friend request'
      : type === 'blocked' ? 'Blocked'
        : user.customStatus || PRESENCE_LABEL[user.presence];

  const more = (e) => openMenu(e, [
    { label: 'Start voice call', icon: Icon.Phone, onClick: async () => { const dm = await openDm(user.id); startCall(dm.id); } },
    { label: 'Start video call', icon: Icon.Video, onClick: async () => { const dm = await openDm(user.id); startCall(dm.id, { video: true }); } },
    { separator: true },
    { label: 'Remove friend', icon: Icon.UserX, danger: true, onClick: () => removeFriend(user.id) },
    { label: 'Block', icon: Icon.Block, danger: true, onClick: () => blockUser(user.id) },
  ]);

  return (
    <div
      className="friend-row"
      onClick={() => type === 'friend' && openDm(user.id)}
      onContextMenu={type === 'friend' ? more : undefined}
    >
      <Avatar user={user} size={36} status={type === 'blocked' ? undefined : user.presence} />
      <div className="friend-text" onClick={(e) => { e.stopPropagation(); openPopout(user.id, e.currentTarget.getBoundingClientRect()); }}>
        <span className="friend-name">{displayName(user)} <span className="friend-username">@{user.username}</span></span>
        <span className="friend-sub">{sub}</span>
      </div>
      <div className="friend-actions" onClick={(e) => e.stopPropagation()}>
        {type === 'friend' && (
          <>
            <button className="round-btn" onClick={() => openDm(user.id)} data-tip="Message"><Icon.Message size={18} /></button>
            <button className="round-btn" onClick={more} data-tip="More"><Icon.MoreV size={18} /></button>
          </>
        )}
        {type === 'incoming' && (
          <>
            <button className="round-btn ok" onClick={() => acceptFriend(user.id)} data-tip="Accept"><Icon.Check size={18} /></button>
            <button className="round-btn no" onClick={() => removeFriend(user.id)} data-tip="Ignore"><Icon.X size={18} /></button>
          </>
        )}
        {type === 'outgoing' && (
          <button className="round-btn no" onClick={() => removeFriend(user.id)} data-tip="Cancel"><Icon.X size={18} /></button>
        )}
        {type === 'blocked' && (
          <button className="round-btn no" onClick={() => unblockUser(user.id)} data-tip="Unblock"><Icon.UserX size={18} /></button>
        )}
      </div>
    </div>
  );
}

function AddFriend() {
  const [value, setValue] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      const r = await sendFriendRequest(value.trim());
      setResult({ ok: true, text: r.type === 'friend' ? `You are now friends with ${value.trim()}` : `Friend request sent to ${value.trim()}` });
      setValue('');
    } catch (err) {
      setResult({ ok: false, text: err.message });
    }
    setBusy(false);
  };

  return (
    <div className="add-friend">
      <h3>Add Friend</h3>
      <form className={`add-friend-box${result ? (result.ok ? ' ok' : ' bad') : ''}`} onSubmit={submit}>
        <Icon.At size={18} />
        <input
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setResult(null); }}
          placeholder="username"
          spellCheck={false}
        />
        <Button type="submit" loading={busy} disabled={!value.trim()}>Send Request</Button>
      </form>
      {result && <div className={`add-friend-result${result.ok ? ' ok' : ' bad'}`}>{result.text}</div>}
    </div>
  );
}

export default function FriendsView() {
  const [tab, setTab] = useState('online');
  const [search, setSearch] = useState('');
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const pending = Object.values(relationships).filter((t) => t === 'incoming').length;

  const rows = useMemo(() => {
    const list = Object.entries(relationships)
      .map(([id, type]) => ({ user: users[id], type }))
      .filter((r) => r.user)
      .filter((r) => {
        if (tab === 'online') return r.type === 'friend' && r.user.presence !== 'offline';
        if (tab === 'all') return r.type === 'friend';
        if (tab === 'pending') return r.type === 'incoming' || r.type === 'outgoing';
        return r.type === 'blocked';
      })
      .filter((r) => !search || `${r.user.displayName} ${r.user.username}`.toLowerCase().includes(search.toLowerCase()));
    return list.sort((a, b) => (a.type === 'incoming' ? -1 : 0) - (b.type === 'incoming' ? -1 : 0)
      || displayName(a.user).localeCompare(displayName(b.user)));
  }, [relationships, users, tab, search]);

  const title = { online: 'Online', all: 'All friends', pending: 'Pending', blocked: 'Blocked' }[tab];

  return (
    <div className="chat friends">
      <ChatHeader icon={<Icon.Users size={22} className="header-icon" />} title="Friends">
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'pending' && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
          <button className={`tab tab-accent${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>Add Friend</button>
        </nav>
      </ChatHeader>
      {tab === 'add' ? (
        <AddFriend />
      ) : (
        <div className="friends-body">
          <div className="friends-search">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
            <Icon.Search size={16} />
          </div>
          <div className="friends-count">{title} - {rows.length}</div>
          <div className="friends-list">
            {rows.map((r) => <FriendRow key={r.user.id} user={r.user} type={r.type} />)}
            {!rows.length && (
              <Empty icon={tab === 'pending' ? Icon.Bell : tab === 'blocked' ? Icon.Block : Icon.Users}>
                <Button variant="soft" onClick={() => setTab('add')}>Add Friend</Button>
              </Empty>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
