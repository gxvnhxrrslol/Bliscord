const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('admin', {
  get: (route) => ipcRenderer.invoke('admin', 'GET', route),
  post: (route, body) => ipcRenderer.invoke('admin', 'POST', route, body),
});
