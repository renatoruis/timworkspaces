const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');

app.setName('Tim Workspaces');
if (process.platform === 'linux') process.title = 'Tim Workspaces';
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Tim Workspaces',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('open-external', (_, url) => {
  if (url && typeof url === 'string' && url.startsWith('http')) shell.openExternal(url);
});

ipcMain.handle('get-app-version', () => app.getVersion());

const RELEASES_URL = 'https://api.github.com/repos/renatoruis/timworkspaces/releases/latest';
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
    const available = compareVersions(current, tagName);
    return { available, version: latestVersion, url, currentVersion: current };
  } catch {
    return { available: false, currentVersion: app.getVersion() };
  }
});

// Janela separada para login Google (evita bloqueio "browser may not be secure")
const GOOGLE_AUTH_PARTITION = 'persist:timworkspaces';
function isGoogleAuthUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.hostname === 'accounts.google.com' || u.hostname.endsWith('.accounts.google.com');
  } catch {
    return false;
  }
}

function openGoogleAuthWindow(url, partition) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return Promise.resolve(null);
  const authPartition = (partition && typeof partition === 'string') ? partition : GOOGLE_AUTH_PARTITION;
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 480,
      height: 700,
      title: 'Login Google - Tim Workspaces',
      webPreferences: {
        partition: authPartition,
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    authWin.setMenuBarVisibility(false);
    authWin.loadURL(url);

    let resolved = false;
    const onDone = (finalUrl) => {
      if (resolved) return;
      resolved = true;
      if (!authWin.isDestroyed()) authWin.close();
      resolve(finalUrl || null);
    };

    authWin.webContents.on('did-navigate', (e, navUrl) => {
      if (!isGoogleAuthUrl(navUrl) && navUrl.startsWith('http')) {
        onDone(navUrl);
      }
    });
    authWin.webContents.on('did-navigate-in-page', (e, navUrl) => {
      if (!isGoogleAuthUrl(navUrl) && navUrl.startsWith('http')) {
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

ipcMain.handle('open-google-auth', (_, url, partition) => openGoogleAuthWindow(url, partition));

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

app.on('web-contents-created', (_, webContents) => {
  if (webContents.getType?.() === 'webview') {
    webContents.setWindowOpenHandler(({ url }) => {
      if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return { action: 'deny' };
      }
      if (isGoogleAuthUrl(url)) {
        const partition = (webContents.session && typeof webContents.session.partition === 'string') ? webContents.session.partition : GOOGLE_AUTH_PARTITION;
        openGoogleAuthWindow(url, partition).then((finalUrl) => {
          if (finalUrl && !webContents.isDestroyed()) {
            webContents.loadURL(finalUrl);
          }
        });
      } else {
        webContents.loadURL(url);
      }
      return { action: 'deny' };
    });
  }
});

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, 'src', 'assets', 'icone-fundo-escuro.png');
    app.dock.setIcon(iconPath);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
