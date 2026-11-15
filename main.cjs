// Desktop shell (Electron), run as a tray app: the local server runs in-process and is shown in a frameless window that can be
// pinned on top, made translucent / transparent, made click-through, and switched into "overlay" mode by clicking the tray icon
// or pressing a hotkey of your choice. Closing the window hides it to the tray; "Quit" in the tray menu exits.
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const { pathToFileURL } = require('node:url');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json');
const loadState = () => { try { return JSON.parse(readFileSync(STATE_FILE(), 'utf8')); } catch { return {}; } };
const saveState = (s) => { try { writeFileSync(STATE_FILE(), JSON.stringify(s)); } catch { /* ignore */ } };

let win = null;
let tray = null;
let server = null;
let port = 0;
let quitting = false;
let overlayOn = false;     // reported by the page; only used for the tray menu check mark
let keyOk = true;
const st = { onTop: false, clickThrough: false, opacity: 1, transparent: false, overlayKey: 'Control+Alt+O', ...loadState() };

// ---- icon (drawn in code so there is no asset to ship): a purple key-cap with a cyan dot --------------------------------
function makeIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const inside = (x, y, pad) => {
    const cx = Math.min(Math.max(x, pad + r), size - 1 - pad - r), cy = Math.min(Math.max(y, pad + r), size - 1 - pad - r);
    return x >= pad && y >= pad && x <= size - 1 - pad && y <= size - 1 - pad && Math.hypot(x - cx, y - cy) <= r;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let c = null;                                                    // [r,g,b,a]
    if (inside(x, y, 0)) c = [0x9c, 0x7a, 0xd6, 255];                // edge
    if (inside(x, y, 2)) c = [0x6f, 0x4f, 0xa0, 255];                // body
    if (Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) < size * 0.17) c = [0x29, 0xe4, 0xff, 255];   // dot
    const i = (y * size + x) * 4;
    if (c) { buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = c[3]; }   // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// Visible-on-screen check so a saved position from an unplugged monitor can't hide the window.
function fitBounds(b) {
  if (!b) return {};
  const ok = screen.getAllDisplays().some((d) => b.x >= d.bounds.x - 50 && b.y >= d.bounds.y - 50 && b.x < d.bounds.x + d.bounds.width - 100 && b.y < d.bounds.y + d.bounds.height - 100);
  return ok ? b : { width: b.width, height: b.height };
}

function pushState() {
  win?.webContents.send('kb:state', { onTop: st.onTop, clickThrough: st.clickThrough, opacity: st.opacity, transparent: st.transparent, overlayKey: st.overlayKey, overlayKeyOk: keyOk, overlayBounds: st.overlayBounds ?? null });
}

// ---- window ------------------------------------------------------------------------------------------------------------
function createWindow() {
  const old = win && !win.isDestroyed() ? win : null;
  const bounds = old ? old.getBounds() : st.bounds;
  const w = new BrowserWindow({
    width: 1280, height: 780, minWidth: 420, minHeight: 300,
    ...fitBounds(bounds),
    frame: false, title: 'War Thunder Keybinder', icon: makeIcon(64),
    transparent: st.transparent, hasShadow: !st.transparent,
    backgroundColor: st.transparent ? '#00000000' : '#05040f',
    alwaysOnTop: st.onTop, opacity: st.opacity,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win = w;
  w.setMenuBarVisibility(false);
  if (st.onTop) w.setAlwaysOnTop(true, 'screen-saver');
  if (st.clickThrough) w.setIgnoreMouseEvents(true, { forward: true });
  w.loadURL(`http://127.0.0.1:${port}/`);
  w.webContents.on('did-finish-load', pushState);
  // closing hides to the tray (the app keeps running); only "Quit" really exits
  w.on('close', (e) => {
    if (!w.isMinimized()) st.bounds = w.getBounds();
    saveState(st);
    if (!quitting) { e.preventDefault(); w.hide(); }
  });
  w.on('closed', () => { if (win === w) win = null; });
  // never navigate away from the local app
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) e.preventDefault(); });
  if (old) old.destroy();   // new window first, so the app never has zero windows in between
  return w;
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show(); win.focus();
  win.setAlwaysOnTop(st.onTop, 'screen-saver');
}
function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) win.hide(); else showWindow();
}
/** Overlay mode lives in the page (it changes layout); the shell just asks the page to flip it, showing the window first. */
function toggleOverlay() {
  showWindow();
  win.webContents.send('kb:command', 'overlay');
}

function setOnTop(on) { st.onTop = !!on; win?.setAlwaysOnTop(st.onTop, 'screen-saver'); saveState(st); pushState(); rebuildMenu(); }
function setClickThrough(on) {
  st.clickThrough = !!on;
  win?.setIgnoreMouseEvents(st.clickThrough, { forward: true });
  saveState(st); pushState(); rebuildMenu();
}
function setTransparent(on) {
  on = !!on;
  if (on === st.transparent) return;
  st.transparent = on;
  saveState(st);
  createWindow();   // transparency can only be chosen when a window is created
  rebuildMenu();
}

// ---- hotkeys -------------------------------------------------------------------------------------------------------------
const MODS = new Set(['Control', 'Alt', 'Shift', 'Super']);
const validAccel = (a) => {
  if (typeof a !== 'string') return false;
  const parts = a.split('+');
  const key = parts.pop();
  return parts.length >= 1 && parts.every((p) => MODS.has(p)) && /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Tab|Enter)$/.test(key);
};
function registerOverlayKey(accel) {
  if (st.overlayKey) globalShortcut.unregister(st.overlayKey);
  let ok = false;
  try { ok = globalShortcut.register(accel, toggleOverlay); } catch { ok = false; }
  keyOk = ok;
  if (ok) st.overlayKey = accel;
  else if (st.overlayKey && st.overlayKey !== accel) { try { globalShortcut.register(st.overlayKey, toggleOverlay); } catch { /* keep going */ } }
  saveState(st); pushState(); rebuildMenu();
  return ok;
}

// ---- tray ----------------------------------------------------------------------------------------------------------------
function rebuildMenu() {
  if (!tray) return;
  const nice = st.overlayKey.replace('Control', 'Ctrl').replace('Super', 'Win');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide window', click: toggleWindow, accelerator: undefined },
    { label: 'Overlay mode', type: 'checkbox', checked: overlayOn, click: toggleOverlay },
    { label: 'Hide background', type: 'checkbox', checked: st.transparent, click: (i) => setTransparent(i.checked) },
    { label: 'Always on top', type: 'checkbox', checked: st.onTop, click: (i) => setOnTop(i.checked) },
    { label: 'Click-through', type: 'checkbox', checked: st.clickThrough, click: (i) => setClickThrough(i.checked) },
    { type: 'separator' },
    { label: `Overlay hotkey: ${nice}${keyOk ? '' : ' (unavailable)'}`, enabled: false },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.setToolTip(`War Thunder Keybinder - click to ${overlayOn ? 'leave' : 'enter'} overlay (${nice})`);
}

ipcMain.on('kb:alwaysOnTop', (_e, on) => setOnTop(on));
ipcMain.on('kb:clickThrough', (_e, on) => setClickThrough(on));
ipcMain.on('kb:transparent', (_e, on) => setTransparent(on));
ipcMain.on('kb:opacity', (_e, v) => { st.opacity = Math.min(1, Math.max(0.35, Number(v) || 1)); win?.setOpacity(st.opacity); saveState(st); pushState(); });
ipcMain.on('kb:minimize', () => win?.minimize());
ipcMain.on('kb:close', () => win?.close());          // hides to the tray
ipcMain.on('kb:resize', (_e, w, h) => { if (win) win.setSize(Math.round(w), Math.round(h)); });

// Overlay position and size (chosen in Settings > Set up). Used every time overlay mode turns on.
ipcMain.on('kb:applyOverlayBounds', () => {
  if (!win) return;
  const b = st.overlayBounds ? fitBounds(st.overlayBounds) : { width: 880, height: 600 };   // fitBounds drops x/y if that spot is no longer on a screen
  if ('x' in b) win.setBounds(b); else win.setSize(b.width, b.height);
});
ipcMain.on('kb:saveOverlayBounds', () => {
  if (!win) return;
  st.overlayBounds = win.getBounds();
  saveState(st); pushState();
});
ipcMain.on('kb:resetOverlayBounds', () => { delete st.overlayBounds; saveState(st); pushState(); });
ipcMain.on('kb:overlayState', (_e, on) => {
  on = !!on;
  if (on === overlayOn) return;
  overlayOn = on;
  win?.setSkipTaskbar(on);
  // remember the exact window bounds from before overlay mode and put them back afterwards (kept in window.json across restarts)
  if (on) { if (!st.preOverlay && win) st.preOverlay = win.getBounds(); }
  else if (st.preOverlay && win) { win.setBounds(st.preOverlay); delete st.preOverlay; }
  saveState(st);
  rebuildMenu();
});
ipcMain.on('kb:overlayKey', (_e, accel) => { if (validAccel(accel)) registerOverlayKey(accel); });

app.whenReady().then(async () => {
  const { createServer } = await import(pathToFileURL(path.join(__dirname, 'server.mjs')).href);
  server = createServer();
  // Loopback only. A fixed port keeps the page's origin steady between launches; fall back to any free port.
  await new Promise((resolve) => {
    server.once('error', () => server.listen(0, '127.0.0.1', resolve));
    server.listen(5178, '127.0.0.1', resolve);
  });
  port = server.address().port;

  tray = new Tray(makeIcon(32));
  tray.on('click', toggleOverlay);            // left click: overlay on/off
  tray.on('double-click', showWindow);
  createWindow();
  if (!validAccel(st.overlayKey)) st.overlayKey = 'Control+Alt+O';
  registerOverlayKey(st.overlayKey);
  // Global hotkeys work while the game has focus.
  globalShortcut.register('Control+Alt+K', toggleWindow);
  globalShortcut.register('Control+Alt+L', () => setClickThrough(!st.clickThrough));
  globalShortcut.register('Control+Alt+M', () => win?.webContents.send('kb:command', 'compact'));
  rebuildMenu();
});
app.on('second-instance', showWindow);
app.on('window-all-closed', () => { /* tray app: keep running */ });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); server?.close(); });
