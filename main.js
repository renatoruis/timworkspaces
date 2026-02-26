const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

ipcMain.handle('open-google-auth', (_, url) => {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 480,
      height: 700,
      title: 'Login Google - Tim Workspaces',
      webPreferences: {
        partition: GOOGLE_AUTH_PARTITION,
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
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

app.whenReady().then(() => {
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
