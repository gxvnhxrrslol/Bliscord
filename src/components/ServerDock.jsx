import { useLayoutEffect, useRef, useState } from 'react';
import { getState, useStore } from '../lib/store';
import { openDm, openHome, openMenu, openModal, reorderServers, selectServer, leaveServer, markRead } from '../lib/actions';
import { displayName } from '../lib/format';
import { Avatar, ServerGlyph, copyText } from './ui';
import Icon from './Icons';
import { openDiscover } from './Discover';

function serverUnread(s, serverId) {
  let unread = false;
  let mentions = 0;
  for (const c of Object.values(s.channels)) {
    if (c.serverId !== serverId || c.type !== 'text') continue;
    if (c.lastMessageId && c.lastMessageId > (s.readStates[c.id] || '')) unread = true;
    mentions += s.mentions[c.id] || 0;
  }
  return { unread, mentions };
}

function ServerItem({ id, active, registerRef, onDragStart, onDragOver, onDrop, dropHint }) {
  const server = useStore((s) => s.servers[id]);
  const { unread, mentions } = useStore((s) => serverUnread(s, id));
  const inVoice = useStore((s) => Object.entries(s.voice).some(([roomId, st]) => s.channels[roomId]?.serverId === id && st.some((p) => p.userId === s.me.id)));
  const isOwner = useStore((s) => s.servers[id]?.ownerId === s.me.id);
  if (!server) return null;

  const menu = (e) => openMenu(e, [
    { label: 'Mark as read', icon: Icon.Check, onClick: () => {
      const s = getState();
      for (const c of Object.values(s.channels)) if (c.serverId === id && c.lastMessageId) markRead(c.id, c.lastMessageId);
    } },
    { label: 'Invite people', icon: Icon.UserPlus, onClick: () => openModal('invite', { serverId: id }) },
    { label: 'Copy invite code', icon: Icon.Copy, onClick: () => copyText(server.inviteCode) },
    ...(!isOwner ? [{ separator: true }, { label: 'Leave server', icon: Icon.Logout, danger: true, onClick: () => openModal('confirm', {
      title: `Leave ${server.name}`,
      body: 'You will need a new invite to join again.',
      confirm: 'Leave server',
      danger: true,
      onConfirm: () => leaveServer(id),
    }) }] : []),
  ]);

  return (
    <div
      className={`dock-slot${dropHint ? ` drop-${dropHint}` : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, id)}
      onDragOver={(e) => onDragOver(e, id)}
      onDrop={(e) => onDrop(e, id)}
    >
      <span className={`dock-pill${active ? ' active' : unread ? ' unread' : ''}`} />
      <button
        ref={(el) => registerRef(id, el)}
        className={`dock-item${active ? ' active' : ''}`}
        onClick={() => selectServer(id)}
        onContextMenu={menu}
        data-tip={server.name}
        data-tip-side="right"
      >
        <ServerGlyph server={server} size={46} />
        {mentions > 0 && <span className="badge dock-badge">{mentions > 99 ? '99+' : mentions}</span>}
        {inVoice && <span className="dock-voice"><Icon.Speaker size={11} strokeWidth={2.4} /></span>}
      </button>
    </div>
  );
}

function UnreadDm({ dmId, registerRef }) {
  const dm = useStore((s) => s.dms[dmId]);
  const user = useStore((s) => s.users[s.dms[dmId]?.recipientId]);
  const count = useStore((s) => s.unreadDm[dmId] || 0);
  if (!dm || !user) return null;
  return (
    <div className="dock-slot dock-enter">
      <button ref={(el) => registerRef(dmId, el)} className="dock-item" onClick={() => openDm(user.id)} data-tip={displayName(user)} data-tip-side="right">
        <Avatar user={user} size={46} />
        <span className="badge dock-badge">{count > 99 ? '99+' : count}</span>
      </button>
    </div>
  );
}

export default function ServerDock() {
  const order = useStore((s) => s.serverOrder);
  const view = useStore((s) => s.view);
  const unreadDms = useStore((s) => Object.keys(s.unreadDm).filter((id) => s.unreadDm[id] > 0 && s.dms[id]).slice(0, 6));
  const pending = useStore((s) => Object.values(s.relationships).filter((t) => t === 'incoming').length);
  const refs = useRef({});
  const lens = useRef(null);
  const [drag, setDrag] = useState(null);
  const [hint, setHint] = useState(null);

  const activeKey = view.kind === 'home' ? 'home' : view.serverId;

  useLayoutEffect(() => {
    const el = refs.current[activeKey];
    const l = lens.current;
    if (!l) return;
    if (!el) { l.style.opacity = '0'; return; }
    const top = el.parentElement.offsetTop + el.offsetTop;
    l.style.opacity = '1';
    l.style.transform = `translateY(${top}px)`;
  });

  const registerRef = (key, el) => { if (el) refs.current[key] = el; else delete refs.current[key]; };

  const onDragStart = (e, id) => {
    setDrag(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e, id) => {
    if (!drag || drag === id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setHint({ id, pos: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
  };
  const onDrop = (e, id) => {
    e.preventDefault();
    if (!drag || !hint) return;
    const next = order.filter((x) => x !== drag);
    let idx = next.indexOf(id);
    if (hint.pos === 'after') idx += 1;
    next.splice(idx, 0, drag);
    reorderServers(next);
    setDrag(null);
    setHint(null);
  };

  return (
    <nav className="dock panel glass-strong" onDragEnd={() => { setDrag(null); setHint(null); }}>
      <div className="dock-scroll">
        <div className="dock-inner">
          <div ref={lens} className="dock-lens" />
          <div className="dock-slot">
            <span className={`dock-pill${activeKey === 'home' ? ' active' : ''}`} />
            <button
              ref={(el) => registerRef('home', el)}
              className={`dock-item dock-home${activeKey === 'home' ? ' active' : ''}`}
              onClick={() => openHome(view.kind === 'home' ? view.home : 'friends')}
              data-tip="Home"
              data-tip-side="right"
            >
              <span className="dock-home-mark"><Icon.Logo size={24} /></span>
              {pending > 0 && <span className="badge dock-badge">{pending}</span>}
            </button>
          </div>
          {unreadDms.map((id) => <UnreadDm key={id} dmId={id} registerRef={registerRef} />)}
          <div className="dock-sep" />
          {order.map((id) => (
            <ServerItem
              key={id}
              id={id}
              active={activeKey === id}
              registerRef={registerRef}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              dropHint={hint?.id === id ? hint.pos : null}
            />
          ))}
          <div className="dock-slot">
            <button className="dock-item dock-action" onClick={() => openModal('createServer')} data-tip="Create a server" data-tip-side="right">
              <Icon.Plus size={22} />
            </button>
          </div>
          <div className="dock-slot">
            <button className={`dock-item dock-action${view.kind === 'discover' ? ' active' : ''}`} onClick={() => openDiscover()} data-tip="Discover" data-tip-side="right">
              <Icon.Compass size={22} />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
