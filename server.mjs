// War Thunder keybind viewer. Zero dependencies (Node >= 22.5). Read-only on game/device files:
// the only files this app writes are config.json, labels.json and mouse-layout.json in its own folder.
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readControls, resolveBinds, readDeviceMapping, describeInput, describeBinding } from './lib/wtconfig.mjs';
import { readStore, listProfiles, readProfile, defaultStorePath } from './lib/azeron.mjs';
import { listGHubProfiles, readGHubProfile, defaultDbPath } from './lib/ghub.mjs';
import { keyName, keyTable, mouseName, dikToVk, MOUSE_VK } from './lib/dik.mjs';
import { createLive } from './lib/live.mjs';
import { keyboardLayout, keyboardChoices } from './lib/kblayout.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CONFIG_PATH = join(ROOT, 'config.json');
const LABELS_PATH = join(ROOT, 'labels.json');
const MOUSE_PATH = join(ROOT, 'mouse-layout.json');
const UI_PATH = join(ROOT, 'ui.json');
// view settings the page may save (whitelist + types; nothing else is written)
const UI_KEYS = { tab: 'string', common: 'boolean', drone: 'boolean', hideOptional: 'boolean', compact: 'boolean', showMouse: 'boolean', showLeft: 'boolean', showRight: 'boolean', overlayMode: 'boolean', overlaySetup: 'boolean', overlayMouse: 'boolean',
  showAzeron: 'boolean', showKeyboard: 'boolean', overlayAzeron: 'boolean', overlayKeyboard: 'boolean' };
const cleanUi = (p) => {
  const out = {};
  for (const [k, t] of Object.entries(UI_KEYS)) if (typeof p?.[k] === t) out[k] = t === 'string' ? String(p[k]).slice(0, 20) : p[k];
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
const catalog = readJson(join(ROOT, 'data', 'catalog.json'), null)?.items;
const presets = readJson(join(ROOT, 'data', 'presets.json'), null);
const layouts = readJson(join(ROOT, 'data', 'layouts.json'), {});
if (!catalog || !presets) { console.error('data/catalog.json or presets.json missing - run: npm run build-data <unpacked-dir>'); process.exit(1); }

// Layout sketched by the user: Left | (wheel column: up / click / down) | Right on top, five thumb-side buttons on the left.
// Buttons without a known game input ("Side n") are placeholders: set what they send in Edit layout.
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

const axisTab = (name) =>
  /^gm_/.test(name) ? 'ground' : /^ship_/.test(name) ? 'naval' : /^(sub_|submarine_)/.test(name) ? 'sub' : /^human_uav/.test(name) ? 'drone'
    : /^human_/.test(name) ? 'infantry' : /^helicopter_|^heli_/.test(name) ? 'heli' : /^(cam_|decal_)/.test(name) ? 'spectator' : 'air';

function azeronKeyView(k, offset) {
  const out = { ...k };
  if (k.kind === 'joy') { out.joyCode = offset + k.joyBtn - 1; out.ident = `JOY ${k.joyBtn}`; }
  else if (k.kind === 'key') {
    const key = k.key;
    out.ident = key.code == null ? `VK ${key.unknownVk}` : [...key.mods, key.code].map(keyName).join('+');
    out.modOnly = !!key.modOnly;
  } else if (k.kind === 'dir') out.ident = `Stick ${({ 0: 'Up', 90: 'Right', 180: 'Down', 270: 'Left' })[k.dir] ?? k.dir + '°'}`;
  else if (k.kind === 'analog') out.ident = 'Analog stick';
  else out.ident = '';
  return out;
}

function buildState() {
  const cfg = loadConfig();
  const sources = findSources();
  const machine = cfg.machine === 'auto' ? sources[0]?.path : cfg.machine;
  if (!machine) throw new Error('No War Thunder config found. Set "machine" in config.json.');
  const controls = readControls(machine);
  const { effective, origin, axes: effAxes, chain } = resolveBinds(controls, presets);
  const warnings = [];
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
    const keys = Object.fromEntries(Object.entries(profile.keys).map(([id, k]) => [id, azeronKeyView(k, azOffset)]));
    azeron = { name: profile.name, keys, profiles: listProfiles(store).map((p) => p.name), offset: azOffset, device: azDev ?? null };
  } catch (e) { warnings.push(`Azeron: ${e.message}`); }

  // G502: user-edited layout (mouse-layout.json) + optional G HUB profile used only to *offer* buttons
  let ghubProfiles = [];
  let ghubSlots = [];
  try {
    ghubProfiles = listGHubProfiles();
    if (cfg.ghubProfile) ghubSlots = readGHubProfile(cfg.ghubProfile);
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
    layouts: { azeron: layouts.azeron, keyboard: keyboardLayout(cfg.keyboardLayout) },
    keyboardChoices,
    config: cfg,
    stamp: stamp(machine),
  };
}

function stamp(machine) {
  const m = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  return [m(machine ?? ''), m(defaultStorePath()), m(defaultDbPath()), m(defaultDbPath() + '-wal')].join('-');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
  req.on('end', () => cb(body));
}

const LAYERS = new Set(['common', 'air', 'heli', 'ground', 'naval', 'sub', 'infantry', 'spectator', 'ground-drone', 'naval-drone']);
const clean = (s, n) => String(s ?? '').slice(0, n);

export function createServer() {
  const live = createLive();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // Only this app's own pages may call the API: blocks other websites (and DNS rebinding) from reading config or live key state.
      if (url.pathname.startsWith('/api/')) {
        const host = (req.headers.host ?? '').replace(/:\d+$/, '');
        const origin = req.headers.origin;
        if (!['127.0.0.1', 'localhost'].includes(host) || (origin && new URL(origin).host !== req.headers.host)) return send(res, 403, '{"error":"forbidden"}');
      }
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
              for (const k of ['machine', 'azeronProfile', 'ghubProfile', 'stickCal']) if (typeof p[k] === 'string') next[k] = clean(p[k], 500);
              if (keyboardChoices.some((c) => c.id === p.keyboardLayout)) next.keyboardLayout = p.keyboardLayout;
              writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
            } else if (url.pathname === '/api/ui') {
              writeFileSync(UI_PATH, JSON.stringify(cleanUi(p), null, 2));
            } else if (url.pathname === '/api/labels') {
              // { dev:'az'|'ms', key:'36', layer:'air', text:'Bino' }  (empty text deletes)
              if (!['az', 'ms', 'kb'].includes(p.dev) || !LAYERS.has(p.layer)) throw new Error('bad label target');
              const all = readJson(LABELS_PATH, {});
              const dev = (all[p.dev] ??= {});
              const key = clean(p.key, 40);
              const text = clean(p.text, 60).trim();
              dev[key] ??= {};
              if (text) dev[key][p.layer] = text; else delete dev[key][p.layer];
              if (!Object.keys(dev[key]).length) delete dev[key];
              writeFileSync(LABELS_PATH, JSON.stringify(all, null, 2));
            } else if (url.pathname === '/api/mouse-layout') {
              if (!Array.isArray(p.cells) || p.cells.length > 40) throw new Error('bad layout');
              const seen = new Set();
              const cells = p.cells.map((c) => {
                const id = clean(c.id, 30) || 'btn' + seen.size;
                if (seen.has(id)) throw new Error(`duplicate id ${id}`);
                seen.add(id);
                const cell = { id, label: clean(c.label, 30) || id, c: Math.max(0, Math.min(7, Number(c.c) | 0)), r: Math.max(0, Math.min(9, Number(c.r) | 0)) };
                if (Number.isInteger(c.mouse) && c.mouse >= 0 && c.mouse < 16) cell.mouse = c.mouse;
                else if (Number.isInteger(c.key) && c.key > 0 && c.key < 256) cell.key = c.key;
                return cell;
              });
              writeFileSync(MOUSE_PATH, JSON.stringify(cells, null, 2));
            } else return send(res, 404, '{"error":"unknown endpoint"}');
            send(res, 200, '{"ok":true}');
          } catch (e) { send(res, 400, JSON.stringify({ error: String(e.message) })); }
        });
      }
      // static
      const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
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
export { mouseName };
