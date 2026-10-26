// webview-preload.js — corre num mundo isolado; o código da página é injetado via executeInMainWorld
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const str = (v) => (typeof v === 'string' ? v : '');

contextBridge.exposeInMainWorld('__timworkspaces', {
  notify: (title, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    ipcRenderer.sendToHost('web-notification', {
      title: str(title),
      body: str(o.body),
      tag: str(o.tag),
      icon: str(o.icon)
    });
  },
  mediaState: (s) => {
    const o = s && typeof s === 'object' ? s : {};
    ipcRenderer.sendToHost('media-state', { screen: !!o.screen, mic: !!o.mic, cam: !!o.cam });
  }
});

function mainWorldSetup() {
  const bridge = window.__timworkspaces;
  if (!bridge) return;

  // Alguns sites bloqueiam passkey quando detectam automação (Electron expõe navigator.webdriver).
  // O bloqueio WebAuthn nos hosts Microsoft é injetado pelo main (microsoft-auth-guard.js).
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  // Substitui window.Notification por um shim que encaminha para notificações nativas
  try {
    function ShimNotification(title, opts) {
      const o = opts || {};
      try {
        bridge.notify(String(title || ''), { body: String(o.body || ''), tag: String(o.tag || ''), icon: String(o.icon || '') });
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
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    };
    Object.defineProperty(window, 'Notification', { value: ShimNotification, writable: true, configurable: true });
  } catch (e) {}

  // Estado de média (tela/mic/câmara) para o indicador do host e para não hibernar durante chamadas.
  // navigator.mediaDevices ainda pode não existir aqui: patch no protótipo
  try {
    const md = window.MediaDevices && window.MediaDevices.prototype;
    if (!md) return;
    const active = { screen: new Set(), mic: new Set(), cam: new Set() };
    const report = () => {
      try {
        bridge.mediaState({ screen: active.screen.size > 0, mic: active.mic.size > 0, cam: active.cam.size > 0 });
      } catch (e) {}
    };
    const watch = (stream, isDisplay) => {
      if (!stream || typeof stream.getTracks !== 'function') return stream;
      stream.getTracks().forEach((t) => {
        const kind = isDisplay ? (t.kind === 'video' ? 'screen' : null) : (t.kind === 'audio' ? 'mic' : 'cam');
        if (!kind) return;
        active[kind].add(t);
        const done = () => { if (active[kind].delete(t)) report(); };
        t.addEventListener('ended', done);
        // stop() não dispara 'ended'
        const origStop = t.stop.bind(t);
        t.stop = () => { origStop(); done(); };
      });
      report();
      return stream;
    };
    ['getDisplayMedia', 'getUserMedia'].forEach((name) => {
      const orig = md[name];
      if (typeof orig !== 'function') return;
      md[name] = function (...args) {
        return orig.apply(this, args).then((s) => watch(s, name === 'getDisplayMedia'));
      };
    });
    window.__twStopScreenShare = () => {
      [...active.screen].forEach((t) => {
        t.stop();
        try { t.dispatchEvent(new Event('ended')); } catch (e) {}
      });
    };
    window.addEventListener('pagehide', () => {
      active.screen.clear(); active.mic.clear(); active.cam.clear();
      report();
    });
  } catch (e) {}
}

try {
  contextBridge.executeInMainWorld({ func: mainWorldSetup });
} catch (e) {}
