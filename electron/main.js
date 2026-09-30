const {
  app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, powerMonitor, session, shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
// Unpackaged builds use their own profile so they can run next to the installed app.
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`);
const ICON = path.join(__dirname, 'icon.png');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

let win = null;
let tray = null;
let quitting = false;
let closeToTray = true;
let pendingSource = null;

app.setAppUserModelId('com.gxvn.bliscord');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function readConfig() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.config.json'),
    path.join(app.getAppPath(), 'app.config.json'),
    path.join(__dirname, '..', 'app.config.json'),
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* try next */ }
  }
  return {};
}
const config = readConfig();

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { width: 1320, height: 840 };
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch { /* ignore */ }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#080a10',
    icon: ICON,
    title: 'Bliscord',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  win.on('resize', debounce(saveWindowState, 400));
  win.on('move', debounce(saveWindowState, 400));
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => {
    saveWindowState();
    if (!quitting && closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  // Open external links in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const current = win.webContents.getURL();
    if (url !== current && !url.startsWith('file://') && !(isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL))) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items = [];
    for (const s of params.dictionarySuggestions.slice(0, 4)) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    }
    if (items.length) items.push({ type: 'separator' });
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else items.push({ role: 'copy' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Bliscord');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Bliscord', click: showWindow },
    { label: 'Check for updates', click: () => checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit Bliscord', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

/* ------------------------------------------------------------------ */
/* Media permissions & screen capture                                  */
/* ------------------------------------------------------------------ */

function setupMedia() {
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const choice = pendingSource;
      pendingSource = null;
      const source = choice && sources.find((s) => s.id === choice.id);
      if (!source) return callback({});
      const streams = { video: source };
      if (choice.audio && process.platform === 'win32') streams.audio = 'loopback';
      callback(streams);
    } catch {
      callback({});
    }
  });

  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 384, height: 216 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.name && !/^Bliscord$/i.test(s.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });
  ipcMain.handle('screen:select', (_e, choice) => { pendingSource = choice; return true; });
}

/* ------------------------------------------------------------------ */
/* Updates                                                             */
/* ------------------------------------------------------------------ */

function sendUpdate(status) {
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
}

function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdate({ status: 'none' });
    return;
  }
  autoUpdater.checkForUpdates().catch(() => { /* reported through the 'error' event */ });
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ status: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    const message = String(err?.message || err);
    // A repo with no published release yet answers 404; that just means there is nothing newer.
    const nothingPublished = /404|No published versions|Unable to find latest version|Cannot find latest/i.test(message);
    sendUpdate(nothingPublished ? { status: 'none' } : { status: 'error', message });
  });
  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, 30 * 60 * 1000);
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function setupIpc() {
  ipcMain.on('config:get', (e) => { e.returnValue = { config, version: app.getVersion(), platform: process.platform }; });
  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:toggle-maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:close', () => win?.close());
  ipcMain.on('win:focus', () => showWindow());
  ipcMain.on('win:flash', () => { if (win && !win.isFocused()) win.flashFrame(true); });
  ipcMain.on('app:close-to-tray', (_e, value) => { closeToTray = Boolean(value); });
  ipcMain.on('badge:set', (_e, dataUrl, count) => {
    if (!win) return;
    if (process.platform === 'win32') {
      win.setOverlayIcon(dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, count ? `${count} unread` : '');
    } else {
      app.setBadgeCount(count || 0);
    }
    tray?.setToolTip(count ? `Bliscord (${count})` : 'Bliscord');
  });
  ipcMain.on('update:check', () => checkForUpdates());
  ipcMain.on('update:install', () => {
    quitting = true;
    autoUpdater.quitAndInstall(false, true);
  });

  let idle = false;
  setInterval(() => {
    const now = powerMonitor.getSystemIdleTime() > 600;
    if (now !== idle) {
      idle = now;
      win?.webContents.send('idle', idle);
    }
  }, 15000);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupIpc();
  setupMedia();
  createWindow();
  createTray();
  setupUpdater();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
