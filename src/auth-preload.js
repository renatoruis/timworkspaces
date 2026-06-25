'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { applyMicrosoftAuthGuard } = require('./microsoft-auth-guard');

applyMicrosoftAuthGuard();

contextBridge.exposeInMainWorld('authPreloadAPI', {
  openExternalAuthUrl: () => ipcRenderer.invoke('open-external-auth-url')
});
