'use strict';
// Source and installed desktop launcher. Backend stays loopback-only and dies with the app.
const { app, BrowserWindow, dialog, session, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
app.setName('inkwell');
if (process.platform === 'linux') app.setDesktopName('inkwell.desktop');
let backend;
let quitting = false;
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function launch() {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const key = randomBytes(32).toString('hex');
  const root = path.resolve(__dirname, '..');
  const executable = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'inkwell-server',
        process.platform === 'win32' ? 'inkwell-server.exe' : 'inkwell-server',
      )
    : process.env.INKWELL_UV || 'uv';
  const args = app.isPackaged
    ? ['--port', String(port)]
    : ['run', '--frozen', 'python', '-m', 'inkwell', '--port', String(port)];
  backend = spawn(executable, args, {
    cwd: app.isPackaged ? app.getPath('home') : root,
    env: { ...process.env, INKWELL_ACCESS_KEY: key, INKWELL_HOSTS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  backend.stdout.on('data', (d) => {
    logs = (logs + d).slice(-4000);
  });
  backend.stderr.on('data', (d) => {
    logs = (logs + d).slice(-4000);
  });
  let failure;
  backend.on('error', (e) => {
    failure = e;
  });
  backend.on('exit', (code) => {
    if (!quitting) failure = new Error(`Backend stopped (${code}). ${logs}`);
  });
  let ready = false;
  for (let i = 0; i < 240; i++) {
    if (failure) throw failure;
    try {
      const response = await fetch(origin);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready)
    throw new Error(
      (app.isPackaged
        ? 'Bundled backend did not start. Reinstall inkwell or check your system libraries. '
        : 'Backend did not start. Install uv and run uv sync first. ') + logs,
    );
  const response = await fetch(origin + '/api/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Inkwell': '1' },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) throw new Error('Could not unlock local backend');
  const cookie = response.headers.get('set-cookie')?.match(/inkwell_session=([^;]+)/)?.[1];
  if (!cookie) throw new Error('Missing local session');
  await session.defaultSession.cookies.set({
    url: origin,
    name: 'inkwell_session',
    value: cookie,
    httpOnly: true,
    sameSite: 'strict',
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  const themeResponse = await fetch(origin + '/api/preferences', {
    headers: { Cookie: `inkwell_session=${cookie}`, Origin: origin },
    signal: AbortSignal.timeout(5000),
  });
  if (!themeResponse.ok) throw new Error('Could not load your saved appearance');
  const theme = (await themeResponse.json()).theme;
  if (!/^#[0-9a-f]{6}$/i.test(theme?.background)) throw new Error('Invalid saved background color');
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    title: 'inkwell',
    backgroundColor: theme.background,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(root, 'inkwell/static/icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const cleanupExports = require('./file-export.cjs')(window, {
    origin,
    cookie,
    directory: path.join(
      process.env.INKWELL_DATA_DIR || path.join(app.getPath('home'), '.inkwell'),
      '.email-export-cache',
    ),
    iconPath: path.join(root, 'inkwell/static/icon-512.png'),
  });
  app.once('will-quit', cleanupExports);
  let closing = false,
    closeAllowed = false;
  window.on('close', (event) => {
    if (closeAllowed || window.webContents.isDestroyed() || window.webContents.isCrashed()) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    window.webContents
      .executeJavaScript('window.inkwellFlushBeforeClose ? window.inkwellFlushBeforeClose() : true')
      .then((ok) => {
        closing = false;
        if (ok) {
          closeAllowed = true;
          window.close();
        } else quitting = false;
      })
      .catch(() => {
        closing = false;
        quitting = false;
        dialog.showErrorBox(
          'Draft could not be saved',
          'inkwell remains open to protect your work. Save your draft and try closing again.',
        );
      });
  });
  // Fixed trusted commands only; also works while the script-free email frame has focus.
  let capturingShortcut = false;
  let nativeKeys = {
    sync: 'F9',
    quick_filter: 'Ctrl+Shift+K',
    zoom_in: 'Ctrl+=',
    zoom_out: 'Ctrl+-',
    zoom_reset: 'Ctrl+0',
  };
  const configureKeys = (event, values) => {
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame?.frameTreeNodeId !== window.webContents.mainFrame.frameTreeNodeId ||
      !values ||
      typeof values !== 'object'
    )
      return;
    const next = {};
    for (const action of Object.keys(nativeKeys)) {
      const key = values[action];
      if (
        typeof key !== 'string' ||
        key.length > 40 ||
        !/^(?:(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9/=\-]|F(?:[1-9]|1[0-2])|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight))?$/.test(
          key,
        )
      )
        return;
      next[action] = key;
    }
    nativeKeys = next;
  };
  const captureKeys = (event, value) => {
    if (
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame?.frameTreeNodeId === window.webContents.mainFrame.frameTreeNodeId &&
      typeof value === 'boolean'
    )
      capturingShortcut = value;
  };
  ipcMain.on('inkwell-shortcut-capture', captureKeys);
  window.on('closed', () => ipcMain.removeListener('inkwell-shortcut-capture', captureKeys));
  ipcMain.on('inkwell-configure-shortcuts', configureKeys);
  window.on('closed', () => ipcMain.removeListener('inkwell-configure-shortcuts', configureKeys));
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isComposing) return;
    const key = String(input.key).slice(0, 40),
      plus = key === '+';
    const combo = [
      input.control || input.meta ? 'Ctrl' : '',
      input.alt ? 'Alt' : '',
      input.shift && !plus ? 'Shift' : '',
      plus ? '=' : key.length === 1 ? key.toUpperCase() : key,
    ]
      .filter(Boolean)
      .join('+');
    const data = {
      key,
      ctrlKey: !!input.control,
      metaKey: !!input.meta,
      altKey: !!input.alt,
      shiftKey: !!input.shift,
    };
    const global =
      !capturingShortcut &&
      Object.values(nativeKeys).includes(combo) &&
      (/^F\d+$/.test(key) || input.control || input.meta || input.alt);
    if (global) event.preventDefault();
    if (input.isAutoRepeat) return;
    window.webContents
      .executeJavaScript(
        `void window.${global ? 'InkwellNativeShortcut' : 'InkwellShortcutFromPreview'}?.(${JSON.stringify(data)})`,
      )
      .catch(() => {});
  });
  const externalTargets = new Set([
    'https://microsoft.com/devicelogin',
    'https://www.microsoft.com/devicelogin',
    'https://www.microsoft.com/link',
    'https://outlook.live.com/mail/',
    'https://outlook.office.com/mail/',
  ]);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (externalTargets.has(url)) {
      shell
        .openExternal(url)
        .catch(() =>
          dialog.showErrorBox(
            'Open Microsoft in your browser',
            `Could not open your default browser. Open ${url} manually. If inkwell displayed a device code, enter that code on Microsoft's sign-in page.`,
          ),
        );
    } else if (require('./email-links.cjs')(url, origin)) {
      window.webContents
        .executeJavaScript(
          'Boolean(document.querySelector(".reader-tools-dock .reader-actions [data-email-links]")?.checked)',
        )
        .then((enabled) => {
          if (enabled && !window.isDestroyed()) return shell.openExternal(url);
        })
        .catch(() => {});
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  await window.loadURL(origin);
  // The blocking head script must apply the palette before exposing any window content.
  const paintedBackground = await window.webContents.executeJavaScript(
    'window.InkwellStartupThemeApplied ? document.querySelector(\'meta[name="theme-color"]\').content : null',
  );
  if (!/^#[0-9a-f]{6}$/i.test(paintedBackground || ''))
    throw new Error('Could not apply your saved appearance');
  window.setBackgroundColor(paintedBackground);
  window.show();
  const monitor = setInterval(() => {
    if (failure && !quitting) {
      clearInterval(monitor);
      dialog.showErrorBox('inkwell server stopped', failure.message);
      app.quit();
    }
  }, 1500);
}
if (primaryInstance) {
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      dialog.showErrorBox('Unable to start inkwell', error.message);
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  backend?.kill();
});
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});
