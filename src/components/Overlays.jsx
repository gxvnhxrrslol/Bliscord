import { useCallback, useLayoutEffect, useRef } from 'react';
import { useStore } from '../lib/store';
import { acceptCall, closeMenu, closePopout, declineCall, isViewing } from '../lib/actions';
import { displayName } from '../lib/format';
import { Avatar, useOutsideClick } from './ui';
import { ProfileCard } from './MemberList';
import { MODALS } from './Modals';
import Icon from './Icons';

export function ProfilePopout() {
  const popout = useStore((s) => s.popout);
  const ref = useRef(null);
  const close = useCallback(() => closePopout(), []);
  useOutsideClick(ref, close, Boolean(popout));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !popout) return undefined;
    const place = () => {
      const { rect } = popout;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = rect.right + 12;
      if (x + w > window.innerWidth - 12) x = rect.left - w - 12;
      if (x < 12) x = Math.min(window.innerWidth - w - 12, Math.max(12, rect.left));
      let y = rect.top;
      if (y + h > window.innerHeight - 12) y = window.innerHeight - h - 12;
      el.style.left = `${Math.max(12, x)}px`;
      el.style.top = `${Math.max(12, y)}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [popout]);

  if (!popout) return null;
  return (
    <div ref={ref} className="popout glass-strong" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <ProfileCard key={popout.userId} userId={popout.userId} serverId={popout.serverId} compact onAction={close} />
    </div>
  );
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const ref = useRef(null);
  const close = useCallback(() => closeMenu(), []);
  useOutsideClick(ref, close, Boolean(menu));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !menu) return undefined;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = menu.x;
    let y = menu.anchor === 'above' ? menu.y - h : menu.y;
    if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, menu.y - h);
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div ref={ref} className="menu glass-strong" onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) => {
        if (item.separator) return <div key={i} className="menu-sep" />;
        if (item.render) return <div key={i}>{item.render()}</div>;
        const I = item.icon;
        return (
          <button
            key={i}
            className={`menu-item${item.danger ? ' danger' : ''}${item.accent ? ' accent' : ''}${item.checked ? ' checked' : ''}`}
            onClick={() => { close(); item.onClick?.(); }}
          >
            <span className="menu-label">{item.label}</span>
            {item.checked ? <Icon.Check size={16} /> : I && <I size={16} />}
          </button>
        );
      })}
    </div>
  );
}

export function IncomingCall() {
  const call = useStore((s) => s.incomingCall);
  const caller = useStore((s) => (s.incomingCall ? s.users[s.incomingCall.callerId] : null));
  const viewing = useStore(() => (call ? isViewing(call.roomId) : false));
  if (!call || !caller || viewing) return null;
  return (
    <div className="incoming-call glass-strong">
      <div className="incoming-avatar">
        <span className="pulse p1" />
        <span className="pulse p2" />
        <Avatar user={caller} size={76} />
      </div>
      <div className="incoming-name">{displayName(caller)}</div>
      <div className="incoming-label">Incoming call</div>
      <div className="incoming-actions">
        <button className="call-btn decline" onClick={declineCall} data-tip="Decline">
          <Icon.PhoneOff size={22} />
        </button>
        <button className="call-btn accept" onClick={acceptCall} data-tip="Accept">
          <Icon.Phone size={22} />
        </button>
      </div>
    </div>
  );
}

export function ModalHost() {
  const modals = useStore((s) => s.modals);
  return modals.map((m) => {
    const Component = MODALS[m.type];
    return Component ? <Component key={m.id} {...m.props} /> : null;
  });
}
