const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  openGoogleAuth: (url, partition) => ipcRenderer.invoke('open-google-auth', url, partition)
});
