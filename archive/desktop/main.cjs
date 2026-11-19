'use strict';
// Source and installed desktop launcher. Backend stays loopback-only and dies with the app.
const { app, BrowserWindow, dialog, session, shell, ipcMain, Notification } = require('electron');
const backendSupervisor = require('./backend-supervisor.cjs');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
app.setName('inkwell');
if (process.platform === 'linux') app.setDesktopName('inkwell.desktop');
const log = require('./diagnostics.cjs')(path.join(app.getPath('userData'), 'logs'));
log('desktop-start', {
  version: app.getVersion(),
  electron: process.versions.electron,
  pid: process.pid,
});
process.on('uncaughtExceptionMonitor', (error) =>
  log('main-exception', {
    type: error.name,
    frames: String(error.stack || '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 12),
  }),
);
app.on('child-process-gone', (_event, details) =>
  log('child-process-gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
  }),
);
let backend;
let quitting = false;
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const calendarFiles = require('./calendar-files.cjs')();
if (primaryInstance) calendarFiles.argumentsFrom(process.argv, process.cwd());
app.on('open-file', (event, file) => {
  event.preventDefault();
  if (primaryInstance) calendarFiles.enqueue([file]);
});

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
  let cookie;
  let window;
  let backendState = 'starting';
  backend = backendSupervisor({
    command: executable,
    args,
    options: {
      cwd: app.isPackaged ? app.getPath('home') : root,
      env: { ...process.env, INKWELL_ACCESS_KEY: key, INKWELL_HOSTS: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
    probe: async () => (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok,
    authenticate: async () => {
      const response = await fetch(origin + '/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Inkwell': '1' },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Could not unlock local backend');
      const value = response.headers.get('set-cookie')?.match(/inkwell_session=([^;]+)/)?.[1];
      if (!value) throw new Error('Missing local session');
      await session.defaultSession.cookies.set({
        url: origin,
        name: 'inkwell_session',
        value,
        httpOnly: true,
        sameSite: 'strict',
      });
      cookie = value;
    },
    onState: (value) => {
      backendState = value;
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        try {
          window.webContents.send('inkwell-backend-state', value);
        } catch (error) {
          log('backend-status-error', { type: error.name });
        }
      }
    },
    log,
  });
  await backend.start();
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
  window = new BrowserWindow({
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
  ipcMain.handle('inkwell-backend', (event, action) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame?.url || 'about:blank').origin !== origin
    )
      throw Error('Untrusted backend request');
    if (action === 'status') return backendState;
    if (action === 'retry') {
      void backend.retry();
      return;
    }
    throw Error('Unknown backend action');
  });
  window.once('closed', () => ipcMain.removeHandler('inkwell-backend'));
  window.webContents.on('did-finish-load', () =>
    log('renderer-ready', { pid: window.webContents.getOSProcessId() }),
  );
  let rendererFailures = [];
  const recoverRenderer = async (details) => {
    log('renderer-gone', { reason: details.reason, exitCode: details.exitCode });
    if (quitting || window.isDestroyed() || details.reason === 'clean-exit') return;
    const now = Date.now();
    rendererFailures = rendererFailures.filter((at) => now - at < 300000);
    rendererFailures.push(now);
    if (rendererFailures.length > 3) {
      const { response } = await dialog.showMessageBox(window, {
        type: 'error',
        title: 'Inkwell display stopped',
        message:
          'The display has stopped repeatedly. Reload to try again. Saved mail and drafts are kept.',
        buttons: ['Reload', 'Close'],
        defaultId: 0,
        cancelId: 1,
      });
      if (quitting || window.isDestroyed()) return;
      if (response === 1) {
        window.close();
        return;
      }
      rendererFailures = [];
    }
    if (!quitting && !window.isDestroyed()) window.webContents.reload();
  };
  window.webContents.on('render-process-gone', (_event, details) => {
    void recoverRenderer(details).catch((error) =>
      log('renderer-recovery-error', { type: error.name }),
    );
  });
  const cleanupExports = require('./file-export.cjs')(window, {
    origin,
    cookie: () => cookie,
    directory: path.join(
      process.env.INKWELL_DATA_DIR || path.join(app.getPath('home'), '.inkwell'),
      '.email-export-cache',
    ),
    iconPath: path.join(root, 'inkwell/static/icon-512.png'),
  });
  app.once('will-quit', cleanupExports);
  const cleanupAttachmentOpens = require('./attachment-open.cjs')(window, {
    origin,
    cookie: () => cookie,
  });
  app.once('will-quit', cleanupAttachmentOpens);
  require('./calendar-reminders.cjs')(window, origin, { Notification });
  calendarFiles.attach(window, origin, ipcMain);
  const osShortcut = require('./os-shortcut.cjs')({ home: app.getPath('home') });
  ipcMain.handle('inkwell-os-shortcut', async (event, action) => {
    const url = new URL(event.senderFrame?.url || 'about:blank');
    if (
      event.sender !== window.webContents ||
      event.senderFrame?.frameTreeNodeId !== window.webContents.mainFrame.frameTreeNodeId ||
      url.origin !== origin ||
      url.pathname !== '/'
    )
      throw Error('Untrusted shortcut request');
    if (action === 'status') return osShortcut.status();
    if (action === 'enable' || action === 'disable') return osShortcut.change(action === 'enable');
    throw Error('Unknown shortcut action');
  });
  window.once('closed', () => ipcMain.removeHandler('inkwell-os-shortcut'));
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
  const updates = require('./updates.cjs').createUpdater({
    version: app.getVersion(),
    home: app.getPath('home'),
    executable: process.execPath,
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    emit: (status) => {
      if (!window.isDestroyed()) window.webContents.send('inkwell-update-progress', status);
    },
    beforeRestart: async () => {
      if (window.isDestroyed()) return false;
      return window.webContents.executeJavaScript(
        'window.inkwellFlushBeforeClose ? window.inkwellFlushBeforeClose() : false',
      );
    },
    restart: (executable) => {
      closeAllowed = true; // Drafts were flushed before scheduling the restart.
      app.relaunch({ execPath: executable, args: [] });
      app.quit();
    },
  });
  ipcMain.handle('inkwell-updates', (event, action, version) => {
    const url = new URL(event.senderFrame?.url || 'about:blank');
    if (
      event.sender !== window.webContents ||
      event.senderFrame?.frameTreeNodeId !== window.webContents.mainFrame.frameTreeNodeId ||
      url.origin !== origin ||
      url.pathname !== '/'
    )
      throw Error('Untrusted update request');
    if (action === 'status') return { supported: updates.supported };
    if (action === 'check' || action === 'check-manual')
      return updates.check(action === 'check-manual');
    if (action === 'skip') return updates.skip(version);
    if (action === 'install') return updates.install(version);
    throw Error('Unknown update action');
  });
  window.once('closed', () => ipcMain.removeHandler('inkwell-updates'));
  // Fixed trusted commands only; also works while the script-free email frame has focus.
  let capturingShortcut = false;
  let nativeKeys = {
    sync: 'F9',
    quick_filter: 'Ctrl+Shift+K',
    zoom_in: 'Ctrl+Shift+=',
    zoom_out: 'Ctrl+Shift+-',
    zoom_reset: 'Ctrl+Shift+0',
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
    if (
      !capturingShortcut &&
      (input.control || input.meta) &&
      !input.alt &&
      (['+', '='].includes(key) || (!input.shift && ['-', '0'].includes(key)))
    ) {
      event.preventDefault();
      if (!input.isAutoRepeat)
        window.webContents
          .executeJavaScript(
            `window.InkwellAdjustZoom?.(${key === '-' ? -10 : key === '0' ? 0 : 10})`,
          )
          .catch(() => {});
      return;
    }
    const combo = [
      input.control || input.meta ? 'Ctrl' : '',
      input.alt ? 'Alt' : '',
      input.shift ? 'Shift' : '',
      plus
        ? '='
        : key === '_'
          ? '-'
          : key === ')'
            ? '0'
            : key.length === 1
              ? key.toUpperCase()
              : key,
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
}
if (primaryInstance) {
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      log('startup-error', { type: error.name });
      dialog.showErrorBox('Unable to start inkwell', error.message);
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
});
app.on('quit', (_event, exitCode) => log('desktop-exit', { exitCode }));
app.on('will-quit', () => {
  log('desktop-quit');
  void backend?.stop();
});
app.on('second-instance', (_event, argv, cwd) => {
  calendarFiles.argumentsFrom(argv, cwd);
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});
