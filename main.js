const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, Tray, nativeImage, dialog, desktopCapturer, systemPreferences, Notification, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

app.setName('Tim Workspaces');
if (process.platform === 'linux') process.title = 'Tim Workspaces';
let mainWindow = null;
let tray = null;
let isQuitting = false;

const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const AUTH_PRELOAD_PATH = path.join(__dirname, 'src', 'auth-preload.js');
const { getMicrosoftWebAuthnBlockScript } = require('./src/microsoft-auth-guard');
const MS_WEBAUTHN_BLOCK_SCRIPT = getMicrosoftWebAuthnBlockScript();

// Permissões concedidas em webviews (request + check devem alinhar; senão o site re-pede notificação, tela, etc.)
const WEBVIEW_PERMISSION_ALLOW = new Set([
  'media',
  'microphone',
  'camera',
  'audioCapture',
  'videoCapture',
  'notifications',
  'display-capture',
  'fullscreen',
  'speaker-selection',
  'window-management',
  'clipboard-read',
  'clipboard-sanitized-write'
]);

const configuredWebviewSessions = new WeakSet();
const configuredWebAuthnSelectors = new WeakSet();

// Só usado com keychain-access-groups + provisioning profile (ver entitlements.mac.webauthn.plist)
const WEBAUTHN_KEYCHAIN_GROUP = 'B63MDW2RH7.com.timworkspaces.app.webauthn';

function attachWebAuthnAccountSelector(sess) {
  if (!sess || configuredWebAuthnSelectors.has(sess)) return;
  configuredWebAuthnSelectors.add(sess);

  sess.on('select-webauthn-account', async (_event, details, callback) => {
    let selectedId = null;
    try {
      const accounts = details?.accounts || [];
      if (accounts.length === 1) {
        selectedId = accounts[0].credentialId;
      } else if (accounts.length > 1) {
        const labels = accounts.map((a, i) => a.name || a.email || `Conta ${i + 1}`);
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        const { response } = await dialog.showMessageBox(parent, {
          type: 'question',
          title: 'Escolher passkey',
          message: `Qual conta usar em ${details.relyingPartyId || 'este site'}?`,
          buttons: [...labels, 'Cancelar'],
          cancelId: labels.length,
          noLink: true
        });
        if (response >= 0 && response < accounts.length) {
          selectedId = accounts[response].credentialId;
        }
      }
    } catch {
      selectedId = null;
    } finally {
      callback(selectedId || undefined);
    }
  });
}

function ensureWebviewSessionHandlers(sess) {
  if (!sess || configuredWebviewSessions.has(sess)) return;
  configuredWebviewSessions.add(sess);

  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(WEBVIEW_PERMISSION_ALLOW.has(permission));
  });

  sess.setPermissionCheckHandler((_wc, permission) => WEBVIEW_PERMISSION_ALLOW.has(permission));

  attachWebviewDisplayMediaHandler(sess);
  attachWebAuthnAccountSelector(sess);
}

function parsePopupFeatures(features) {
  const size = { width: 520, height: 720 };
  if (!features || typeof features !== 'string') return size;
  for (const part of features.split(',')) {
    const [rawKey, rawVal] = part.trim().split('=');
    const key = rawKey?.trim().toLowerCase();
    const val = parseInt(String(rawVal || '').trim(), 10);
    if (!Number.isFinite(val) || val <= 0) continue;
    if (key === 'width' || key === 'innerwidth') size.width = val;
    if (key === 'height' || key === 'innerheight') size.height = val;
  }
  return size;
}

function buildPopupWindowOptions(partition, features) {
  const size = parsePopupFeatures(features);
  return {
    width: Math.min(Math.max(size.width, 420), 1200),
    height: Math.min(Math.max(size.height, 520), 1000),
    minWidth: 400,
    minHeight: 500,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    autoHideMenuBar: true,
    title: 'Tim Workspaces',
    webPreferences: {
      partition: sanitizePartition(partition),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: AUTH_PRELOAD_PATH,
      disableBlinkFeatures: 'AutomationControlled'
    }
  };
}

const msWebAuthnBypassSetup = new WeakSet();

function injectMicrosoftWebAuthnBlockAllFrames(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return;
  const injectFrame = (frame) => {
    if (!frame) return;
    let frameUrl = '';
    try { frameUrl = frame.url || ''; } catch {}
    if (frameUrl === 'about:blank') return;
    try {
      frame.executeJavaScript(MS_WEBAUTHN_BLOCK_SCRIPT, true).catch(() => {});
    } catch {}
  };
  try {
    injectFrame(webContents.mainFrame);
    for (const frame of webContents.mainFrame.framesInSubtree) {
      injectFrame(frame);
    }
  } catch {}
}

function setupMicrosoftWebAuthnBypass(webContents) {
  if (!webContents || msWebAuthnBypassSetup.has(webContents)) return;
  msWebAuthnBypassSetup.add(webContents);
  const run = () => injectMicrosoftWebAuthnBlockAllFrames(webContents);
  webContents.on('did-finish-load', run);
  webContents.on('did-frame-finish-load', run);
  webContents.on('did-navigate-in-page', run);
}

function setupAuthPopupWindow(childWindow) {
  if (!childWindow || childWindow.isDestroyed?.()) return;
  childWindow.setMenuBarVisibility(false);
  childWindow.webContents.setUserAgent(CHROME_USER_AGENT);
  ensureWebviewSessionHandlers(childWindow.webContents.session);
  setupWebviewWindowOpenHandler(childWindow.webContents);
  setupMicrosoftWebAuthnBypass(childWindow.webContents);
  const injectBanner = () => {
    if (isMicrosoftAuthUrl(childWindow.webContents.getURL())) {
      injectAuthFallbackBanner(childWindow.webContents);
    }
  };
  childWindow.webContents.on('did-finish-load', injectBanner);
  childWindow.webContents.on('did-frame-finish-load', injectBanner);
}

function setupWebviewWindowOpenHandler(webContents) {
  webContents.setWindowOpenHandler(({ url, features }) => {
    if (!url || typeof url !== 'string') return { action: 'deny' };

    const partition = webContents.session?.partition;
    ensureWebviewSessionHandlers(webContents.session);

    // OAuth / passkey: popup na mesma sessão (about:blank → redirect é comum)
    if (url === 'about:blank' || isAuthProviderUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: buildPopupWindowOptions(partition, features)
      };
    }

    // Links normais (target=_blank, etc.) → browser padrão do SO
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  webContents.on('did-create-window', (childWindow) => {
    setupAuthPopupWindow(childWindow);
  });
}

// Darwin 24 = macOS 15 Sequoia+: system picker nativo trata tudo (callback não corre nessas versões)
const SUPPORTS_SYSTEM_PICKER = process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 24;

function notifyScreenShare(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('screen-share-status', payload);
  }
}

async function ensureScreenPermission() {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;
  // Tenta trigger do prompt nativo (macOS pode exibir diálogo ao chamar getSources)
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['Abrir Definições', 'Cancelar'],
    defaultId: 0,
    title: 'Permissão de Gravação de Ecrã',
    message: 'O Tim Workspaces precisa de permissão para gravar o ecrã.',
    detail: 'Ative "Tim Workspaces" em Definições do Sistema → Privacidade e Segurança → Gravação de Ecrã e reinicie a app.'
  });
  if (response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  return false;
}

function showSourcePicker(sources, request) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      frame: false,
      width: 760,
      height: 560,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'src', 'picker', 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    const payload = sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }));

    let settled = false;

    const getHandler = () => ({
      sources: payload,
      audioRequested: !!request.audioRequested,
      platform: process.platform,
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    });
    ipcMain.handle('picker:get-sources', getHandler);

    const onChoose = (_e, choice) => finish(choice);
    const onCancel = () => finish(null);
    ipcMain.once('picker:choose', onChoose);
    ipcMain.once('picker:cancel', onCancel);
    win.on('closed', () => finish(null));

    function finish(result) {
      if (settled) return;
      settled = true;
      try { ipcMain.removeHandler('picker:get-sources'); } catch {}
      ipcMain.removeListener('picker:choose', onChoose);
      ipcMain.removeListener('picker:cancel', onCancel);
      if (!win.isDestroyed()) win.close();
      resolve(result);
    }

    win.loadFile(path.join(__dirname, 'src', 'picker', 'picker.html'));
  });
}

function attachWebviewDisplayMediaHandler(session) {
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      // macOS: verificar permissão antes de continuar
      if (process.platform === 'darwin') {
        const ok = await ensureScreenPermission();
        if (!ok) {
          callback({});
          notifyScreenShare({ state: 'permission-denied' });
          return;
        }
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: true
      });

      if (!sources.length) {
        callback({});
        return;
      }

      const choice = await showSourcePicker(sources, request);

      if (!choice) {
        callback({});
        notifyScreenShare({ state: 'cancelled' });
        return;
      }

      const video = sources.find((s) => s.id === choice.id);
      const streams = { video };
      if (request.audioRequested && choice.withAudio && process.platform === 'win32') {
        streams.audio = 'loopback';
      }
      callback(streams);
    } catch (err) {
      callback({});
      notifyScreenShare({ state: 'error', message: String(err) });
    }
  }, { useSystemPicker: SUPPORTS_SYSTEM_PICKER });
}

// --- Window bounds persistence ---

function loadWindowBounds() {
  try {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch {}
  return { width: 1280, height: 760 };
}

function saveWindowBounds(bounds) {
  try {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(stateFile, JSON.stringify(bounds), 'utf8');
  } catch {}
}

// --- Native menu ---

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const isDev = !app.isPackaged;

  if (isMac) {
    const template = [
      {
        label: 'Tim Workspaces',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'togglefullscreen' },
          ...(isDev ? [{ role: 'toggleDevTools' }] : [])
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' }
        ]
      }
    ];
    return Menu.buildFromTemplate(template);
  }

  // Windows / Linux
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Tim Workspaces',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Tim Workspaces',
              message: 'Tim Workspaces',
              detail: `Version: ${app.getVersion()}\nby Renato Ruis`,
              buttons: ['OK']
            });
          }
        },
        {
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/renatoruis/timworkspaces')
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

// --- createWindow ---

function createWindow() {
  const bounds = loadWindowBounds();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    title: 'Tim Workspaces',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  let boundsDebounce = null;
  const saveBoundsDebounced = () => {
    clearTimeout(boundsDebounce);
    boundsDebounce = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveWindowBounds(mainWindow.getBounds());
      }
    }, 500);
  };

  mainWindow.on('resize', saveBoundsDebounced);
  mainWindow.on('move', saveBoundsDebounced);

  mainWindow.on('close', (e) => {
    if (tray && process.platform !== 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      saveWindowBounds(mainWindow.getBounds());
    }
  });

  mainWindow.on('closed', () => {
    clearTimeout(boundsDebounce);
    mainWindow.removeAllListeners('resize');
    mainWindow.removeAllListeners('move');
    mainWindow = null;
  });
}

// --- IPC handlers ---

ipcMain.handle('open-external', async (_, targetUrl) => {
  if (targetUrl && typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
    await shell.openExternal(targetUrl);
    return true;
  }
  return false;
});

ipcMain.handle('open-external-auth-url', async (event) => {
  try {
    const wc = event.sender;
    if (!wc || wc.isDestroyed?.()) return false;
    const targetUrl = wc.getURL();
    if (targetUrl && typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
      await shell.openExternal(targetUrl);
      return true;
    }
  } catch {}
  return false;
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-platform-info', () => ({
  platform: process.platform,
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors
}));

ipcMain.handle('set-title', (_, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(title);
});

ipcMain.handle('export-config', async (_, jsonStr) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'timworkspaces-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { success: false, cancelled: true };
  try {
    fs.writeFileSync(result.filePath, jsonStr, 'utf8');
    return { success: true };
  } catch {
    return { success: false };
  }
});

ipcMain.handle('import-config', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    return fs.readFileSync(result.filePaths[0], 'utf8');
  } catch {
    return null;
  }
});

const RELEASES_URL = 'https://api.github.com/repos/renatoruis/timworkspaces/releases/latest';

function pickReleaseDownloadUrl(assets) {
  if (!Array.isArray(assets) || !assets.length) return null;
  const downloadable = assets.filter((a) => a?.browser_download_url && typeof a.name === 'string');
  if (!downloadable.length) return null;

  if (process.platform === 'darwin') {
    const dmgs = downloadable.filter((a) => /\.dmg$/i.test(a.name));
    if (!dmgs.length) return null;
    const archHint = process.arch === 'arm64' ? 'arm64' : 'x64';
    const match = dmgs.find((a) => a.name.toLowerCase().includes(archHint));
    return (match || dmgs[0]).browser_download_url;
  }
  if (process.platform === 'win32') {
    const exe = downloadable.find((a) => /\.exe$/i.test(a.name));
    return exe?.browser_download_url || null;
  }
  if (process.platform === 'linux') {
    const appImage = downloadable.find((a) => /\.AppImage$/i.test(a.name));
    if (appImage) return appImage.browser_download_url;
    const deb = downloadable.find((a) => /\.deb$/i.test(a.name));
    return deb?.browser_download_url || null;
  }
  return null;
}

function compareVersions(current, latest) {
  const curr = (current || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const latestClean = (latest || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = curr[i] || 0, b = latestClean[i] || 0;
    if (b > a) return true;
    if (b < a) return false;
  }
  return false;
}

ipcMain.handle('check-updates', async () => {
  try {
    const current = app.getVersion();
    const res = await fetch(RELEASES_URL, {
      headers: { 'User-Agent': 'TimWorkspaces/' + current }
    });
    if (!res.ok) return { available: false, currentVersion: current };
    const data = await res.json();
    const tagName = data.tag_name || '';
    const latestVersion = tagName.replace(/^v/, '');
    const url = data.html_url || 'https://github.com/renatoruis/timworkspaces/releases/latest';
    const downloadUrl = pickReleaseDownloadUrl(data.assets) || url;
    const releaseNotes = typeof data.body === 'string' ? data.body.trim() : '';
    const available = compareVersions(current, tagName);
    return { available, version: latestVersion, url, downloadUrl, releaseNotes, currentVersion: current };
  } catch {
    return { available: false, currentVersion: app.getVersion() };
  }
});

// Icon cache — fetch remote icons once, store on disk, serve as data URLs
const ICON_CACHE_DIR = path.join(app.getPath('userData'), 'icon-cache');
const ICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

ipcMain.handle('get-cached-icon', async (_e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  try {
    await fs.promises.mkdir(ICON_CACHE_DIR, { recursive: true });
    const hash = crypto.createHash('sha1').update(url).digest('hex');
    const filePath = path.join(ICON_CACHE_DIR, hash);
    const metaPath = filePath + '.meta';
    // Check cache hit
    try {
      const stat = await fs.promises.stat(filePath);
      if (Date.now() - stat.mtimeMs < ICON_CACHE_TTL) {
        const buf = await fs.promises.readFile(filePath);
        let mime = 'image/png';
        try { mime = (await fs.promises.readFile(metaPath, 'utf8')).trim() || mime; } catch {}
        return `data:${mime};base64,${buf.toString('base64')}`;
      }
    } catch {}
    // Cache miss — fetch
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(filePath, buf);
    await fs.promises.writeFile(metaPath, mime, 'utf8');
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
});

// Janela separada para login Google (evita bloqueio "browser may not be secure")
const GOOGLE_AUTH_PARTITION = 'persist:timworkspaces';
function sanitizePartition(p) {
  if (typeof p === 'string' && /^persist:timworkspaces(-[a-zA-Z0-9_-]+)?$/.test(p)) return p;
  return GOOGLE_AUTH_PARTITION;
}
function isGoogleAuthUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.hostname === 'accounts.google.com' || u.hostname.endsWith('.accounts.google.com');
  } catch {
    return false;
  }
}

function isMicrosoftAuthUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('.microsoftonline.com') || host === 'microsoftonline.com') return true;
    if (host === 'login.live.com' || host.endsWith('.login.live.com')) return true;
    if (host === 'login.microsoft.com') return true;
    if (host === 'account.live.com' || host.endsWith('.account.live.com')) return true;
    if (host === 'account.microsoft.com') return true;
    if (host === 'credential.login.microsoftonline.com') return true;
    return false;
  } catch {
    return false;
  }
}

function isAuthProviderUrl(url) {
  return isGoogleAuthUrl(url) || isMicrosoftAuthUrl(url);
}

function embeddedAuthWindowTitle(url) {
  if (isMicrosoftAuthUrl(url)) return 'Login Microsoft - Tim Workspaces';
  if (isGoogleAuthUrl(url)) return 'Login Google - Tim Workspaces';
  return 'Login - Tim Workspaces';
}

function injectAuthFallbackBanner(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return;
  const script = `(function() {
    if (document.getElementById('tw-auth-fallback')) return;
    const host = location.hostname.toLowerCase();
    const isMs = host.endsWith('.microsoftonline.com') || host === 'login.microsoft.com'
      || host === 'login.live.com' || host.endsWith('.login.live.com')
      || host === 'account.live.com' || host.endsWith('.account.live.com')
      || host === 'account.microsoft.com';
    if (!isMs) return;
    const bar = document.createElement('div');
    bar.id = 'tw-auth-fallback';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1d1b25;color:#ecebf3;padding:8px 12px;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(162,150,196,.2);box-sizing:border-box;';
    bar.innerHTML = '<span style="flex:1">Sem passkey? Use palavra-passe ou abra no navegador.</span><button type="button" id="tw-auth-external" style="flex-shrink:0;padding:6px 12px;border:none;border-radius:8px;background:#8b7cf6;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Abrir no navegador</button>';
    document.documentElement.appendChild(bar);
    if (document.body) document.body.style.paddingTop = '44px';
    document.getElementById('tw-auth-external').addEventListener('click', function() {
      if (window.authPreloadAPI && window.authPreloadAPI.openExternalAuthUrl) {
        window.authPreloadAPI.openExternalAuthUrl();
      }
    });
  })();`;
  webContents.executeJavaScript(script).catch(() => {});
}

function openEmbeddedAuthWindow(url, partition) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return Promise.resolve(null);
  const authPartition = sanitizePartition(partition);
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 520,
      height: 820,
      title: embeddedAuthWindowTitle(url),
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      autoHideMenuBar: true,
      webPreferences: {
        partition: authPartition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: AUTH_PRELOAD_PATH,
        disableBlinkFeatures: 'AutomationControlled'
      }
    });
    authWin.webContents.setUserAgent(CHROME_USER_AGENT);
    ensureWebviewSessionHandlers(authWin.webContents.session);
    setupWebviewWindowOpenHandler(authWin.webContents);
    setupMicrosoftWebAuthnBypass(authWin.webContents);

    const onAuthPageLoad = () => {
      if (isMicrosoftAuthUrl(authWin.webContents.getURL())) {
        injectAuthFallbackBanner(authWin.webContents);
      }
    };
    authWin.webContents.on('did-finish-load', onAuthPageLoad);
    authWin.webContents.on('did-navigate-in-page', onAuthPageLoad);

    try { authWin.loadURL(url); } catch { resolve(null); return; }

    let resolved = false;
    const onDone = (finalUrl) => {
      if (resolved) return;
      resolved = true;
      authWin.webContents.removeAllListeners('did-navigate');
      authWin.webContents.removeAllListeners('did-navigate-in-page');
      authWin.webContents.removeAllListeners('did-finish-load');
      if (!authWin.isDestroyed()) { try { authWin.close(); } catch {} }
      resolve(finalUrl || null);
    };

    authWin.webContents.on('did-navigate', (_e, navUrl) => {
      if (!isAuthProviderUrl(navUrl) && navUrl.startsWith('http')) {
        onDone(navUrl);
      }
    });
    authWin.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      if (!isAuthProviderUrl(navUrl) && navUrl.startsWith('http')) {
        onDone(navUrl);
      }
    });
    authWin.on('closed', () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

// Alias legado (Google)
function openGoogleAuthWindow(url, partition) {
  return openEmbeddedAuthWindow(url, partition);
}

ipcMain.handle('open-google-auth', (_, url, partition) => openEmbeddedAuthWindow(url, partition));

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

// 3.2 — badge de não-lidos
ipcMain.handle('set-unread-count', (_e, count) => {
  try {
    const n = Math.max(0, parseInt(count, 10) || 0);
    if (process.platform === 'darwin') {
      if (app.dock) app.dock.setBadge(n > 0 ? (n > 99 ? '99+' : String(n)) : '');
    } else if (process.platform === 'linux') {
      if (typeof app.setBadgeCount === 'function') app.setBadgeCount(n);
    } else if (process.platform === 'win32') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (n > 0) {
          const canvas = nativeImage.createEmpty();
          // Gera overlay 16×16 com número via dataURL
          const size = 16;
          const label = n > 99 ? '99+' : String(n);
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="8" cy="8" r="8" fill="#e11d48"/><text x="8" y="12" text-anchor="middle" font-size="${label.length > 2 ? 5 : 9}" font-family="Arial" font-weight="bold" fill="#fff">${label}</text></svg>`;
          const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
          mainWindow.setOverlayIcon(img, n + ' não lidas');
        } else {
          mainWindow.setOverlayIcon(null, '');
        }
      }
    }
    if (tray) {
      const label = n > 0 ? `Tim Workspaces — ${n} não lidas` : 'Tim Workspaces';
      tray.setToolTip(label);
    }
  } catch (err) {
    // defensivo: não deixa o handler crashar
  }
});

// 3.3 — notificações nativas do SO
ipcMain.handle('show-native-notification', (_e, p) => {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: p.title || p.serviceName || 'Tim Workspaces',
      body: p.body || '',
      silent: false
    });
    n.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('focus-service', { serviceId: p.serviceId });
      }
    });
    n.show();
  } catch (err) {}
});

// 3.4 — auto-launch
ipcMain.handle('get-auto-launch', () => {
  try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
});
ipcMain.handle('set-auto-launch', (_e, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  } catch { return false; }
});

app.on('web-contents-created', (_, webContents) => {
  if (webContents.getType?.() === 'webview') {
    ensureWebviewSessionHandlers(webContents.session);
    setupWebviewWindowOpenHandler(webContents);
    setupMicrosoftWebAuthnBypass(webContents);
  }
});

function configurePlatformWebAuthn() {
  if (process.platform !== 'darwin' || typeof app.configureWebAuthn !== 'function') return;
  // configureWebAuthn exige keychain-access-groups no entitlement + provisioning profile;
  // sem isso o macOS bloqueia o arranque da app assinada — ativar só quando suportado.
  if (process.env.TIMWORKSPACES_WEBAUTHN === '1') {
    try {
      app.configureWebAuthn({
        touchID: {
          keychainAccessGroup: WEBAUTHN_KEYCHAIN_GROUP,
          promptReason: 'iniciar sessão em $1'
        }
      });
      attachWebAuthnAccountSelector(session.defaultSession);
    } catch {
      // passkeys indisponíveis neste build
    }
  }
}

function createTrayIcon() {
  const iconPath = path.join(
    __dirname,
    'src',
    'assets',
    process.platform === 'darwin' ? 'icons/icon-timworkspaces-escuro-cir.png' : 'icone-fundo-escuro.png'
  );
  const source = nativeImage.createFromPath(iconPath);
  if (source.isEmpty()) return source;
  const size = process.platform === 'darwin' ? 18 : 16;
  return source.resize({ width: size, height: size, quality: 'best' });
}

// 3.4 — Tray (todas as plataformas)
function setupTray() {
  try {
    const trayIcon = createTrayIcon();
    if (trayIcon.isEmpty()) return;
    tray = new Tray(trayIcon);
    if (process.platform === 'darwin') tray.setIgnoreDoubleClickEvents(true);
    tray.setToolTip('Tim Workspaces');
    const trayMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir Tim Workspaces',
        click: () => {
          if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
          else createWindow();
        }
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => { tray = null; app.quit(); }
      }
    ]);
    tray.setContextMenu(trayMenu);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) mainWindow.focus();
        else { mainWindow.show(); mainWindow.focus(); }
      } else {
        createWindow();
      }
    });
  } catch (err) {
    // ícone em falta ou plataforma sem suporte a tray — não quebra o arranque
  }
}

app.whenReady().then(() => {
  configurePlatformWebAuthn();

  if (process.platform === 'win32') app.setAppUserModelId('com.timworkspaces.app');

  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Tim Workspaces',
      applicationVersion: app.getVersion(),
      credits: 'by Renato Ruis',
      website: 'https://github.com/renatoruis/timworkspaces'
    });
    const iconPath = path.join(__dirname, 'src', 'assets', 'icone-fundo-escuro.png');
    if (app.dock) app.dock.setIcon(iconPath);
  }

  Menu.setApplicationMenu(buildMenu());
  createWindow();
  setupTray();

  // 3.4 — atalho global toggle visibilidade
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (err) {}
});

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
