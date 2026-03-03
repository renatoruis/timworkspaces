const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  openGoogleAuth: (url, partition) => ipcRenderer.invoke('open-google-auth', url, partition),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  setTitle: (title) => ipcRenderer.invoke('set-title', title),
  exportConfig: (jsonStr) => ipcRenderer.invoke('export-config', jsonStr),
  importConfig: () => ipcRenderer.invoke('import-config')
});
