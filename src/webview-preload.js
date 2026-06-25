// webview-preload.js — corre no contexto da webview (contextIsolation=no)
// Substitui window.Notification por um shim que encaminha para o processo host via ipc-message
'use strict';
const { ipcRenderer } = require('electron');
try {
  function ShimNotification(title, opts) {
    opts = opts || {};
    try {
      ipcRenderer.sendToHost('web-notification', {
        title: title,
        body: opts.body || '',
        tag: opts.tag || '',
        icon: opts.icon || ''
      });
    } catch (e) {}
    this.onclick = null;
    this.onclose = null;
    this.onerror = null;
    this.onshow = null;
  }
  ShimNotification.prototype.close = function () {};
  ShimNotification.prototype.addEventListener = function () {};
  ShimNotification.prototype.removeEventListener = function () {};
  ShimNotification.permission = 'granted';
  ShimNotification.requestPermission = function (cb) {
    var p = Promise.resolve('granted');
    if (typeof cb === 'function') cb('granted');
    return p;
  };
  Object.defineProperty(window, 'Notification', {
    value: ShimNotification,
    writable: true,
    configurable: true
  });
} catch (e) {}

// Alguns sites bloqueiam passkey quando detectam automação (Electron expõe navigator.webdriver)
const { applyMicrosoftAuthGuard } = require('./microsoft-auth-guard');
applyMicrosoftAuthGuard();
