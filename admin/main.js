// Bliscord Admin: a small control panel for the official Bliscord account.
// It only talks to the server running on this PC, using the token in server/data/admin-token.txt.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = process.env.BLISCORD_ADMIN_SERVER || 'http://localhost:3000';
const TOKEN_FILE = process.env.BLISCORD_ADMIN_TOKEN_FILE || path.join(__dirname, '..', 'server', 'data', 'admin-token.txt');

app.setPath('userData', path.join(app.getPath('appData'), 'Bliscord-Admin'));

async function request(method, route, body) {
  let token = '';
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {
    return { error: 'Start the Bliscord server first' };
  }
  try {
    const res = await fetch(`${SERVER}/api/admin${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { data } : { error: data.error || `Request failed (${res.status})` };
  } catch {
    return { error: 'The Bliscord server is not running' };
  }
}

ipcMain.handle('admin', (_e, method, route, body) => request(method, route, body));

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'Bliscord Admin',
    backgroundColor: '#0b0e15',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.on('window-all-closed', () => app.quit());
