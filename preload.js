const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url_) => ipcRenderer.invoke('open-external', url_),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  openGoogleAuth: (u, partition) => ipcRenderer.invoke('open-google-auth', u, partition),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  setTitle: (title) => ipcRenderer.invoke('set-title', title),
  exportConfig: (jsonStr) => ipcRenderer.invoke('export-config', jsonStr),
  importConfig: () => ipcRenderer.invoke('import-config'),
  getCachedIcon: (u) => ipcRenderer.invoke('get-cached-icon', u),
  onScreenShareStatus: (cb) => ipcRenderer.on('screen-share-status', (_e, data) => cb(data)),
  // 3.2 — badge de não-lidos
  setUnreadCount: (n) => ipcRenderer.invoke('set-unread-count', n),
  // 3.3 — notificações nativas
  // Preload em sandbox não tem acesso a 'path'/'url': o main resolve o caminho
  webviewPreloadPath: ipcRenderer.sendSync('get-webview-preload-path'),
  showNativeNotification: (p) => ipcRenderer.invoke('show-native-notification', p),
  onFocusService: (cb) => ipcRenderer.on('focus-service', (_e, d) => cb(d)),
  storage: {
    pruneOrphans: (ids) => ipcRenderer.invoke('storage:prune-orphans', ids),
    clearPartition: (id) => ipcRenderer.invoke('storage:clear-partition', id),
    clearCache: (id) => ipcRenderer.invoke('storage:clear-cache', id),
    getUsage: (ids) => ipcRenderer.invoke('storage:get-usage', ids),
    runMaintenance: () => ipcRenderer.invoke('storage:run-maintenance')
  },
  // 3.4 — auto-launch
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled)
});
