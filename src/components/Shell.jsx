import { useEffect } from 'react';
import { useStore } from '../lib/store';
import { openModal } from '../lib/actions';
import { voice } from '../lib/voice';
import { checkWhatsNew } from '../lib/whatsnew';
import ServerDock from './ServerDock';
import { HomeSidebar, ServerSidebar, UserPanel, VoicePanel } from './Sidebars';
import { ChannelView, DmView } from './ChatView';
import { VoiceChannelView } from './VoiceStage';
import FriendsView from './FriendsView';
import { DmProfile, MemberList } from './MemberList';
import { ContextMenu, IncomingCall, ModalHost, ProfilePopout } from './Overlays';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openModal('quickSwitcher');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        voice.setMuted(!(voice.muted || voice.deafened));
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        voice.setDeafened(!voice.deafened);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        openModal('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function Shell() {
  useShortcuts();
  useEffect(() => { const t = setTimeout(checkWhatsNew, 900); return () => clearTimeout(t); }, []);
  const view = useStore((s) => s.view);
  const channelType = useStore((s) => (s.view.kind === 'server' ? s.channels[s.view.channelId]?.type : null));
  const showMembers = useStore((s) => s.showMembers);
  const connection = useStore((s) => s.connection);

  let content = null;
  let aside = null;
  if (view.kind === 'home') {
    if (view.home === 'friends') content = <FriendsView />;
    else {
      content = <DmView key={view.home} dmId={view.home} />;
      if (showMembers) aside = <DmProfile dmId={view.home} />;
    }
  } else if (view.channelId && channelType === 'voice') {
    content = <VoiceChannelView key={view.channelId} channelId={view.channelId} />;
  } else if (view.channelId && channelType === 'text') {
    content = <ChannelView key={view.channelId} channelId={view.channelId} />;
    if (showMembers) aside = <MemberList serverId={view.serverId} />;
  }

  return (
    <div className={`shell${aside ? ' with-aside' : ''}`}>
      {connection !== 'connected' && (
        <div className="conn-banner">
          <span className="spinner" style={{ width: 12, height: 12 }} />
          Reconnecting
        </div>
      )}
      <ServerDock />
      <aside className="sidebar panel glass">
        {view.kind === 'home' ? <HomeSidebar /> : <ServerSidebar key={view.serverId} serverId={view.serverId} />}
        <VoicePanel />
        <UserPanel />
      </aside>
      <main className="main panel glass">
        <div className="view-anim" key={view.kind === 'home' ? `h-${view.home}` : `s-${view.channelId}`}>
          {content}
        </div>
      </main>
      {aside}
      <ModalHost />
      <ProfilePopout />
      <ContextMenu />
      <IncomingCall />
    </div>
  );
}
