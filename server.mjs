// War Thunder keybind viewer. Zero dependencies (Node >= 22.13). Read-only on game/device files:
// the only files this app writes are its four settings files (config.json, ui.json, labels.json, mouse-layout.json).
// They live in this folder, or in the folder named by WTKB_DATA_DIR (the packaged desktop app points that at its user-data folder).
import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readControls, resolveBinds, readDeviceMapping, describeInput, describeBinding } from './lib/wtconfig.mjs';
import { readStore, listProfiles, readProfile, defaultStorePath } from './lib/azeron.mjs';
import { loadGHub, listGHubProfiles, readGHubProfile, cleanStaleCopies, defaultDbPath } from './lib/ghub.mjs';
import { keyName, keyTable, mouseName, dikToVk, MOUSE_VK } from './lib/dik.mjs';
import { createLive } from './lib/live.mjs';
import { keyboardLayout, keyboardChoices } from './lib/kblayout.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const SETTINGS_FILES = ['config.json', 'ui.json', 'labels.json', 'mouse-layout.json'];
const DATA_DIR = process.env.WTKB_DATA_DIR ? resolve(process.env.WTKB_DATA_DIR) : ROOT;
if (DATA_DIR !== ROOT) {
  // first run with a separate settings folder: start from the settings that shipped in the app folder, if any
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    for (const f of SETTINGS_FILES) if (!existsSync(join(DATA_DIR, f)) && existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(DATA_DIR, f));
  } catch (e) { console.error(`settings folder ${DATA_DIR}: ${e.message}`); }
}
const CONFIG_PATH = join(DATA_DIR, 'config.json');
const LABELS_PATH = join(DATA_DIR, 'labels.json');
const MOUSE_PATH = join(DATA_DIR, 'mouse-layout.json');
const UI_PATH = join(DATA_DIR, 'ui.json');
// view settings the page may save (whitelist + types; nothing else is written)
const UI_KEYS = { tab: 'string', deviceFlow: 'string', kbSize: 'string', common: 'boolean', drone: 'boolean', hideOptional: 'boolean', compact: 'boolean', showMouse: 'boolean', showLeft: 'boolean', showRight: 'boolean', overlayMode: 'boolean', overlaySetup: 'boolean', overlayMouse: 'boolean',
  showAzeron: 'boolean', showKeyboard: 'boolean', overlayAzeron: 'boolean', overlayKeyboard: 'boolean' };
const cleanUi = (p) => {
  const out = {};
  for (const [k, t] of Object.entries(UI_KEYS)) if (typeof p?.[k] === t) out[k] = t === 'string' ? String(p[k]).slice(0, 20) : p[k];
  if (!['wrap', 'row'].includes(out.deviceFlow)) delete out.deviceFlow;   // device panels: stacked (wrap) or side by side with a sideways scroll bar (row)
  if (!['azeron', 'fit'].includes(out.kbSize)) delete out.kbSize;         // keyboard keys: as big as the Azeron's, or small so the board fits the window
  for (const k of ['sizeAzeron', 'sizeKeyboard', 'sizeMouse']) if (Number.isFinite(p?.[k])) out[k] = Math.max(40, Math.min(250, Math.round(p[k])));   // panel sizes in percent
  for (const k of ['extra', 'showThrough']) {   // showThrough: array, or null = every layer (the default)
    if (Array.isArray(p?.[k])) out[k] = [...new Set(p[k].filter((t) => ['air', 'heli', 'ground', 'naval', 'sub', 'infantry', 'spectator'].includes(t)))];
    else if (k === 'showThrough' && p?.[k] === null) out[k] = null;
  }
  if (Number.isFinite(p?.overlayOpacity)) out.overlayOpacity = Math.max(35, Math.min(100, Math.round(p.overlayOpacity)));
  const o = p?.overlayPrev;
  if (o && typeof o === 'object') {
    out.overlayPrev = {};
    for (const k of ['compact', 'showLeft', 'showRight', 'showMouse', 'showAzeron', 'showKeyboard', 'transparent', 'onTop']) if (typeof o[k] === 'boolean') out.overlayPrev[k] = o[k];
    for (const k of ['w', 'h']) if (Number.isFinite(o[k])) out.overlayPrev[k] = Math.max(200, Math.min(8000, Math.round(o[k])));
    if (Number.isFinite(o.opacity)) out.overlayPrev.opacity = Math.max(0.35, Math.min(1, o.opacity));
  }
  return out;
};

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
/** Write via a temp file + rename, so a crash mid-write can't leave a half-written settings file. */
const writeJson = (p, v) => { const tmp = `${p}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 2)); renameSync(tmp, p); };
const catalog = readJson(join(ROOT, 'data', 'catalog.json'), null)?.items;
const presets = readJson(join(ROOT, 'data', 'presets.json'), null);
const layouts = readJson(join(ROOT, 'data', 'layouts.json'), {});
if (!catalog || !presets) { console.error('data/catalog.json or presets.json missing - run: npm run build-data <unpacked-dir>'); process.exit(1); }

// Layout sketched by the user: Left | (wheel column: up / click / down) | Right on top, five thumb-side buttons on the left.
// Buttons without a known game input ("Side n") are placeholders: set what they send in Settings > Mouse layout.
// Wheel up/down are WT mouse buttons 5/6 (inferred). The UI merges them into one "Scroll wheel" card when the wheel is bound as an axis.
const DEFAULT_MOUSE = [
  { id: 'side5', label: 'Side 5', c: 0, r: 0 },
  { id: 'lmb', label: 'Left', c: 1, r: 0, mouse: 0 },
  { id: 'rmb', label: 'Right', c: 3, r: 0, mouse: 1 },
  { id: 'side4', label: 'Side 4', c: 0, r: 1 },
  { id: 'fwd', label: 'Forward', c: 1, r: 1, mouse: 4 },
  { id: 'wheelup', label: 'Wheel up', c: 2, r: 1, mouse: 5 },
  { id: 'back', label: 'Back', c: 1, r: 2, mouse: 3 },
  { id: 'mmb', label: 'Wheel click', c: 2, r: 2, mouse: 2 },
  { id: 'side3', label: 'Side 3', c: 1, r: 3 },
  { id: 'wheeldown', label: 'Wheel down', c: 2, r: 3, mouse: 6 },
];

const loadConfig = () => ({ machine: 'auto', azeronProfile: 'War Thunder V2', ghubProfile: '', keyboardLayout: 'full', ...readJson(CONFIG_PATH, {}) });
const savesDir = () => join(homedir(), 'Documents', 'My Games', 'WarThunder', 'Saves');

/** Candidate control files: every machine.blk plus exported presets sitting in Saves/. */
function findSources() {
  const out = [];
  const dir = savesDir();
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory() && /^\d+$/.test(e.name)) {
        const m = join(p, 'production', 'machine.blk');
        if (existsSync(m)) out.push({ path: m, label: `Live config (account ${e.name})`, mtime: statSync(m).mtimeMs, live: true });
      } else if (e.isFile() && e.name.endsWith('.blk') && !/^(common|lastlogin)\.blk$/.test(e.name)) {
        if (/hotkeys\s*\{/.test(readFileSync(p, 'utf8'))) out.push({ path: p, label: `Export: ${e.name}`, mtime: statSync(p).mtimeMs });
      }
    } catch { /* unreadable file: skip */ }
  }
  return out.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.mtime - a.mtime);
}

// Which layer an axis belongs to: the game's own grouping (the catalog) decides; the name prefix is only the tie-break
// for an axis listed under several layers, and the fallback for one the catalog doesn't know.
const axisGuess = (name) =>
  /^gm_/.test(name) ? 'ground' : /^ship_/.test(name) ? 'naval' : /^(sub_|submarine_)/.test(name) ? 'sub' : /^human_uav/.test(name) ? 'drone'
    : /^human_/.test(name) ? 'infantry' : /^helicopter_|^heli_/.test(name) ? 'heli' : /^(cam_|decal_)/.test(name) ? 'spectator' : 'air';
const axisTabs = new Map();
for (const it of catalog) if (it.axis) (axisTabs.get(it.id) ?? axisTabs.set(it.id, []).get(it.id)).push(it.tab);
const axisTab = (name) => {
  const guess = axisGuess(name);
  const tabs = axisTabs.get(name);
  return !tabs || tabs.includes(guess) ? guess : tabs[0];
};

/** Adds what the page needs to one decoded Azeron function: its name (`ident`), and for game-visible ones the code the game sees
 *  (`joyCode`) or the Windows virtual-key that shows it is held (`vk`, for the live highlight). */
function functionView(f, offset) {
  const out = { ...f };
  if (f.kind === 'joy') { out.joyCode = offset + f.joyBtn - 1; out.ident = `JOY ${f.joyBtn}`; }
  else if (f.kind === 'key') {
    const key = f.key;
    out.ident = key.code == null ? `VK ${key.unknownVk}` : [...key.mods, key.code].map(keyName).join('+');
    out.modOnly = !!key.modOnly;
  } else if (f.kind === 'dir') out.ident = `Stick ${({ 0: 'Up', 90: 'Right', 180: 'Down', 270: 'Left' })[f.dir] ?? f.dir + '°'}`;
  else if (f.kind === 'analog') out.ident = 'Analog stick';
  else if (f.kind === 'mouse') { out.ident = mouseName(f.mouse); out.vk = MOUSE_VK[f.mouse] ?? null; }
  else if (f.kind === 'wheel') out.ident = f.wheel === 'up' ? 'Wheel up' : 'Wheel down';
  else if (f.kind === 'other') out.ident = f.label;
  else out.ident = '';
  return out;
}
function azeronKeyView(k, offset) {
  return { ...functionView(k, offset), alt: (k.alt ?? []).map((a) => functionView(a, offset)) };
}

function buildState() {
  const cfg = loadConfig();
  const sources = findSources();
  const warnings = [];
  let machine = cfg.machine === 'auto' ? sources[0]?.path : cfg.machine;
  if (!machine) throw new Error('No War Thunder config found. Set "machine" in config.json.');
  let controls;
  try { controls = readControls(machine); } catch (e) {
    // the chosen file is gone or unreadable: carry on with the newest live config rather than leaving the page empty
    if (cfg.machine === 'auto' || !sources[0] || sources[0].path === machine) throw e;
    warnings.push(`Could not read ${machine} (${e.code ?? e.message}); showing ${sources[0].label} instead. Pick a file in Settings.`);
    machine = sources[0].path;
    controls = readControls(machine);
  }
  const { effective, origin, axes: effAxes, chain } = resolveBinds(controls, presets);
  let devices = readDeviceMapping(controls);
  // exported presets carry no deviceMapping: borrow the live file's so joystick numbering still works
  if (!devices.length) {
    const live = sources.find((s) => s.live);
    if (live) { try { devices = readDeviceMapping(readControls(live.path)); warnings.push(`No deviceMapping in this file; using ${live.label}`); } catch { /* ignore */ } }
  }
  const azDev = devices.find((d) => /azeron/i.test(d.name ?? '') || /^16D0:/i.test(d.devId ?? ''));
  if (!azDev) warnings.push('Azeron not found in deviceMapping: its joystick keys cannot be matched.');
  const azOffset = azDev ? azDev.buttonsOffset : 0;

  const axisText = (a) => {
    const parts = [];
    if (a?.axisId != null && a.axisId >= 0) {
      const d = devices.find((x) => a.axisId >= x.axesOffset && a.axisId < x.axesOffset + x.axesCount);
      const local = d ? a.axisId - d.axesOffset + 1 : a.axisId;
      parts.push({ dev: d === azDev ? 'az' : 'other', text: `${d ? (d === azDev ? 'Azeron' : d.name) : 'Joystick'} axis ${local}${a.inverse ? ' (inv)' : ''}` });
    }
    if (a?.mouseAxisId != null && a.mouseAxisId >= 0) parts.push({ dev: 'ms', text: `Mouse axis ${a.mouseAxisId}` });
    return parts;
  };

  const items = catalog.map((it) => {
    const binds = (effective.get(it.id) ?? []).map((b) => ({
      text: describeBinding(b),
      role: it.axisRange ?? null,
      inputs: b.inputs.map((i) => ({ ...i, text: describeInput(i) })),
    }));
    const axisAssign = it.axis ? axisText(effAxes[it.id]) : [];
    return { ...it, binds, axisAssign, origin: origin.get(it.id) ?? null, explicitUnbind: effective.has(it.id) && binds.length === 0 };
  });

  // Azeron
  let azeron = null;
  try {
    const store = readStore();
    const profile = readProfile(store, cfg.azeronProfile);
    if (profile.name !== cfg.azeronProfile) warnings.push(`Azeron profile "${cfg.azeronProfile}" not found; showing the active profile "${profile.name}". Pick one in Settings.`);
    const keys = Object.fromEntries(Object.entries(profile.keys).map(([id, k]) => [id, azeronKeyView(k, azOffset)]));
    azeron = { name: profile.name, keys, profiles: listProfiles(store).map((p) => p.name), offset: azOffset, device: azDev ?? null };
  } catch (e) { warnings.push(`Azeron: ${e.message}`); }
  // Keys the drawing doesn't have (another Azeron model, a newer firmware) but that are wired and send something the game can
  // bind get a row of their own under the drawn keys, so nothing that is bound is ever invisible.
  let azLayout = layouts.azeron;
  if (azeron) {
    const drawn = new Set(azLayout.cells.map((c) => c.id));
    const extra = Object.values(azeron.keys).filter((k) => !drawn.has(k.id) && k.pin !== 255 && ['joy', 'key', 'mouse', 'wheel', 'dir'].includes(k.kind));
    if (extra.length) {
      azLayout = { ...azLayout, rows: azLayout.rows + Math.ceil(extra.length / azLayout.cols),
        cells: [...azLayout.cells, ...extra.map((k, i) => ({ id: k.id, c: i % azLayout.cols, r: azLayout.rows + Math.floor(i / azLayout.cols), extra: true }))] };
    }
  }

  // G502: user-edited layout (mouse-layout.json) + optional G HUB profile used only to *offer* buttons
  let ghubProfiles = [];
  let ghubSlots = [];
  try {
    const ghub = loadGHub();   // one read (cached until G HUB's files change) serves both the profile list and the chosen profile
    ghubProfiles = listGHubProfiles(ghub);
    if (cfg.ghubProfile) ghubSlots = readGHubProfile(ghub, cfg.ghubProfile, { model: cfg.ghubModel, overrides: cfg.ghubKeyOverrides });
  } catch (e) { warnings.push(`G HUB: ${e.message}`); }
  // each mouse cell also carries the Windows virtual-key that tells us when it is pressed (live highlight)
  const mouseCells = (readJson(MOUSE_PATH, null) ?? DEFAULT_MOUSE).map((c) => ({ ...c, vk: c.mouse != null ? MOUSE_VK[c.mouse] ?? null : c.key != null ? dikToVk(c.key) : null }));

  const axes = Object.entries(effAxes).map(([name, a]) => ({ name, tab: axisTab(name), ...a }));

  return {
    sources, machine, chain, devices, azeron, warnings, items, axes,
    g502: { cells: mouseCells, ghubProfiles, ghubSlots, ghubProfile: cfg.ghubProfile, isDefault: !existsSync(MOUSE_PATH) },
    labels: readJson(LABELS_PATH, {}),
    ui: readJson(UI_PATH, {}),
    keyTable: keyTable(),
    layouts: { azeron: azLayout, keyboard: keyboardLayout(cfg.keyboardLayout) },
    keyboardChoices,
    config: cfg,
    dataDir: DATA_DIR,
    stamp: stamp(machine),
  };
}

function stamp(machine) {
  const m = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  return [m(machine ?? ''), m(defaultStorePath()), m(defaultDbPath()), m(defaultDbPath() + '-wal')].join('-');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
// The page only ever loads its own script, styles and API: anything injected into it cannot run or phone out.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const send = (res, code, body, type = 'application/json') => {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP });
  res.end(body);
};

/** Only this app's own pages may call the API: blocks other websites (and DNS rebinding) from reading config or live key state. */
function apiAllowed(req) {
  const host = req.headers.host ?? '';
  if (!['127.0.0.1', 'localhost'].includes(host.replace(/:\d+$/, ''))) return false;
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { return false; }   // "null" (sandboxed page, file://) and other junk
    if (originHost !== host) return false;
  }
  // A plain <img>/<script> tag on another site sends no Origin header, but the browser still says where the request came from.
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none';
}

const LABEL_KEY = /^[\w:.\- ]{1,40}$/;                                 // Azeron key ids, mouse cell ids, keyboard scancodes / "g:Fn"
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
  req.on('end', () => cb(body));
}

const LAYERS = new Set(['common', 'air', 'heli', 'ground', 'naval', 'sub', 'infantry', 'spectator', 'ground-drone', 'naval-drone']);
const clean = (s, n) => String(s ?? '').slice(0, n);

/** cleanTemp: sweep G HUB temp copies left behind by older versions of this app, which never deleted them (off in the tests). */
export function createServer({ cleanTemp = true } = {}) {
  const live = createLive();
  if (cleanTemp) cleanStaleCopies();
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') && !apiAllowed(req)) return send(res, 403, '{"error":"forbidden"}');
      if (url.pathname === '/api/live') {
        const vid = /^[0-9a-fA-F]{4}$/.test(url.searchParams.get('vid') ?? '') ? url.searchParams.get('vid') : '';
        const pid = /^[0-9a-fA-F]{4}$/.test(url.searchParams.get('pid') ?? '') ? url.searchParams.get('pid') : '';
        const vks = [...new Set((url.searchParams.get('vks') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 254))].sort((a, b) => a - b).slice(0, 64);
        return live.subscribe(res, { vid, pid, vks });
      }
      if (url.pathname === '/api/state') return send(res, 200, JSON.stringify(buildState()));
      if (url.pathname === '/api/stamp') {
        const cfg = loadConfig();
        const machine = cfg.machine === 'auto' ? findSources()[0]?.path : cfg.machine;
        return send(res, 200, JSON.stringify({ stamp: stamp(machine) }));
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        return readBody(req, (body) => {
          try {
            const p = JSON.parse(body);
            if (url.pathname === '/api/config') {
              const next = { ...loadConfig() };
              for (const k of ['azeronProfile', 'ghubProfile', 'stickCal']) if (typeof p[k] === 'string') next[k] = clean(p[k], 500);
              // the controls file can only be one this app found itself ("auto", or an entry of the list it offers)
              if (typeof p.machine === 'string') {
                if (p.machine !== 'auto' && !findSources().some((s) => s.path === p.machine)) throw new Error('unknown controls file');
                next.machine = p.machine;
              }
              if (keyboardChoices.some((c) => c.id === p.keyboardLayout)) next.keyboardLayout = p.keyboardLayout;
              writeJson(CONFIG_PATH, next);
            } else if (url.pathname === '/api/ui') {
              writeJson(UI_PATH, cleanUi(p));
            } else if (url.pathname === '/api/labels') {
              // { dev:'az'|'ms'|'kb', key:'36', layer:'air', text:'Bino' }  (empty text deletes)
              const key = String(p.key ?? '');
              if (!['az', 'ms', 'kb'].includes(p.dev) || !LAYERS.has(p.layer) || !LABEL_KEY.test(key) || RESERVED_KEYS.has(key)) throw new Error('bad label target');
              const saved = readJson(LABELS_PATH, {});
              const all = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
              const own = (o, k) => (Object.hasOwn(o, k) && o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {}));
              const dev = own(all, p.dev);
              const entry = own(dev, key);
              const text = clean(p.text, 60).trim();
              if (text) entry[p.layer] = text; else delete entry[p.layer];
              if (!Object.keys(entry).length) delete dev[key];
              writeJson(LABELS_PATH, all);
            } else if (url.pathname === '/api/mouse-layout') {
              if (!Array.isArray(p.cells) || p.cells.length > 40) throw new Error('bad layout');
              const seen = new Set();
              const cells = p.cells.map((c) => {
                if (!c || typeof c !== 'object') throw new Error('bad layout');
                const id = clean(c.id, 30) || 'btn' + seen.size;
                if (!LABEL_KEY.test(id) || RESERVED_KEYS.has(id)) throw new Error(`bad id ${id}`);   // the id doubles as the key of this button's labels
                if (seen.has(id)) throw new Error(`duplicate id ${id}`);
                seen.add(id);
                const cell = { id, label: clean(c.label, 30) || id, c: Math.max(0, Math.min(7, Number(c.c) | 0)), r: Math.max(0, Math.min(9, Number(c.r) | 0)) };
                if (Number.isInteger(c.mouse) && c.mouse >= 0 && c.mouse < 16) cell.mouse = c.mouse;
                else if (Number.isInteger(c.key) && c.key > 0 && c.key < 256) cell.key = c.key;
                return cell;
              });
              writeJson(MOUSE_PATH, cells);
            } else return send(res, 404, '{"error":"unknown endpoint"}');
            send(res, 200, '{"ok":true}');
          } catch (e) { send(res, 400, JSON.stringify({ error: String(e.message) })); }
        });
      }
      // static
      let rel;
      try { rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad request', 'text/plain'); }
      const file = resolve(PUBLIC, '.' + rel);
      if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
      send(res, 200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream');
    } catch (e) {
      console.error(e);
      send(res, 500, JSON.stringify({ error: String(e.message) }));
    }
  });
  server.on('close', () => live.close());
  return server;
}

// Run standalone (node server.mjs). When imported by the desktop shell, it calls createServer() itself.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT ?? 5177);
  // Loopback only: this exposes local config contents.
  createServer().listen(PORT, '127.0.0.1', () => console.log(`War Thunder keybinder: http://localhost:${PORT}`));
}
