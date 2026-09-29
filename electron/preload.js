const { contextBridge, ipcRenderer } = require('electron');

const boot = ipcRenderer.sendSync('config:get');

function listen(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

let closeToTray = true;
try {
  const saved = JSON.parse(localStorage.getItem('bliscord.settings') || '{}');
  if (saved.closeToTray === false) closeToTray = false;
} catch { /* ignore */ }
ipcRenderer.send('app:close-to-tray', closeToTray);

contextBridge.exposeInMainWorld('bliscord', {
  isElectron: true,
  platform: boot.platform,
  version: boot.version,
  config: boot.config,
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    onMaximizedChange: (cb) => listen('win:maximized', cb),
  },
  focus: () => ipcRenderer.send('win:focus'),
  flash: () => ipcRenderer.send('win:flash'),
  setBadge: (dataUrl, count) => ipcRenderer.send('badge:set', dataUrl, count),
  setCloseToTray: (value) => ipcRenderer.send('app:close-to-tray', value),
  onIdle: (cb) => listen('idle', cb),
  screen: {
    getSources: () => ipcRenderer.invoke('screen:sources'),
    select: (choice) => ipcRenderer.invoke('screen:select', choice),
  },
  updates: {
    check: () => ipcRenderer.send('update:check'),
    install: () => ipcRenderer.send('update:install'),
    onStatus: (cb) => listen('update:status', cb),
  },
});
