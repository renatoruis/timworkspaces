const { app, BrowserWindow, ipcMain, shell, nativeTheme, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Tim Workspaces');
if (process.platform === 'linux') process.title = 'Tim Workspaces';
let mainWindow = null;
let tray = null;
let isQuitting = false;

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

  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- IPC handlers ---

ipcMain.handle('open-external', (_, url) => {
  if (url && typeof url === 'string' && url.startsWith('http')) shell.openExternal(url);
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
        // Open external links in the system browser, not inside the webview
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
  }
});

app.whenReady().then(() => {
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

  if (process.platform !== 'darwin') {
    const iconPath = path.join(__dirname, 'src', 'assets', 'icone-fundo-escuro.png');
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray = new Tray(trayIcon);
    tray.setToolTip('Tim Workspaces');
    const trayMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir Tim Workspaces',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: 'Sair',
        click: () => {
          tray = null;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(trayMenu);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });
  }
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
