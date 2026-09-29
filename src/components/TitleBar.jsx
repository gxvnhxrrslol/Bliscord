import { useEffect, useState } from 'react';
import { native } from '../lib/api';
import { setState, useStore } from '../lib/store';
import Icon from './Icons';

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const update = useStore((s) => s.update);

  useEffect(() => {
    if (!native) return undefined;
    const offMax = native.window.onMaximizedChange(setMaximized);
    const offUpdate = native.updates.onStatus((u) => setState({ update: u }));
    return () => { offMax?.(); offUpdate?.(); };
  }, []);

  if (!native) return null;

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-mark"><Icon.Logo size={12} /></span>
        <span className="titlebar-name">Bliscord</span>
      </div>
      <div className="titlebar-drag" />
      <div className="titlebar-actions">
        {update?.status === 'downloading' && (
          <div className="update-progress" data-tip={`Downloading update ${Math.round(update.percent || 0)}%`} data-tip-side="bottom">
            <span style={{ width: `${update.percent || 0}%` }} />
          </div>
        )}
        {update?.status === 'ready' && (
          <button className="update-btn" onClick={() => native.updates.install()} data-tip={`Restart to update to ${update.version}`} data-tip-side="bottom">
            <Icon.Download size={15} />
            <span>Update</span>
          </button>
        )}
        <button className="win-btn" onClick={() => native.window.minimize()} aria-label="Minimize">
          <Icon.WinMin size={16} />
        </button>
        <button className="win-btn" onClick={() => native.window.toggleMaximize()} aria-label="Maximize">
          {maximized ? <Icon.WinRestore size={16} /> : <Icon.WinMax size={16} />}
        </button>
        <button className="win-btn close" onClick={() => native.window.close()} aria-label="Close">
          <Icon.WinClose size={16} />
        </button>
      </div>
    </header>
  );
}
