// War Thunder Keybinder front-end. Vanilla JS. Data comes from /api/state; edits go back through small POST endpoints.
const TABS = [['air', 'Air'], ['heli', 'Helicopter'], ['ground', 'Ground'], ['naval', 'Naval'], ['sub', 'Submarine'], ['infantry', 'Infantry'], ['spectator', 'Replay']];
const TAB_NAME = { air: 'Air', heli: 'Helicopter', ground: 'Ground', naval: 'Naval', sub: 'Submarine', infantry: 'Infantry', spectator: 'Replay / Spectator', drone: 'Drone', common: 'Common' };
// layers that can carry their own custom labels
const LAYERS = [['air', 'Air'], ['heli', 'Helicopter'], ['ground', 'Ground'], ['naval', 'Naval'], ['sub', 'Submarine'], ['infantry', 'Infantry'], ['spectator', 'Replay'], ['ground-drone', 'Ground drone'], ['naval-drone', 'Naval drone'], ['common', 'Common']];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = (a) => [...new Set(a)];
const SIZES = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];   // the panel sizes offered in Settings > View (percent)
const SIZE_MIN = 40, SIZE_MAX = 250;                                // what a hand-edited ui.json may hold
const DEVS = ['Azeron', 'Keyboard', 'Mouse'];   // device panels, left to right. Each has: ui.show<D>, ui.overlay<D>, buttons show<D> / setup<D> / overlay<D>

const ui = (() => { try { return JSON.parse(localStorage.getItem('wtkb-ui') ?? '{}'); } catch { return {}; } })();
// View settings are kept in the browser AND on the server (ui.json): the desktop window changes port / is recreated, which would lose localStorage.
let uiTimer = null;
const postUi = () => fetch('/api/ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ui) }).catch(() => {});
/** POST a change to the server. Returns true when it was saved; otherwise says so in the warning bar (what = "save the label"). */
let clientWarn = '';   // a failed save / load, shown in the warning bar next to the server's own warnings until the next one works
function showWarn() {
  const all = [...(S?.warnings ?? []), ...(clientWarn ? [clientWarn] : [])];
  const w = $('warn');
  w.hidden = !all.length;
  w.textContent = all.join('  |  ');
}
async function post(url, body, what) {
  let msg;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { clientWarn = ''; showWarn(); return true; }
    msg = (await r.json().catch(() => ({}))).error ?? `error ${r.status}`;
  } catch { msg = 'the app is not answering'; }
  clientWarn = `Could not ${what}: ${msg}`;
  showWarn();
  return false;
}
const saveUi = () => {
  try { localStorage.setItem('wtkb-ui', JSON.stringify(ui)); } catch { /* storage blocked */ }
  clearTimeout(uiTimer); uiTimer = setTimeout(postUi, 150);
};
let uiFromServer = false;
function uiDefaults() {
  ui.extra ??= [];   // ui.showThrough: layers that fill in unbound keys; null / missing = all of them (the original behaviour)
  ui.tab ??= 'air'; ui.common ??= true; ui.drone ??= false; ui.hideOptional ??= false; ui.compact ??= false;
  for (const d of DEVS) ui[`show${d}`] ??= true;       // each device panel (Azeron / Keyboard / Mouse) can be shown or hidden
  ui.overlayKeyboard ??= false;                        // the big keyboard is off in overlay mode unless you turn it on
  if (ui.kbSize !== 'fit') ui.kbSize = 'azeron';       // keyboard keys: 'azeron' = as big as the Azeron's keys, 'fit' = small, so the whole board fits the window
  for (const d of DEVS) {                              // size of each device panel in percent (keys, spacing and text together); 100 = the same key size on all three
    const v = Number(ui[`size${d}`]);
    ui[`size${d}`] = Number.isFinite(v) && v > 0 ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(v))) : 100;
  }
  if (ui.deviceFlow !== 'row') ui.deviceFlow = 'wrap'; // device panels: 'wrap' = stacked (a panel that doesn't fit moves down), 'row' = side by side, scrolling sideways
  ui.showLeft ??= true; ui.showRight ??= true;
  // "Bind order": the device order an action's binds are sorted into (keyboard, mouse, Azeron, any other joystick)
  if (!Array.isArray(ui.devOrder) || ui.devOrder.length !== 4 || !['kb', 'ms', 'az', 'joy'].every((d) => ui.devOrder.includes(d))) ui.devOrder = ['kb', 'ms', 'az', 'joy'];
  if (!TABS.some(([k]) => k === ui.tab)) ui.tab = 'air';
  if (new URLSearchParams(location.search).get('mini')) ui.compact = true;
}
uiDefaults();

let S = null;          // last state from the server
let stamp = null;
let selected = null;   // { dev:'az'|'ms', key }
let hlItem = null;     // action highlighted from a sidebar row
let draft = null;      // working copy of the mouse layout while Settings is open (null = Settings is closed)
let flash = new Set(); // "az:22" / "ms:lmb" cards highlighted from a sidebar notification (temporary)
let flashTimer = null;
let live = { status: 'idle', joy: 0, vks: [] };  // physical input state streamed by /api/live
let livePressed = new Set();                    // "az:22" / "ms:lmb" keys currently held down
let liveSrc = null;
let liveSig = '';

// ---------------------------------------------------------------- layers
const droneAvailable = () => ui.tab === 'ground' || ui.tab === 'naval';
const droneOn = () => ui.drone && droneAvailable();
/** Other layers the user chose to also show "through" to the current one (never the current tab itself). */
const extras = () => (ui.extra ?? []).filter((t) => t !== ui.tab);
const isExtra = (tab) => extras().includes(tab);
const ALL_LAYERS = ['air', 'heli', 'ground', 'naval', 'sub', 'infantry', 'spectator'];
/** Show-through: a key with NOTHING bound in the current view shows what it does on these layers. Default is every other layer;
 *  the user can narrow it in the "Also show" menu. Layers already shown "always" are excluded (they are covered). */
const throughLayers = () => (ui.showThrough ?? ALL_LAYERS).filter((t) => t !== ui.tab && !isExtra(t));
const SHORT = { air: 'Air', heli: 'Heli', ground: 'Ground', naval: 'Naval', sub: 'Sub', infantry: 'Infantry', spectator: 'Replay' };
/** The current tab plus its Common / Drone overlays. */
const inCore = (it) => it.tab === ui.tab
  || (ui.common && it.tab === 'common')
  || (droneOn() && it.tab === 'drone' && it.droneFor?.includes(ui.tab));
/** Is this game action part of what the current view shows? (core + the extra layers) */
const inSet = (it) => inCore(it) || isExtra(it.tab);
const axisShown = (a) => a.tab === ui.tab || (ui.common && a.tab === 'common') || (droneOn() && a.tab === 'drone') || isExtra(a.tab);
/** Custom-label layers consulted for a card in the current view, most specific first: this layer, its drone overlay, Common.
 *  Another layer's label is used only where that layer is what the card is showing (a key shown through / "always" from it),
 *  never on a key that is bound on this layer itself. `c` = the card (optional). */
function labelLayers(c) {
  const out = [ui.tab, ...(droneOn() ? [`${ui.tab}-drone`] : []), ...(ui.common ? ['common'] : [])];
  if (c?.list?.length && !c.list.some((e) => inCore(e.item))) out.push(...uniq(c.list.map((e) => e.item.tab)).filter((t) => ALL_LAYERS.includes(t)));
  return uniq(out);
}
function labelFor(dev, key, c) {
  const L = S.labels?.[dev]?.[key];
  if (!L) return null;
  for (const l of labelLayers(c)) if (Object.hasOwn(L, l) && L[l]) return { text: L[l], layer: l };
  return null;
}

// ---------------------------------------------------------------- index of binds
function indexBinds() {
  const trig = new Map();  // "joy:36" -> entries whose LAST input is this input
  const mods = new Map();  // inputs used as a modifier (earlier part of a chord)
  const bySig = new Map(); // "key:29+key:46" -> exact chord
  const push = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  for (const item of S.items) for (const bind of item.binds) {
    const sig = bind.inputs.map((i) => `${i.kind}:${i.code}`);
    const e = { item, bind };
    push(trig, sig[sig.length - 1], e);
    push(bySig, sig.join('+'), e);
    for (const m of sig.slice(0, -1)) push(mods, m, e);
  }
  return { trig, mods, bySig };
}

const keyNameOf = (code) => (S.keyTable.find(([c]) => c === code) ?? [0, `Key${code}`])[1];

/** In overlay mode, keys that are not set up on the device, not bound in game, or only bound on other tabs are hidden
 *  (their slot stays, so the layout doesn't shift). */
const ovHide = (c) => (ui.overlayMode && !c.cell?.keep && (c.cls === 'empty' || c.cls === 'unbound' || c.cls === 'idle') ? ' ov-hide' : '');   // (`keep` keys, e.g. Fn and Win on the Vanguard layout, stay visible)

/** A card that shows a bind edited in this app (not in the game yet) carries a small marker. */
const edCls = (c) => (c.entries.some((e) => e.item.edited) || c.modEntries.some((e) => e.item.edited) ? ' ed' : '');

function classify(entries, assigned) {
  const mine = entries.filter((e) => inSet(e.item));
  const other = entries.filter((e) => !inSet(e.item));
  // teal = only from overlay layers (Common, or layers shown through); purple = from this layer itself (or its drone overlay)
  if (mine.length) return { cls: mine.some((e) => e.item.tab !== 'common' && !isExtra(e.item.tab)) ? 'bound' : 'common', list: mine };
  // nothing bound in this view: fall through to the chosen layers, if the key does something there
  const thr = other.filter((e) => throughLayers().includes(e.item.tab));
  if (thr.length) return { cls: 'through', list: thr };
  // bound only on layers that are not shown through: nothing to show (the dark "idle" card; details still list them)
  if (other.length) return { cls: 'idle', list: [] };
  return { cls: assigned ? 'unbound' : 'empty', list: [] };
}

function deviceCards() {
  const { trig, mods, bySig } = indexBinds();
  const out = { az: [], kb: [], ms: [] };
  const azKeys = S.azeron?.keys ?? {};

  // ordinary keyboard: what War Thunder does with each key on this layer (keys with nothing bound just stay faint, never "unbound")
  for (const cell of S.layouts.keyboard.keys) {
    const key = cell.d ?? `g:${cell.l}`;
    const input = cell.d != null ? `key:${cell.d}` : null;
    const entries = input ? trig.get(input) ?? [] : [];
    const modEntries = input ? mods.get(input) ?? [] : [];
    const c = classify(entries, false);
    if (c.cls === 'empty' && modEntries.some((e) => inSet(e.item))) c.cls = 'bound';   // used as a modifier on this layer
    out.kb.push({ dev: 'kb', key, cell, k: { ident: cell.l }, entries, modEntries, sig: input, ...c });
  }

  // The wheel can be an axis (scrolling: mouse axes 2+ are the game's per-vehicle wheel slots) or up/down buttons (WT mouse 5/6).
  const wheelAxes = S.axes.filter((a) => a.mouseAxisId != null && a.mouseAxisId >= 2 && axisShown(a));

  /** What the game has bound to one Azeron function (a key's press, long press or double press): { sig, entries, modEntries }. */
  const lookup = (f) => {
    const plain = (sig) => ({ sig, entries: trig.get(sig) ?? [], modEntries: mods.get(sig) ?? [] });
    if (f.kind === 'joy') return plain(`joy:${f.joyCode}`);
    if (f.kind === 'mouse') return plain(`mouse:${f.mouse}`);
    if (f.kind === 'wheel') return plain(`mouse:${f.wheel === 'up' ? 5 : 6}`);
    if (f.kind === 'key' && f.key.code != null) {
      const own = `key:${f.key.code}`;
      if (!f.key.mods.length) return plain(own);
      // Azeron sends modifier + key together, so only that exact chord counts
      const sig = [...f.key.mods.map((m) => `key:${m}`), own].join('+');
      return { sig, entries: bySig.get(sig) ?? [], modEntries: [] };
    }
    return { sig: null, entries: [], modEntries: [] };
  };
  for (const cell of S.layouts.azeron.cells) {
    const k = azKeys[cell.id] ?? { id: cell.id, kind: 'none', ident: '', assigned: false };
    const { sig, entries, modEntries } = lookup(k);
    // thumb-pad direction keys send a hat direction; War Thunder's config has no hat binds, so they show as "not bound in game"
    const c = classify(entries, k.assigned && ['joy', 'key', 'dir', 'mouse', 'wheel'].includes(k.kind));
    if (c.cls === 'unbound' && modEntries.some((e) => inSet(e.item))) c.cls = 'bound'; // used only as a modifier
    // a key that turns the mouse wheel: where this layer uses the wheel as an axis and has nothing on wheel up/down, it drives that
    let wheelUse = null;
    if (k.kind === 'wheel' && wheelAxes.length && !['bound', 'common'].includes(c.cls)) { wheelUse = wheelAxes; c.cls = 'bound'; c.list = []; }
    // a function the game cannot bind as such (macro, Xbox button, profile switch, ...): shown for what it is, never as "unbound"
    if (k.kind === 'other') c.cls = 'special';
    const alt = (k.alt ?? []).map((a) => ({ ...a, ...lookup(a) }));   // what a long press / double press does, with its own binds
    out.az.push({ dev: 'az', key: cell.id, cell, k, entries, modEntries, sig, wheelAxes: wheelUse, alt, ...c });
  }

  // On the mouse panel: when this layer uses the wheel as an axis and nothing is bound to wheel up/down, show ONE "Scroll wheel" card instead of two.
  const wheelCells = S.g502.cells.filter((c) => c.mouse === 5 || c.mouse === 6);
  const wheelButtonsUsed = wheelCells.some((c) => [...(trig.get(`mouse:${c.mouse}`) ?? []), ...(mods.get(`mouse:${c.mouse}`) ?? [])].some((e) => inSet(e.item)));
  const mergeWheel = wheelAxes.length > 0 && !wheelButtonsUsed && wheelCells.length > 0;
  const wheelHost = mergeWheel ? (wheelCells.find((c) => c.mouse === 5) ?? wheelCells[0]) : null;

  for (const cell of S.g502.cells) {
    if (mergeWheel && (cell.mouse === 5 || cell.mouse === 6)) {
      if (cell !== wheelHost) continue; // the other half disappears into the merged card
      out.ms.push({ dev: 'ms', key: cell.id, cell, k: { ident: 'Scroll wheel' }, entries: [], modEntries: [], list: [], cls: 'bound', wheelAxes, merged: true, sig: null });
      continue;
    }
    const input = cell.mouse != null ? `mouse:${cell.mouse}` : cell.key != null ? `key:${cell.key}` : null;
    const entries = input ? trig.get(input) ?? [] : [];
    const modEntries = input ? mods.get(input) ?? [] : [];
    const c = classify(entries, input != null);
    if (c.cls === 'unbound' && modEntries.some((e) => inSet(e.item))) c.cls = 'bound';
    const ident = cell.mouse != null ? `Mouse${cell.mouse + 1}` : cell.key != null ? keyNameOf(cell.key) : '';
    out.ms.push({ dev: 'ms', key: cell.id, cell, k: { ident }, entries, modEntries, sig: input, ...c });
  }
  return out;
}

// ---------------------------------------------------------------- live input (press a key, its card lights up)
function liveSpec() {
  const vks = new Set();
  for (const k of Object.values(S.azeron?.keys ?? {})) {
    if (k.kind === 'key') { if (k.key.vk) vks.add(k.key.vk); if (k.key.modVk) vks.add(k.key.modVk); }
    else if (k.kind === 'mouse' && k.vk) vks.add(k.vk);
  }
  for (const c of S.g502.cells) if (c.vk) vks.add(c.vk);
  const [vid, pid] = (S.azeron?.device?.devId ?? '').toLowerCase().split(':');
  return { vid: vid ?? '', pid: pid ?? '', vks: [...vks].sort((a, b) => a - b) };
}
function startLive() {
  const spec = liveSpec();
  const sig = JSON.stringify(spec);
  if (liveSrc && sig === liveSig) return;
  liveSrc?.close();
  liveSig = sig;
  liveSrc = new EventSource(`/api/live?vid=${spec.vid}&pid=${spec.pid}&vks=${spec.vks.join(',')}`);
  liveSrc.onmessage = (e) => { live = JSON.parse(e.data); updateLive(true); };
}
// ---- analog stick axes -------------------------------------------------------------
// Windows' joystick API reports X,Y,Z,R,U,V. The game/DirectInput order is X,Y,Z,Rx,Ry,Rz, so by default
// DirectInput axis 4 (the stick's horizontal in your game config) is winmm index 4 and axis 3 is index 2.
// "Calibrate stick" (in the stick's details) overrides this by watching which axes move.
// Measured on the user's Azeron: the stick sweeps axes X and Y (indices 0 and 1) over 0..65535, X right = high, Y up = low.
const DEFAULT_STICK = { xi: 0, xs: 1, xb: 32767, yi: 1, ys: 1, yb: 32767 };
function stickCal() {
  try { const c = JSON.parse(S?.config?.stickCal || ''); if (c && [c.xi, c.yi].every(Number.isInteger) && c.xb != null && c.yb != null) return c; } catch { /* none saved */ }
  return DEFAULT_STICK;
}
let cal = null;       // { step:'right'|'up', base:[...], xi, xs, xb, hold }
let calText = '';
function startCalibration() {
  cal = { step: 'right', hold: 0, base: [...(live.axes ?? [])] };   // the resting values, so a stick that does not rest at exact centre still works
  calText = 'Leave the stick alone... then push it fully RIGHT and hold it.';
  showCalText();
}
function showCalText() { const el = $('calMsg'); if (el) el.textContent = calText; }
function stickCalibrationStep() {
  if (!cal || !live.axes?.length) return;
  // the axis that moved furthest from rest (ignoring the 6th, slider-like axis); it must stay there for a few updates
  const delta = (i) => (live.axes[i] - cal.base[i]) / 32767;
  let best = -1, bestV = 0;
  for (let i = 0; i < 5; i++) if (Math.abs(delta(i)) > Math.abs(bestV) && !(cal.step === 'up' && i === cal.xi)) { best = i; bestV = delta(i); }
  if (best < 0 || Math.abs(bestV) < 0.5) { cal.hold = 0; cal.last = -1; return; }
  cal.hold = cal.last === best ? cal.hold + 1 : 1;
  cal.last = best;
  if (cal.hold < 3) return;
  if (cal.step === 'right') {
    cal = { ...cal, step: 'up', xi: best, xs: bestV > 0 ? 1 : -1, xb: cal.base[best], hold: 0, last: -1 };
    calText = 'Good. Let go, then push the stick fully UP and hold it.';
  } else {
    const saved = { xi: cal.xi, xs: cal.xs, xb: cal.xb, yi: best, ys: bestV > 0 ? -1 : 1, yb: cal.base[best] };  // up must come out negative (screen y grows downward)
    cal = null;
    calText = 'Calibrated. Let go of the stick.';
    S.config.stickCal = JSON.stringify(saved);
    post('/api/config', { stickCal: S.config.stickCal }, 'save the calibration');
  }
  showCalText();
}

/** Put the live input state on the cards. `fresh` = called for a new message from the helper (not just a re-render). */
function updateLive(fresh = false) {
  if (!S) return;
  if (fresh && bindMenu?.cap) capJoy();   // the bind editor is waiting for a press
  const down = new Set(live.vks);
  const next = new Set();
  for (const k of Object.values(S?.azeron?.keys ?? {})) {
    if (k.kind === 'joy' && k.joyBtn <= 32 && ((live.joy >>> (k.joyBtn - 1)) & 1)) next.add(`az:${k.id}`);
    else if (k.kind === 'key' && k.key.vk && down.has(k.key.vk) && (!k.key.modVk || down.has(k.key.modVk))) next.add(`az:${k.id}`);
    else if (k.kind === 'mouse' && k.vk && down.has(k.vk)) next.add(`az:${k.id}`);
  }
  for (const c of S?.g502.cells ?? []) if (c.vk && down.has(c.vk)) next.add(`ms:${c.id}`);

  // thumb-pad direction keys arrive as a hat switch: angle in centidegrees, 65535 = centred (diagonals press two keys)
  if (live.pov != null && live.pov !== 65535) {
    const deg = live.pov / 100;
    for (const k of Object.values(S?.azeron?.keys ?? {})) {
      if (k.kind !== 'dir') continue;   // (the analog stick card itself never lights up: only its dot moves)
      const diff = Math.abs(((deg - k.dir + 540) % 360) - 180);
      if (diff <= 45) next.add(`az:${k.id}`);
    }
  }

  // analog stick: the dot follows the physical stick, whatever the game does with it.
  const stick = S?.layouts.azeron.cells.find((c) => c.stick);
  let sx = 0, sy = 0;
  if (stick) {
    if (fresh) stickCalibrationStep();
    const c = stickCal();
    {
      const d = (i, b) => (live.axes?.[i] != null ? (live.axes[i] - b) / 32767 : 0);
      sx = c.xs * d(c.xi, c.xb);
      sy = c.ys * d(c.yi, c.yb);
      const len = Math.hypot(sx, sy);
      if (len < 0.06) { sx = 0; sy = 0; } else if (len > 1) { sx /= len; sy /= len; }   // small dead zone, circular gate
    }
    const rd = $('axRead');                    // raw readout in the stick's details, for checking what the hardware reports
    if (rd) rd.textContent = (live.axes ?? []).map((v, i) => `${'XYZRUV'[i]} ${v}`).join('   ');
  }

  livePressed = next;
  for (const el of document.querySelectorAll('.card[data-dev]')) {
    el.classList.toggle('live', next.has(`${el.dataset.dev}:${el.dataset.key}`));
    const dot = el.classList.contains('stick') ? el.querySelector('.ring i') : null;
    if (dot) { dot.style.left = `${43 + sx * 43}%`; dot.style.top = `${43 + sy * 43}%`; }
  }
  const ind = $('liveInd');
  if (ind) ind.textContent = live.status === 'found' ? 'live input on' : live.status === 'missing' ? 'live: Azeron not detected' : live.status === 'starting' ? 'live: starting...' : live.status === 'unsupported' ? 'live input: Windows only' : '';
}

// ---------------------------------------------------------------- device rendering
const actNames = (list) => uniq(list.map((e) => e.item.name));
function actsHtml(list, extraClass = '', prefix = '') {
  const names = actNames(list);
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return `<div class="acts${extraClass}">${prefix}${shown.map(esc).join('<br>')}${more > 0 ? `<br>+${more} more` : ''}</div>`;
}

/** "modifier xN": how many binds IN THE CURRENT VIEW use this input as the held part of a chord. */
const modCount = (c) => c.modEntries.filter((e) => inSet(e.item)).length;
const modHtml = (c) => { const n = modCount(c); return n ? `<div class="mod">modifier &times;${n}</div>` : ''; };

function cardBody(c) {
  const lab = labelFor(c.dev, c.key, c);
  const other = c.cls === 'through' ? '<span class="sub">other: </span>' : '';   // (the layers are listed in the tooltip and the details)
  let html = '';
  if (lab) {
    html += `<div class="lab" title="${esc(lab.layer)} label">${esc(lab.text)}</div>`;
    if (c.list.length) html += `<div class="acts small">${other}${esc(actNames(c.list).slice(0, 2).join(' / '))}${actNames(c.list).length > 2 ? ' +' : ''}</div>`;
  } else if (c.list.length) html += actsHtml(c.list, c.list.length > 2 ? ' more' : '', other);
  else if (c.wheelAxes?.length) html += `<div class="acts${c.wheelAxes.length > 2 ? ' more' : ''}">${c.wheelAxes.slice(0, 3).map((a) => esc(axisName(a.name))).join('<br>')}${c.wheelAxes.length > 3 ? `<br>+${c.wheelAxes.length - 3} more` : ''}</div>`;
  else if (c.cls === 'special') html += '<div class="acts small">Azeron function</div>';
  else if (c.cls === 'unbound') html += '<div class="acts">not bound in game</div>';
  return html + modHtml(c) + altHtml(c);
}
/** A key's long-press / double-press function, as one short line each ("hold: Q", "2x: Macro"). */
const altHtml = (c) => (c.alt ?? []).map((a) => `<div class="mod alt">${a.press === 'long' ? 'hold' : '2&times;'}: ${esc(a.ident)}</div>`).join('');
const altName = (a) => (a.press === 'long' ? 'Long press' : 'Double press');

function tip(c) {
  const line = (e) => `${TAB_NAME[e.item.tab]}: ${e.item.name}${e.bind.inputs.length > 1 ? ' (' + e.bind.text + ')' : ''}`;
  const lines = c.entries.map(line);
  if (c.wheelAxes?.length) lines.push(`Scroll wheel (axis): ${c.wheelAxes.map((a) => axisName(a.name)).join(', ')}`);
  if (c.cls === 'special') lines.push(`${c.k.ident}: an Azeron function, not something the game binds`);
  for (const a of c.alt ?? []) lines.push(`${altName(a)} (${a.ident}): ${a.entries.map(line).join('; ') || (a.kind === 'other' ? 'an Azeron function' : 'nothing bound in game')}`);
  if (c.dev === 'kb') return lines.join('\n') || c.cell.tip || 'Nothing bound in game';
  return lines.join('\n') || (c.cls === 'empty' ? 'Not assigned' : 'Nothing bound');
}

// ---------------------------------------------------------------- keyboard rendering
function keyBody(c) {
  const lab = labelFor('kb', c.key, c);
  let html = '';
  if (lab) html += `<div class="lab" title="${esc(lab.layer)} label">${esc(lab.text)}</div>`;
  else if (c.list.length) {
    const names = actNames(c.list);
    html += `<div class="acts">${c.cls === 'through' ? '<span class="sub">other: </span>' : ''}${esc(names[0])}${names.length > 1 ? ` +${names.length - 1}` : ''}</div>`;
  }
  return html + modHtml(c);
}

/** Keyboard keys drawn as big as the Azeron's keys (Settings > Keyboard > Key size)? The overlay is a small fixed window, so
 *  there the board always shrinks to fit. */
const kbBig = () => ui.kbSize !== 'fit' && !ui.overlayMode;

function renderKeyboard(cards) {
  const L = S.layouts.keyboard;
  const el = $('keyboard');
  el.style.setProperty('--kw', L.w);
  el.style.setProperty('--kh', L.h);
  $('kbName').textContent = `· ${L.name}`;
  // --ku / --kv are one key unit across / down and --kgap the space between keys (style.css sets them for the chosen key size)
  const at = (c) => `left:calc(var(--ku) * ${c.x});top:calc(var(--kv) * ${c.y});width:calc(var(--ku) * ${c.w} - var(--kgap));height:calc(var(--kv) * ${c.h} - var(--kgap));margin:calc(var(--kgap) / 2)`;
  const body = kbBig() ? cardBody : keyBody;   // Azeron-sized keys have room for the same text as an Azeron card
  el.innerHTML = cards.map((c) => {
    const sel = selected?.dev === 'kb' && String(selected.key) === String(c.key) ? ' sel' : '';
    const hl = (hlItem && c.entries.some((e) => e.item.id === hlItem) ? ' hl' : '') + (flash.has(`kb:${c.key}`) ? ' flash' : '') + edCls(c) + ovHide(c);
    return `<button class="card kkey ${c.cls}${c.cell.keep ? ' keep' : ''}${sel}${hl}" style="${at(c.cell)}" data-dev="kb" data-key="${esc(c.key)}" title="${esc(tip(c))}">
      <span class="ident">${esc(c.cell.l)}</span>${body(c)}</button>`;
  }).join('');
}

function renderAzeron(cards) {
  const g = $('azeron');
  const { cols, rows } = S.layouts.azeron;
  g.style.gridTemplateColumns = `repeat(${cols}, var(--w))`;
  g.style.gridTemplateRows = `repeat(${rows}, var(--h))`;
  g.innerHTML = cards.map((c) => {
    const { cell, k } = c;
    const pos = `grid-column:${cell.c + 1}/span ${cell.w ?? 1};grid-row:${cell.r + 1}/span ${cell.h ?? 1}`;
    const sel = selected?.dev === 'az' && selected.key === cell.id ? ' sel' : '';
    const hl = (hlItem && c.entries.some((e) => e.item.id === hlItem) ? ' hl' : '') + (flash.has(`az:${cell.id}`) ? ' flash' : '') + (livePressed.has(`az:${cell.id}`) ? ' live' : '') + edCls(c) + ovHide(c);
    if (cell.stick) return stickHtml(c, pos, sel + (livePressed.has(`az:${cell.id}`) ? ' live' : ''));
    return `<button class="card ${c.cls}${sel}${hl}" style="${pos}" data-dev="az" data-key="${esc(cell.id)}" title="${esc(tip(c))}">
      <span class="ident">${esc(k.ident)}</span>${cardBody(c)}<span class="id">#${esc(cell.id)}</span></button>`;
  }).join('');
}

function stickHtml(c, pos, sel) {
  const dev = S.azeron?.device;
  const rows = [];
  if (dev) for (const a of S.axes) {
    if (a.axisId == null || a.axisId < dev.axesOffset || a.axisId >= dev.axesOffset + dev.axesCount) continue;
    if (!axisShown(a)) continue;
    rows.push(`${esc(axisName(a.name))} &larr; axis ${a.axisId - dev.axesOffset + 1}${a.inverse ? ' (inv)' : ''}`);
  }
  const lab = labelFor('az', c.cell.id, c);
  // the stick can be put in another mode in the Azeron software (keys, Xbox stick, mouse): then it is not the game's joystick axes
  const mode = c.k.kind === 'other' ? `<span class="dim">Azeron mode: ${esc(c.k.ident)}</span>` : '';
  return `<button class="card stick bound${sel}" style="${pos}" data-dev="az" data-key="${esc(c.cell.id)}" title="${mode ? esc(`Stick mode in the Azeron software: ${c.k.ident}`) : 'Analog stick: axes assigned in game for this layer'}">
    <span class="sname">Analog Joystick</span><div class="ring"><i></i></div>
    ${lab ? `<div class="lab">${esc(lab.text)}</div>` : ''}
    <div class="axl">${mode || (rows.length ? rows.join('<br>') : '<span class="dim">no stick axes for this layer</span>')}</div>
    <span class="id">#${esc(c.cell.id)}</span></button>`;
}
const axisName = (n) => n.replace(/^(gm|ship|sub|submarine|human)_/, '').replace(/_/g, ' ');

function renderMouse(cards) {
  const g = $('g502');
  const cols = Math.max(1, ...S.g502.cells.map((c) => c.c + 1));
  const rows = Math.max(1, ...S.g502.cells.map((c) => c.r + 1));
  g.style.gridTemplateColumns = `repeat(${cols}, var(--w))`;
  g.style.gridTemplateRows = `repeat(${rows}, var(--h))`;
  document.querySelector('.device.mouse').style.setProperty('--mcols', cols);
  g.innerHTML = cards.map((c) => {
    const { cell } = c;
    const pos = `grid-column:${cell.c + 1};grid-row:${cell.r + 1}`;
    const sel = selected?.dev === 'ms' && selected.key === cell.id ? ' sel' : '';
    const hl = (hlItem && c.entries.some((e) => e.item.id === hlItem) ? ' hl' : '') + (flash.has(`ms:${cell.id}`) ? ' flash' : '') + (livePressed.has(`ms:${cell.id}`) ? ' live' : '') + edCls(c) + ovHide(c);
    if (c.merged) {
      const lab = labelFor('ms', cell.id, c);
      const body = (lab ? `<div class="lab">${esc(lab.text)}</div>` : '') + (c.wheelAxes.length
        ? `<div class="acts${lab ? ' small' : ''}">${c.wheelAxes.slice(0, 3).map((a) => esc(axisName(a.name))).join('<br>')}${c.wheelAxes.length > 3 ? `<br>+${c.wheelAxes.length - 3} more` : ''}</div>` : '');
      return `<button class="card ${c.cls}${sel}${hl}" style="${pos}" data-dev="ms" data-key="${esc(cell.id)}" title="Scroll wheel (axis): ${esc(c.wheelAxes.map((a) => axisName(a.name)).join(', ') || 'nothing for this layer')}">
        <span class="ident">Scroll wheel</span>${body}<span class="id">axis</span></button>`;
    }
    const unset = cell.mouse == null && cell.key == null;
    return `<button class="card ${c.cls}${sel}${hl}" style="${pos}" data-dev="ms" data-key="${esc(cell.id)}" title="${esc(unset ? 'No input set: choose what this button sends in Settings > Mouse layout' : tip(c))}">
      <span class="ident">${esc(cell.label)}</span>${unset ? '<div class="sub">input not set</div>' : cardBody(c)}<span class="id">${esc(c.k.ident)}</span></button>`;
  }).join('');
}

// ---------------------------------------------------------------- detail + label editor
function renderDetail(cards) {
  const el = $('detail');
  if (!selected) { el.innerHTML = '<span class="dim">Click a key to see what is bound to it and to set its label for each layer.</span>'; return; }
  const c = cards[selected.dev].find((x) => String(x.key) === String(selected.key));
  if (!c) { el.innerHTML = ''; return; }
  let title;
  if (selected.dev === 'az') {
    const k = c.k;
    const how = k.kind === 'joy' ? `joystick button ${k.joyBtn}, game sees JOY${k.joyCode}` : k.kind === 'key' ? 'keyboard output' : k.kind === 'dir' ? 'thumbstick direction' : k.kind === 'analog' ? 'analog stick'
      : k.kind === 'mouse' ? `mouse button, game sees Mouse${k.mouse + 1}` : k.kind === 'wheel' ? 'turns the mouse wheel one notch'
        : k.kind === 'other' ? 'Azeron function: not something the game binds' : 'not assigned in Azeron software';
    title = `Azeron #${esc(k.id)} &ndash; ${esc(k.ident || 'unassigned')} <span class="dim">${esc(how)}</span>`;
  } else if (selected.dev === 'kb') {
    title = `Keyboard &ndash; ${esc(c.cell.l)} <span class="dim">${c.cell.d != null ? 'DirectInput key ' + c.cell.d : esc(c.cell.tip ?? 'no fixed key code')}</span>`;
  } else {
    title = `Mouse &ndash; ${esc(c.cell.label)} <span class="dim">${c.cell.mouse != null ? 'game sees Mouse' + (c.cell.mouse + 1) : c.cell.key != null ? 'sends keyboard key ' + esc(keyNameOf(c.cell.key)) : 'no game input set (Settings > Mouse layout)'}</span>`;
  }
  const byTab = {};
  for (const e of c.entries) (byTab[e.item.tab] ??= []).push(e);
  if (c.merged) {
    title = `Mouse &ndash; Scroll wheel <span class="dim">used as an axis (scrolling), not as up/down buttons</span>`;
    for (const a of S.axes.filter((x) => x.mouseAxisId != null && x.mouseAxisId >= 2)) (byTab[a.tab] ??= []).push({ item: { name: axisName(a.name) }, bind: { inputs: [], text: '' } });
  }
  // an Azeron key that turns the wheel also drives whatever uses the wheel as an axis (on any layer)
  if (c.k?.kind === 'wheel') for (const a of S.axes.filter((x) => x.mouseAxisId != null && x.mouseAxisId >= 2)) (byTab[a.tab] ??= []).push({ item: { name: `${axisName(a.name)} (wheel axis)` }, bind: { inputs: [], text: '' } });
  const bindLine = (e) => `<span class="sub">${esc(TAB_NAME[e.item.tab] ?? '')}:</span> ${esc(e.item.name)}${e.bind.inputs.length > 1 ? ` <span class="sub">(${esc(e.bind.text)})</span>` : ''}`;
  let rows = Object.keys(TAB_NAME).filter((t) => byTab[t]).map((t) =>
    `<tr><td>${TAB_NAME[t]}</td><td>${uniq(byTab[t].map((e) => esc(e.item.name) + (e.bind.inputs.length > 1 ? ` <span class="sub">(${esc(e.bind.text)})</span>` : ''))).join('<br>')}</td></tr>`).join('');
  if (c.modEntries.length) rows += `<tr><td>Modifier</td><td>${uniq(c.modEntries.map((e) => `<span class="sub">${esc(TAB_NAME[e.item.tab] ?? '')}:</span> ` + esc(e.item.name) + ` <span class="sub">(${esc(e.bind.text)})</span>`)).join('<br>')}</td></tr>`;
  // what the Azeron key does on a long press / double press, with whatever the game has bound to that
  for (const a of c.alt ?? []) {
    rows += `<tr><td>${altName(a)}</td><td><strong>${esc(a.ident)}</strong> <span class="sub">${a.kind === 'other' ? 'Azeron function' : a.entries.length ? '' : 'nothing bound in game'}</span>${a.entries.length ? '<br>' + uniq(a.entries.map(bindLine)).join('<br>') : ''}</td></tr>`;
  }
  const mine = S.labels?.[selected.dev]?.[selected.key] ?? {};
  const active = labelLayers(c);
  const labelInputs = LAYERS.map(([id, name]) => `<label class="lbl${active.includes(id) ? ' live' : ''}"><span>${name}</span><input type="text" maxlength="60" data-layer="${id}" value="${esc(mine[id] ?? '')}" placeholder="&ndash;"></label>`).join('');
  const stickTools = c.cell?.stick ? '<div class="dim" style="margin-top:6px;font-size:11px">Stick calibration is in Settings (the cog).</div>' : '';
  el.innerHTML = `<h3>${title}</h3>
    <div class="detail-cols"><div>${rows ? `<table>${rows}</table>` : `<span class="dim">${c.cls === 'special' ? 'This key runs an Azeron function; the game has nothing to bind to it.' : 'Nothing bound to this key in game.'}</span>`}${stickTools}</div>
    <div class="labels"><div class="dim lbl-head">Custom label per layer (highlighted: the layers this key takes its label from right now, first match wins)</div><div class="lbl-grid">${labelInputs}</div></div></div>`;
}

async function saveLabel(dev, key, layer, text) {
  const all = (S.labels[dev] ??= {});
  const k = String(key);
  all[k] ??= {};
  if (text.trim()) all[k][layer] = text.trim(); else delete all[k][layer];
  if (!Object.keys(all[k]).length) delete all[k];
  const cards = deviceCards();
  renderAzeron(cards.az); renderKeyboard(cards.kb); renderMouse(cards.ms); // not the detail panel: keep the input focused
  updateLive();
  await post('/api/labels', { dev, key: k, layer, text }, 'save the label');
}

// ---------------------------------------------------------------- mouse layout editor
// The editor lives in Settings > Mouse layout. `draft` is a working copy of the layout that exists while Settings is open;
// nothing is stored until "Save layout" (closing Settings with unsaved changes asks first).
const newDraft = () => S.g502.cells.map((c) => ({ ...c }));
const cellNorm = (c) => ({ id: c.id, label: c.label, c: c.c, r: c.r, ...(c.mouse != null ? { mouse: c.mouse } : c.key != null ? { key: c.key } : {}) });
const draftDirty = () => !!draft && !!S && JSON.stringify(draft.map(cellNorm)) !== JSON.stringify(S.g502.cells.map(cellNorm));
/** Refresh the editor's status line and buttons after a change (`msg` = say this instead of the usual "Unsaved changes"). */
function markDraft(msg) {
  const dirty = draftDirty();
  const state = $('mState');
  if (state) state.textContent = msg ?? (dirty ? 'Unsaved changes' : '');
  for (const id of ['mSave', 'mRevert']) { const b = $(id); if (b) b.disabled = !dirty; }
}

function renderMouseEditor() {
  const el = $('mouseEditor');
  if (!draft) { el.innerHTML = ''; return; }
  const keyOpts = S.keyTable.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');
  const rows = draft.map((c, i) => {
    const isKey = c.key != null;
    const kind = c.mouse != null ? 'mouse' : isKey ? 'key' : 'none';
    return `<div class="mrow" data-i="${i}">
      <input type="text" class="m-label" value="${esc(c.label)}" maxlength="30" aria-label="Button name">
      <select class="m-kind" aria-label="Kind"><option value="mouse"${kind === 'mouse' ? ' selected' : ''}>Mouse button</option><option value="key"${kind === 'key' ? ' selected' : ''}>Keyboard key</option><option value="none"${kind === 'none' ? ' selected' : ''}>Not set yet</option></select>
      ${kind === 'none' ? '<span class="pos">pick what it sends</span>' : isKey
        ? `<select class="m-code" aria-label="Key">${keyOpts.replace(`value="${c.key}"`, `value="${c.key}" selected`)}</select>`
        : `<select class="m-code" aria-label="Mouse button">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n - 1}"${c.mouse === n - 1 ? ' selected' : ''}>Mouse${n}${n === 1 ? ' (left)' : n === 2 ? ' (right)' : n === 3 ? ' (middle)' : n === 4 ? ' (back)' : n === 5 ? ' (forward)' : ''}</option>`).join('')}</select>`}
      <label class="pos">col <input type="number" class="m-c" min="0" max="7" value="${c.c}"></label>
      <label class="pos">row <input type="number" class="m-r" min="0" max="9" value="${c.r}"></label>
      <button class="mini m-del" aria-label="Remove ${esc(c.label)}">&times;</button></div>`;
  }).join('');
  const slots = (S.g502.ghubSlots ?? []).filter((s) => s.decoded && !draft.some((c) => c.id === `g-${s.slot}`));
  el.innerHTML = `<p class="note">Only add buttons your mouse really has. "col/row" place the card on the grid. Wheel up/down (Mouse6/Mouse7) merge into one "Scroll wheel" card when a layer uses the wheel as an axis.</p>
    ${rows || '<div class="note">No buttons yet.</div>'}
    <div class="mrow-actions">
      <button class="mini" id="mAdd">+ Add button</button>
      ${slots.length ? `<label class="pos">Add from G HUB <select id="ghubAdd"><option value="">choose...</option>${slots.map((s) => `<option value="${esc(s.slot)}">${esc(s.slot.toUpperCase())}: ${esc(s.label)}</option>`).join('')}</select></label>`
        : `<span class="note">${S.g502.ghubProfile ? 'Every button of the chosen G HUB profile is already added.' : 'Choose a G HUB profile (under Controls and devices, above) to add its buttons here.'}</span>`}
    </div>
    <div class="mrow-actions"><button id="mSave">Save layout</button><button class="mini" id="mRevert">Revert</button><span class="note" id="mState" role="status"></span></div>`;
  markDraft();
}

function nextFree() {
  for (let r = 0; r < 10; r++) for (let c = 0; c < 4; c++) if (!draft.some((x) => x.c === c && x.r === r)) return { c, r };
  return { c: 0, r: 9 };
}
const newId = () => { let n = 1; while (draft.some((c) => c.id === `btn${n}`)) n++; return `btn${n}`; };

function editorEvent(e) {
  if (!draft) return;
  const row = e.target.closest('.mrow');
  if (row) {
    const c = draft[Number(row.dataset.i)];
    if (!c) return;
    if (e.type === 'click') {
      // a click only ever removes a row. Clicking a field or opening a dropdown must not touch the data
      // (it used to reset the button's kind and code as soon as the "Kind" dropdown was clicked).
      if (e.target.matches('.m-del')) { draft.splice(Number(row.dataset.i), 1); renderMouseEditor(); }
      return;
    }
    if (e.target.matches('.m-label')) c.label = e.target.value;
    else if (e.target.matches('.m-c')) c.c = Math.max(0, Math.min(7, Number(e.target.value) | 0));
    else if (e.target.matches('.m-r')) c.r = Math.max(0, Math.min(9, Number(e.target.value) | 0));
    else if (e.target.matches('.m-kind') && e.type === 'change') {
      const kind = c.mouse != null ? 'mouse' : c.key != null ? 'key' : 'none';
      if (e.target.value === kind) return;                       // nothing changed: keep the chosen button / key
      delete c.mouse; delete c.key;
      if (e.target.value === 'key') c.key = 23; else if (e.target.value === 'mouse') c.mouse = 0;
      renderMouseEditor();
    }
    else if (e.target.matches('.m-code')) { const v = Number(e.target.value); if (c.key != null) c.key = v; else c.mouse = v; }
    markDraft();
    return;
  }
  if (e.type !== 'change' && e.type !== 'click') return;
  if (e.target.id === 'mAdd') { draft.push({ id: newId(), label: 'Button', mouse: 3, ...nextFree() }); renderMouseEditor(); }
  else if (e.target.id === 'mRevert') { draft = newDraft(); renderMouseEditor(); }
  else if (e.target.id === 'mSave') saveMouse();
  else if (e.target.id === 'ghubAdd' && e.target.value) {
    const s = S.g502.ghubSlots.find((x) => x.slot === e.target.value);
    const cell = { id: `g-${s.slot}`, label: s.slot.toUpperCase(), ...nextFree() };
    if (s.mouse != null) cell.mouse = s.mouse; else cell.key = s.key;
    draft.push(cell); renderMouseEditor();
  }
}

/** Store the edited layout. Returns whether it was saved; if not, the editor keeps your changes and says why. */
async function saveMouse() {
  if (!(await post('/api/mouse-layout', { cells: draft }, 'save the mouse layout'))) { markDraft(clientWarn); return false; }
  draft = null;
  await load();          // (while Settings is open, load() starts a fresh working copy from what was just saved)
  markDraft('Saved.');
  return true;
}

// ---------------------------------------------------------------- sidebars
function inputChip(inp) {
  if (inp.kind === 'joy' && S.azeron) {
    const k = Object.values(S.azeron.keys).find((x) => x.joyCode === inp.code);
    if (k) return `<span class="chip az" title="Azeron key #${esc(k.id)}">AZ #${esc(k.id)}</span>`;
    return `<span class="chip warn" title="No Azeron key sends this button">JOY${esc(inp.code)}</span>`;
  }
  if (inp.kind === 'mouse') {
    const g = S.g502.cells.find((c) => c.mouse === inp.code);
    // no such button on the mouse panel, but an Azeron key is set to send it
    const az = !g && S.azeron && Object.values(S.azeron.keys).find((k) => (k.kind === 'mouse' && k.mouse === inp.code) || (k.kind === 'wheel' && inp.code === (k.wheel === 'up' ? 5 : 6)));
    if (az) return `<span class="chip az" title="Azeron key #${esc(az.id)} sends ${esc(inp.text)}">AZ #${esc(az.id)}</span>`;
    return `<span class="chip ms" title="${g ? 'Mouse: ' + esc(g.label) : 'mouse button'}">${esc(inp.text)}</span>`;
  }
  if (inp.kind === 'key') {
    const az = S.azeron && Object.values(S.azeron.keys).find((k) => k.kind === 'key' && k.key.code === inp.code && !k.key.mods.length);
    if (az) return `<span class="chip az" title="Azeron key #${esc(az.id)} sends ${esc(inp.text)}">AZ #${esc(az.id)}</span>`;
    const g = S.g502.cells.find((c) => c.key === inp.code);
    if (g) return `<span class="chip ms" title="Mouse ${esc(g.label)} sends this key">${esc(inp.text)}</span>`;
  }
  return `<span class="chip kb">${esc(inp.text)}</span>`;
}
/** Bind editing is an option (Settings > Bind editing), off unless the user switched it on. While it is off nothing that
 *  edits binds is shown: no bind menu, no "Bind order", no edits bar, and the saved edits are not applied to the view. */
const editing = () => S?.edits?.enabled === true;
const bindChips = (item) => [
  // (each bind is its own click target: clicking it opens the bind editor on that bind)
  ...item.binds.map((b, i) => `<span class="bind"${editing() ? ` data-bind="${i}" title="Click to edit this bind"` : ''}>${b.inputs.map(inputChip).join('<span class="sub">+</span>')}</span>`),
  ...item.axisAssign.map((a) => `<span class="chip ${a.dev}">${esc(a.text)}</span>`),
].join('<span class="sub"> / </span>');
const isBound = (it) => it.binds.length > 0 || it.axisAssign.length > 0;

function groupBySection(items) {
  const groups = new Map();
  for (const it of items) {
    const key = `${TAB_NAME[it.tab]}${it.sub && it.tab !== 'common' && it.sub !== TAB_NAME[it.tab] ? ' · ' + it.sub : ''} – ${it.section || 'General'}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(it);
  }
  return groups;
}

// Sidebar sections the user opened or closed by hand ("bound|Ground – Movement" -> true/false). Every render rebuilds the
// lists, so without this a click on a key would put each section back to its default.
const sectionOpen = new Map();
/** One collapsible sidebar section. `forceOpen` (a filter is typed) wins; then the user's own choice; then the default. */
const det = (key, dfltOpen, summary, body, { cls = '', forceOpen = false } = {}) =>
  `<details${cls ? ` class="${cls}"` : ''} data-k="${esc(key)}"${forceOpen || (sectionOpen.get(key) ?? dfltOpen) ? ' open' : ''}><summary>${summary}</summary>${body}</details>`;

function renderSides() {
  const q = $('filter').value.trim().toLowerCase();
  const set = S.items.filter(inSet);
  const match = (it) => !q || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) || it.binds.some((b) => b.text.toLowerCase().includes(q));
  const bound = set.filter((it) => isBound(it) && match(it));
  const missingAll = set.filter((it) => inCore(it) && !isBound(it) && match(it));   // "missing" only concerns this layer, not the ones shown through
  const essential = missingAll.filter((it) => !it.optional);
  const optional = missingAll.filter((it) => it.optional);
  $('boundCount').textContent = `(${set.filter(isBound).length}/${set.length})`;
  $('missCount').textContent = `(${essential.length} essential, ${optional.length} optional)`;

  const edMark = '<i class="ed-dot" title="Edited here: not in the game until you import the file"></i>';
  const rowHtml = (it, dim) => `<div class="row${hlItem === it.id ? ' hl' : ''}${it.axis || !editing() ? '' : ' can-edit'}" data-item="${esc(it.id)}"><span class="nm">${it.edited ? edMark : ''}${esc(it.name)}</span><span class="keys">${dim ? (it.explicitUnbind ? '<span class="chip warn">unbound</span>' : '') : bindChips(it)}</span></div>`;
  const list = (items, dim, scope) => !items.length ? '<div class="note">Nothing here.</div>'
    : [...groupBySection(items)].map(([k, v]) => det(`${scope}|${k}`, v.length < 12, `${esc(k)} <span class="count">(${v.length})</span>`, v.map((it) => rowHtml(it, dim)).join(''), { forceOpen: !!q })).join('');
  $('boundList').innerHTML = list(bound, false, 'bound');
  const optBlock = optional.length && !ui.hideOptional
    ? det('miss|optional', false, `Optional &ndash; the game doesn't warn if these are unbound (${optional.length})`, list(optional, true, 'opt'), { cls: 'opt', forceOpen: !!q }) : '';
  $('missList').innerHTML = (essential.length ? list(essential, true, 'miss') : '<div class="note">Every essential action is bound.</div>') + optBlock;
}

function renderAttention(cards) {
  const out = [];
  const idle = (c) => !c.entries.length && !c.modEntries.length;
  // (a key that turns the wheel is never "dead": like the mouse's own wheel, it may be in use as an axis)
  const deadAz = cards.az.filter((c) => (c.k.kind === 'joy' || c.k.kind === 'dir' || c.k.kind === 'mouse' || (c.k.kind === 'key' && c.k.key.code != null)) && idle(c));
  if (deadAz.length) out.push(det('attn|az', true, `Azeron keys with nothing bound in game (${deadAz.length})`, deadAz.map((c) => `<div class="row focus" data-focus="az:${esc(c.key)}" title="Click to highlight this key"><span class="nm">#${esc(c.k.id)} ${esc(labelFor('az', c.key, c)?.text ?? '')}</span><span class="keys"><span class="chip warn">${esc(c.k.ident)}</span></span></div>`).join('')));
  // wheel up/down (WT mouse 5/6) aren't real buttons: a wheel used as an axis (or merged card) is never "unbound"
  const deadMs = cards.ms.filter((c) => !c.merged && c.cell.mouse !== 5 && c.cell.mouse !== 6 && (c.cell.mouse != null || c.cell.key != null) && idle(c));
  if (deadMs.length) out.push(det('attn|ms', true, `Mouse buttons with nothing bound (${deadMs.length})`, deadMs.map((c) => `<div class="row focus" data-focus="ms:${esc(c.key)}" title="Click to highlight this button"><span class="nm">${esc(c.cell.label)}</span><span class="keys"><span class="chip warn">${esc(c.k.ident)}</span></span></div>`).join('')));

  if (S.azeron) {
    const sent = new Set(Object.values(S.azeron.keys).map((k) => k.joyCode).filter((c) => c != null));
    const dev = S.azeron.device;
    const orphans = new Map();
    for (const it of S.items) if (inSet(it)) for (const b of it.binds) for (const i of b.inputs) {
      if (i.kind === 'joy' && !sent.has(i.code) && dev && i.code >= dev.buttonsOffset && i.code < dev.buttonsOffset + dev.buttonsCount) (orphans.get(i.code) ?? orphans.set(i.code, []).get(i.code)).push(it.name);
    }
    if (orphans.size) out.push(det('attn|orphans', true, `Bound to an Azeron button no key sends (${orphans.size})`, [...orphans].map(([c, n]) => `<div class="row"><span class="nm">${esc(uniq(n).join(', '))}</span><span class="keys"><span class="chip warn">JOY${esc(c - dev.buttonsOffset + 1)}</span></span></div>`).join('')));
  }

  const seen = new Map();
  for (const it of S.items.filter(inSet)) for (const b of it.binds) {
    const k = b.inputs.map((i) => `${i.kind}:${i.code}`).join('+');
    (seen.get(k) ?? seen.set(k, []).get(k)).push({ it, b });
  }
  const conflicts = new Map();
  for (const [, list] of seen) {
    const groups = new Map();
    for (const e of list) { const g = e.it.sub ?? 'common'; (groups.get(g) ?? groups.set(g, []).get(g)).push(e); }
    const commons = groups.get('common') ?? [];
    for (const [sub, es] of groups) {
      const names = uniq((sub === 'common' ? es : [...es, ...commons]).map((e) => e.it.name));
      if (names.length > 1) conflicts.set(list[0].b.text + '|' + names.slice().sort().join(), { text: list[0].b.text, names, sigs: list[0].b.inputs.map((i) => `${i.kind}:${i.code}`) });
    }
  }
  if (conflicts.size) out.push(det('attn|conflicts', false, `Same input, several actions (${conflicts.size})`, `<div class="note">Often intentional (different weapons/modes). Shown so you can spot accidents.</div>${[...conflicts.values()].map((c) => `<div class="row focus" data-sigs="${esc(c.sigs.join(','))}" title="Click to highlight the key(s) on your devices"><span class="nm">${c.names.map(esc).join(' / ')}</span><span class="keys"><span class="chip">${esc(c.text)}</span></span></div>`).join('')}`));
  $('attnCount').textContent = out.length ? '' : '(none)';
  $('attn').innerHTML = out.join('') || '<div class="note">Everything set up on your devices is bound in game.</div>';
}

// ---------------------------------------------------------------- bind editor
// Clicking an action (or one of its binds) in a side list opens a small floating menu to reorder, change, add or remove its
// binds. Edits are saved by the server (edits.json) and shown everywhere as a preview; the game gets them when the user saves
// a controls file here and imports it in game. Nothing the game owns is written.
const DEV_NAME = { kb: 'Keyboard', ms: 'Mouse', az: 'Azeron', joy: 'Other joystick' };
const DEV_ALL = ['kb', 'ms', 'az', 'joy'];
const maxBinds = () => S?.edits?.maxBinds ?? 3;   // the game's Controls menu keeps three binds per action
const maxChord = () => S?.edits?.maxChord ?? 3;
const sigOf = (i) => `${i.kind}:${i.code}`;
const sameChord = (a, b) => a.length === b.length && a.map(sigOf).sort().join() === b.map(sigOf).sort().join();   // held together: the order makes no difference in game
const MOUSE_TEXT = ['LMB', 'RMB', 'MMB', 'Mouse4', 'Mouse5', 'Mouse6 (wheel up)', 'Mouse7 (wheel down)', 'Mouse8'];
const withText = (i) => (i.text ? i : { ...i, text: i.kind === 'key' ? keyNameOf(i.code) : i.kind === 'mouse' ? MOUSE_TEXT[i.code] ?? `Mouse${i.code + 1}` : `JOY${i.code}` });
const chordHtml = (inputs) => inputs.map((i) => inputChip(withText(i))).join('<span class="sub">+</span>');
const plainBinds = (binds) => binds.map((b) => b.inputs.map((i) => ({ kind: i.kind, code: i.code })));

let bindMenu = null;     // the open editor: { id, sel, side, x, y, moved, cap, focus }.  cap = { target: index | 'new', inputs, down, joy, fresh }
let capListeners = null; // window listeners while a bind is being captured
let exportDone = null;   // { file, dir, settings } of the file saved last, shown in the edits bar until dismissed
let orderScope = 'view';

/** Which device an input belongs to, the same way the chips are coloured: an Azeron key that sends a keyboard key or a mouse
 *  button counts as the Azeron. */
function inputDev(inp) {
  const az = Object.values(S.azeron?.keys ?? {});
  if (inp.kind === 'joy') {
    const d = S.azeron?.device;
    return az.some((k) => k.joyCode === inp.code) || (d && inp.code >= d.buttonsOffset && inp.code < d.buttonsOffset + d.buttonsCount) ? 'az' : 'joy';
  }
  if (inp.kind === 'mouse') {
    if (S.g502.cells.some((c) => c.mouse === inp.code)) return 'ms';
    return az.some((k) => (k.kind === 'mouse' && k.mouse === inp.code) || (k.kind === 'wheel' && inp.code === (k.wheel === 'up' ? 5 : 6))) ? 'az' : 'ms';
  }
  if (az.some((k) => k.kind === 'key' && k.key.code === inp.code && !k.key.mods.length)) return 'az';
  return S.g502.cells.some((c) => c.key === inp.code) ? 'ms' : 'kb';
}
/** The device of a whole bind: an Azeron key that sends exactly this chord makes it the Azeron's; otherwise the device of
 *  the last input (the one pressed while the others are held). */
function bindDev(b) {
  const sig = b.inputs.map(sigOf).join('+');
  const chordKey = Object.values(S.azeron?.keys ?? {}).some((k) => k.kind === 'key' && k.key.code != null && k.key.mods.length
    && [...k.key.mods, k.key.code].map((c) => `key:${c}`).join('+') === sig);
  return chordKey ? 'az' : inputDev(b.inputs[b.inputs.length - 1]);
}
/** Binds sorted by the device order chosen in "Bind order"; binds of the same device keep their order. */
function orderByDevice(binds) {
  const rank = (b) => { const r = ui.devOrder.indexOf(bindDev(b)); return r < 0 ? DEV_ALL.length : r; };
  return binds.map((b, i) => [b, i]).sort((p, q) => rank(p[0]) - rank(q[0]) || p[1] - q[1]).map(([b]) => b);
}
/** Could these binds be saved as an edit? (The server refuses more binds than the game keeps, an over-long chord and repeats;
 *  a controls file edited by hand can hold such an action. It is then left as it is by the bulk reorder.) */
const savable = (binds) => binds.length <= maxBinds() && binds.every((b, i) => b.inputs.length >= 1 && b.inputs.length <= maxChord()
  && new Set(b.inputs.map(sigOf)).size === b.inputs.length && !binds.some((o, j) => j < i && sameChord(o.inputs, b.inputs)));
/** { actionId: binds } for every action in `items` whose binds are not in device order yet. */
function deviceOrderChanges(items) {
  const out = {};
  for (const it of items) {
    if (it.axis || it.binds.length < 2 || out[it.id] || !savable(it.binds)) continue;
    const next = orderByDevice(it.binds);
    if (next.some((b, i) => b !== it.binds[i])) out[it.id] = plainBinds(next);
  }
  return out;
}
const orderItems = () => (orderScope === 'all' ? S.items : S.items.filter(inSet));

/** Save edits ({ set: { id: binds | null } } or { clear: true }) and show the result. */
async function sendEdits(body, what) {
  const ok = await post('/api/edits', body, what);
  await load();
  return ok;
}
const saveBinds = (id, binds) => sendEdits({ set: { [id]: binds } }, 'save the bind');

/** Other actions that already use this exact chord, most relevant first (same layer / Common, then the rest). */
function chordUses(inputs, selfId) {
  const hits = [];
  for (const it of S.items) {
    if (it.id === selfId || it.axis || !it.binds.some((b) => sameChord(b.inputs, inputs))) continue;
    hits.push({ text: `${it.name} (${TAB_NAME[it.tab] ?? it.tab})`, near: inCore(it) });
  }
  return uniq(hits.sort((a, b) => Number(b.near) - Number(a.near)).map((h) => h.text));
}

function openBindMenu(id, sel, row) {
  const it = S.items.find((x) => x.id === id);
  if (!it || it.axis) return false;        // an axis is assigned in game: nothing to edit here
  stopCapture();
  const side = row.closest('#right') ? 'right' : 'left';
  const host = row.closest('.side').getBoundingClientRect();
  bindMenu = { id, sel, side, x: side === 'left' ? host.right + 8 : host.left - 8, y: row.getBoundingClientRect().top - 56, moved: false, cap: null };
  return true;
}
function closeBindMenu() {
  stopCapture();
  bindMenu = null;
  $('bindMenu').hidden = true;
}
function placeBindMenu() {
  const el = $('bindMenu');
  if (!bindMenu || el.hidden) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  const x = bindMenu.side === 'right' && !bindMenu.moved ? bindMenu.x - w : bindMenu.x;
  el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(bindMenu.y, window.innerHeight - h - 8))}px`;
}

function captureHtml(it, cap) {
  const title = cap.target === 'new' ? `New bind (position ${it.binds.length + 1})` : `Change bind ${cap.target + 1}`;
  const keys = cap.inputs.map((inp, i) => `<button class="bm-capkey" data-bm="capdel" data-i="${i}" title="Take this input out of the bind">${inputChip(withText(inp))}<span aria-hidden="true"> &times;</span></button>`).join('<span class="sub">+</span>');
  const dup = cap.inputs.length > 0 && it.binds.some((b, i) => i !== cap.target && sameChord(b.inputs, cap.inputs));
  const uses = cap.inputs.length ? chordUses(cap.inputs, it.id) : [];
  const full = cap.inputs.length >= maxChord();
  return `<div class="bm-cap">
    <div class="bm-captitle">${esc(title)}</div>
    <div class="bm-capkeys" aria-live="polite">${keys || '<span class="dim">Waiting for input...</span>'}</div>
    <div class="dim bm-help">Press the keys, mouse buttons or Azeron keys together, anywhere outside this box: hold the modifier first, then the key.
      Or click keys on the device panels to add them one at a time. A bind holds up to ${maxChord()} inputs${full ? ' (this one is full)' : ''}. Pressing again starts over.</div>
    ${dup ? '<div class="bm-warn">This action already has that bind.</div>' : ''}
    ${cap.inputs.some((i) => i.kind === 'mouse' && (i.code === 5 || i.code === 6)) ? '<div class="bm-warn">The wheel as a button (mouse buttons 6 / 7) is this app&#39;s reading of the game&#39;s files, not confirmed: check this bind in game after importing.</div>' : ''}
    ${uses.length ? `<div class="bm-warn">Also bound to: ${esc(uses.slice(0, 5).join(', '))}${uses.length > 5 ? ` and ${uses.length - 5} more` : ''}</div>` : ''}
    <div class="bm-tools"><button data-bm="capok"${cap.inputs.length && !dup ? '' : ' disabled'} class="bm-primary">Use this</button><button data-bm="capclear"${cap.inputs.length ? '' : ' disabled'}>Clear</button><button data-bm="capcancel">Cancel</button></div>
  </div>`;
}

function renderBindMenu() {
  const el = $('bindMenu');
  const it = bindMenu && S ? S.items.find((x) => x.id === bindMenu.id && !x.axis) : null;
  if (!it || ui.overlayMode || !editing()) { if (bindMenu) closeBindMenu(); el.hidden = true; return; }   // (the overlay is for looking, not editing)
  const cap = bindMenu.cap;
  const n = it.binds.length;
  if (bindMenu.sel != null && bindMenu.sel >= n) bindMenu.sel = null;
  if (cap && cap.target !== 'new' && cap.target >= n) { stopCapture(); return renderBindMenu(); }
  const where = [TAB_NAME[it.tab], it.section].filter(Boolean).join(' · ');
  const from = it.edited ? 'edited here, not in the game yet'
    : !n ? (it.explicitUnbind ? 'unbound on purpose in your controls file' : 'nothing bound')
      : it.origin === '(your config)' ? 'from your controls file' : it.origin ? `default of the ${it.origin} preset` : '';
  const rows = it.binds.map((b, i) => `<li class="bm-row${bindMenu.sel === i ? ' sel' : ''}${cap && cap.target === i ? ' cap' : ''}">
      <span class="bm-n">${i + 1}</span>
      <span class="bm-keys">${chordHtml(b.inputs)}</span>
      <span class="bm-dev">${DEV_NAME[bindDev(b)]}</span>
      <span class="bm-act">
        <button class="mini" data-bm="up" data-i="${i}"${i === 0 ? ' disabled' : ''} title="Move this bind one position up" aria-label="Move bind ${i + 1} up">&uarr;</button>
        <button class="mini" data-bm="down" data-i="${i}"${i === n - 1 ? ' disabled' : ''} title="Move this bind one position down" aria-label="Move bind ${i + 1} down">&darr;</button>
        <button class="mini" data-bm="change" data-i="${i}" title="Set another key or chord for this bind">Change</button>
        <button class="mini" data-bm="remove" data-i="${i}" title="Remove this bind">Remove</button>
      </span></li>`).join('');
  const sorted = orderByDevice(it.binds);
  const canOrder = sorted.some((b, i) => b !== it.binds[i]);
  const order = ui.devOrder.map((d) => DEV_NAME[d]).join(', ');
  el.innerHTML = `
    <div class="bm-head" id="bmHead" title="Drag to move this box"><strong>${esc(it.name)}</strong><button class="mini" data-bm="close" aria-label="Close the bind editor">Close</button></div>
    <div class="dim bm-sub">${esc(where)}${from ? ` &ndash; ${esc(from)}` : ''}</div>
    ${n ? `<ol class="bm-list">${rows}</ol>` : '<div class="note">Nothing is bound to this action.</div>'}
    ${savable(it.binds) ? '' : `<div class="bm-warn">Your controls file holds ${n > maxBinds() ? `more than ${maxBinds()} binds` : 'the same bind twice'} for this action. Remove the extra one first: other changes are refused until then.</div>`}
    ${cap ? captureHtml(it, cap) : `<div class="bm-tools">
      <button data-bm="add"${n >= maxBinds() ? ` disabled title="The game keeps ${maxBinds()} binds per action"` : ''}>Add bind</button>
      <button data-bm="devorder"${canOrder ? '' : ' disabled'} title="Sort this action's binds: ${esc(order)} (change the order under Bind order, in the top bar)">Order by device</button>
      <button data-bm="unbind"${n ? '' : ' disabled'} title="Remove every bind of this action">Unbind</button>
      <button data-bm="reset"${it.edited ? '' : ' disabled'} title="Drop your edit of this action">Reset to file</button>
    </div>`}
    ${it.edited ? `<div class="dim bm-sub">In your controls file now: ${it.fileBinds.length ? it.fileBinds.map((b) => chordHtml(b.inputs)).join('<span class="sub"> / </span>') : 'nothing bound'}</div>` : ''}
    <div class="dim bm-help">The binds are saved in this order, and the game loads them in the order they are in the file. Changes are a preview until you save a file and import it in game.</div>`;
  el.hidden = false;
  placeBindMenu();
  if (bindMenu.focus) { el.querySelector(`[data-bm="${bindMenu.focus.bm}"][data-i="${bindMenu.focus.i}"]:not(:disabled)`)?.focus(); bindMenu.focus = null; }
}

// ---- capturing a bind: real key / mouse / Azeron presses, or clicks on the device panels ----
// e.code -> DirectInput scancode (what War Thunder stores). The physical key decides, not the keyboard language.
const CODE_DIK = { Escape: 1, Minus: 12, Equal: 13, Backspace: 14, Tab: 15, BracketLeft: 26, BracketRight: 27, Enter: 28, ControlLeft: 29, Semicolon: 39, Quote: 40,
  Backquote: 41, ShiftLeft: 42, Backslash: 43, Comma: 51, Period: 52, Slash: 53, ShiftRight: 54, NumpadMultiply: 55, AltLeft: 56, Space: 57, CapsLock: 58, NumLock: 69,
  ScrollLock: 70, Numpad7: 71, Numpad8: 72, Numpad9: 73, NumpadSubtract: 74, Numpad4: 75, Numpad5: 76, Numpad6: 77, NumpadAdd: 78, Numpad1: 79, Numpad2: 80, Numpad3: 81,
  Numpad0: 82, NumpadDecimal: 83, IntlBackslash: 86, F11: 87, F12: 88, F13: 100, F14: 101, F15: 102, NumpadEnter: 156, ControlRight: 157, NumpadDivide: 181, PrintScreen: 183,
  AltRight: 184, Pause: 197, Home: 199, ArrowUp: 200, PageUp: 201, ArrowLeft: 203, ArrowRight: 205, End: 207, ArrowDown: 208, PageDown: 209, Insert: 210, Delete: 211,
  MetaLeft: 219, MetaRight: 220, ContextMenu: 221 };
'1234567890'.split('').forEach((c, i) => { CODE_DIK[`Digit${c}`] = 2 + i; });
'QWERTYUIOP'.split('').forEach((c, i) => { CODE_DIK[`Key${c}`] = 16 + i; });
'ASDFGHJKL'.split('').forEach((c, i) => { CODE_DIK[`Key${c}`] = 30 + i; });
'ZXCVBNM'.split('').forEach((c, i) => { CODE_DIK[`Key${c}`] = 44 + i; });
for (let i = 1; i <= 10; i++) CODE_DIK[`F${i}`] = 58 + i;
const BUTTON_WT = { 0: 0, 2: 1, 1: 2, 3: 3, 4: 4 };   // browser mouse button -> War Thunder mouseButton (left, right, middle, back, forward)

/** A press while capturing. `held`: modifiers the event says are down although their own key press was never seen. */
function capPress(inp, held = []) {
  const cap = bindMenu?.cap;
  if (!cap) return;
  if (cap.fresh && !cap.down.size) cap.inputs = [];   // everything was let go, then a new press: start over
  cap.fresh = true;
  cap.down.add(sigOf(inp));
  for (const i of [...held, inp]) if (!cap.inputs.some((x) => sigOf(x) === sigOf(i)) && cap.inputs.length < maxChord()) cap.inputs.push(i);
  renderBindMenu();
}
// Ctrl / Alt / Shift: the event flag and the DirectInput codes of the left and right key
const MOD_KEYS = [['ctrlKey', 29, 157], ['altKey', 56, 184], ['shiftKey', 42, 54]];
/** Modifiers a key event reports as held whose own press this capture did not see (held before it started, or sent by a
 *  device or tool that only sets the flag). Which side is unknown then, so the left key is taken. */
function unseenMods(e, code) {
  const cap = bindMenu?.cap;
  if (!cap || MOD_KEYS.some(([, l, r]) => code === l || code === r)) return [];
  const has = (c) => cap.down.has(`key:${c}`);
  return MOD_KEYS.filter(([flag, l, r]) => e[flag] && !has(l) && !has(r)).map(([, l]) => ({ kind: 'key', code: l }));
}
const capRelease = (inp) => bindMenu?.cap?.down.delete(sigOf(inp));
/** Azeron joystick buttons, from the live input helper (the first 32; the rest can be clicked on the Azeron panel). */
function capJoy() {
  const cap = bindMenu?.cap;
  if (!cap || !S.azeron?.device) return;
  const now = live.joy | 0, was = cap.joy | 0;
  cap.joy = now;
  for (let n = 0; n < 32; n++) {
    const is = (now >>> n) & 1, had = (was >>> n) & 1;
    if (is && !had) capPress({ kind: 'joy', code: S.azeron.offset + n });
    else if (!is && had) capRelease({ kind: 'joy', code: S.azeron.offset + n });
  }
}
/** A click on a device card while capturing: its input(s) join the bind (again: they leave it). */
function capAddCard(el) {
  const cap = bindMenu?.cap;
  if (!cap) return;
  const c = deviceCards()[el.dataset.dev]?.find((x) => String(x.key) === el.dataset.key);
  if (!c?.sig) return;                                  // a key that sends nothing the game can bind
  const inputs = c.sig.split('+').map((s) => { const [kind, code] = s.split(':'); return { kind, code: Number(code) }; });
  const has = (i) => cap.inputs.some((x) => sigOf(x) === sigOf(i));
  if (inputs.every(has)) cap.inputs = cap.inputs.filter((x) => !inputs.some((i) => sigOf(i) === sigOf(x)));
  else for (const i of inputs) if (!has(i) && cap.inputs.length < maxChord()) cap.inputs.push(i);
  cap.fresh = false;                                    // built by hand: the next real key press adds to it
  renderBindMenu();
}
function startCapture(target) {
  stopCapture();
  bindMenu.cap = { target, inputs: [], down: new Set(), joy: live.joy | 0, fresh: false };
  // clicks in the editor itself and on the title bar work as usual; a click on a device card adds that key (see the click handler)
  const own = (e) => !!e.target.closest?.('#bindMenu, .titlebar');
  const card = (e) => !!e.target.closest?.('.card[data-dev]');
  const eat = (e) => { e.preventDefault(); e.stopPropagation(); };
  const on = {
    keydown: (e) => { eat(e); const code = CODE_DIK[e.code]; if (!e.repeat && code) capPress({ kind: 'key', code }, unseenMods(e, code)); },
    keyup: (e) => {
      eat(e);
      const code = CODE_DIK[e.code];
      if (!code) return;
      if (e.code === 'PrintScreen' && !bindMenu?.cap?.down.has(`key:${code}`)) capPress({ kind: 'key', code });   // Windows reports PrtSc only when it is let go
      capRelease({ kind: 'key', code });
    },
    mousedown: (e) => { if (own(e) || card(e)) return; eat(e); if (BUTTON_WT[e.button] != null) capPress({ kind: 'mouse', code: BUTTON_WT[e.button] }); },
    mouseup: (e) => { if (own(e) || card(e)) return; eat(e); if (BUTTON_WT[e.button] != null) capRelease({ kind: 'mouse', code: BUTTON_WT[e.button] }); },
    click: (e) => { if (!own(e) && !card(e)) eat(e); },
    dblclick: (e) => { if (!own(e)) eat(e); },
    auxclick: (e) => { if (!own(e)) eat(e); },          // middle / back / forward: no autoscroll, no page navigation
    contextmenu: (e) => { if (!own(e)) eat(e); },
    wheel: (e) => {
      if (own(e)) return;
      eat(e);
      if (!e.deltaY) return;
      const inp = { kind: 'mouse', code: e.deltaY < 0 ? 5 : 6 };   // wheel up / down are the game's mouse buttons 6 / 7
      capPress(inp); capRelease(inp);
    },
  };
  for (const [type, fn] of Object.entries(on)) window.addEventListener(type, fn, { capture: true, passive: false });
  capListeners = on;
}
function stopCapture() {
  if (capListeners) for (const [type, fn] of Object.entries(capListeners)) window.removeEventListener(type, fn, { capture: true });
  capListeners = null;
  if (bindMenu) bindMenu.cap = null;
}

$('bindMenu').addEventListener('click', (e) => {
  e.stopPropagation();
  const b = e.target.closest('[data-bm]');
  const it = bindMenu && S.items.find((x) => x.id === bindMenu.id);
  if (!b || b.disabled || !it) return;
  const i = Number(b.dataset.i);
  const binds = plainBinds(it.binds);
  const cap = bindMenu.cap;
  switch (b.dataset.bm) {
    case 'close': closeBindMenu(); hlItem = null; render(); return;
    case 'up': case 'down': {
      const to = b.dataset.bm === 'up' ? i - 1 : i + 1;
      if (to < 0 || to >= binds.length) return;
      [binds[i], binds[to]] = [binds[to], binds[i]];
      stopCapture();
      bindMenu.sel = to; bindMenu.focus = { bm: b.dataset.bm, i: to };
      saveBinds(it.id, binds); return;
    }
    case 'remove': stopCapture(); binds.splice(i, 1); bindMenu.sel = null; saveBinds(it.id, binds); return;
    case 'change': bindMenu.sel = i; startCapture(i); renderBindMenu(); return;
    case 'add': bindMenu.sel = null; startCapture('new'); renderBindMenu(); return;
    case 'unbind': bindMenu.sel = null; saveBinds(it.id, []); return;
    case 'reset': bindMenu.sel = null; saveBinds(it.id, null); return;
    case 'devorder': bindMenu.sel = null; saveBinds(it.id, plainBinds(orderByDevice(it.binds))); return;
    case 'capdel': cap?.inputs.splice(i, 1); if (cap) cap.fresh = false; renderBindMenu(); return;
    case 'capclear': if (cap) { cap.inputs = []; cap.down.clear(); cap.fresh = false; } renderBindMenu(); return;
    case 'capcancel': stopCapture(); renderBindMenu(); return;
    case 'capok': {
      if (!cap?.inputs.length) return;
      const inputs = cap.inputs.map((x) => ({ kind: x.kind, code: x.code }));
      if (cap.target === 'new') binds.push(inputs); else binds[cap.target] = inputs;
      bindMenu.sel = cap.target === 'new' ? binds.length - 1 : cap.target;
      stopCapture();
      saveBinds(it.id, binds); return;
    }
    default:
  }
});
// the editor can be dragged by its title, out of the way of the keys you want to click
$('bindMenu').addEventListener('mousedown', (e) => {
  if (!e.target.closest('#bmHead') || e.target.closest('button') || e.button !== 0 || !bindMenu) return;
  e.preventDefault();
  const el = $('bindMenu');
  const dx = e.clientX - el.offsetLeft, dy = e.clientY - el.offsetTop;
  const move = (ev) => { if (!bindMenu) return; bindMenu.x = ev.clientX - dx; bindMenu.y = ev.clientY - dy; bindMenu.moved = true; placeBindMenu(); };
  const up = () => { window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true); };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
});
window.addEventListener('resize', placeBindMenu);
window.addEventListener('blur', () => bindMenu?.cap?.down.clear());   // keys let go while another window has the focus report no release

// ---- the edits bar: how many actions are edited, and saving the file for the game's import ----
let changesOpen = false;   // the "View changes" list in the edits bar
/** What an edit did to an action, in one word. */
function changeKind(it) {
  if (!it.fileBinds.length) return 'bound';
  if (!it.binds.length) return 'unbound';
  const set = (list) => list.map((b) => b.inputs.map(sigOf).sort().join('+')).sort().join('|');
  return set(it.fileBinds) === set(it.binds) ? 'reordered' : 'changed';
}
/** The list behind "View changes": every edited action, what the controls file says and what it will be. */
function changesHtml() {
  const order = Object.keys(TAB_NAME);
  const list = S.items.filter((it) => it.edited).sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab) || a.name.localeCompare(b.name));
  const side = (binds) => (binds.length ? binds.map((b) => `<span class="chg-bind">${chordHtml(b.inputs)}</span>`).join('<span class="sub">/</span>') : '<span class="dim">not bound</span>');
  return `<div class="pop-note">In your controls file now &rarr; after the import. Click a row to open that action; Undo drops its edit.</div>` + list.map((it) =>
    `<div class="chg-row" data-chg="${esc(it.id)}" title="Show this action and open its binds">
      <span class="chg-name">${esc(it.name)} <span class="sub">${esc(TAB_NAME[it.tab] ?? it.tab)}</span></span>
      <span class="chg-kind ${changeKind(it)}">${changeKind(it)}</span>
      <span class="chg-binds">${side(it.fileBinds)}<span class="chg-arrow" aria-label="becomes">&rarr;</span>${side(it.binds)}</span>
      <button class="mini" data-chg-undo="${esc(it.id)}" title="Drop the edit of this action">Undo</button>
    </div>`).join('');
}
/** Bring an action into view (its layer, its row in a side list) and open the bind editor on it. */
function showAction(id) {
  const it = S.items.find((x) => x.id === id);
  if (!it) return;
  if (!inSet(it)) {   // on another layer: go there
    if (TABS.some(([k]) => k === it.tab)) ui.tab = it.tab;
    else if (it.tab === 'common') ui.common = true;
    else if (it.tab === 'drone') { ui.tab = it.droneFor?.[0] ?? 'ground'; ui.drone = true; }
  }
  if (!ui.overlayMode) { ui.compact = false; ui.showLeft = true; ui.showRight = true; }   // the lists must be on screen
  $('filter').value = '';
  hlItem = id;
  closeBindMenu();
  saveUi(); render();
  const row = [...document.querySelectorAll('.row[data-item]')].find((r) => r.dataset.item === id);
  if (!row) return;                                  // (an optional action while "Hide optional actions" is ticked)
  for (let d = row.closest('details'); d; d = d.parentElement?.closest('details')) { d.open = true; if (d.dataset.k) sectionOpen.set(d.dataset.k, true); }
  row.scrollIntoView({ block: 'center' });
  if (openBindMenu(id, null, row)) renderBindMenu();
}

function renderEditsBar() {
  const n = S.edits?.count ?? 0;
  const bar = $('editsBar');
  if (!editing()) exportDone = null;
  bar.hidden = !editing() || (!n && !exportDone);
  if (!n) changesOpen = false;
  if (bar.hidden) { bar.innerHTML = ''; return; }
  const scroll = $('changesMenu')?.scrollTop ?? 0;   // (the bar is rebuilt on every render: keep the list where it was)
  const d = exportDone;
  const saved = d ? `<div class="edits-msg"><strong>Saved ${esc(d.file)}</strong> in ${esc(d.dir)}. In War Thunder open Controls, press the import button at the bottom left and pick that file.
      ${d.settings === 'none' ? ' The file carries no settings block (no file exported by the game was found in Saves to take its layout from): after importing, check your sensitivity and invert options.' : ''}
      ${n ? ' The edits stay marked here until the game has saved them.' : ''} <button class="mini" id="exportDismiss">Dismiss</button></div>` : '';
  bar.innerHTML = (n ? `<div class="edits-row"><span><strong>${n} action${n === 1 ? '' : 's'} edited.</strong> A preview: the game has ${n === 1 ? 'this change' : 'these changes'} only after you import the file.</span>
      <div class="pop" id="changesPop"><button id="changesBtn" class="pop-btn" aria-haspopup="true" aria-expanded="${changesOpen}" title="List every action you edited: what it is now and what it will be">View changes &#9662;</button>
        <div class="pop-menu chg-menu" id="changesMenu" role="group" aria-label="Edited actions"${changesOpen ? '' : ' hidden'}>${changesOpen ? changesHtml() : ''}</div></div>
      <button id="exportBtn" class="bm-primary" title="Writes a new controls file into the game's Saves folder. Nothing the game owns is changed.">Save file for import</button>
      <button class="mini" id="discardEdits">Discard all</button></div>
      ${S.edits.settings === 'none' ? '<div class="edits-msg">Tip: export your controls once in game (Controls, export button) before saving. With a file exported by the game in the Saves folder, the file saved here can carry the same settings block.</div>' : ''}` : '') + saved;
  if ($('changesMenu')) $('changesMenu').scrollTop = scroll;
}
async function exportEdits() {
  let j = null, msg;
  try {
    const r = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    j = await r.json().catch(() => null);
    if (!r.ok) msg = j?.error ?? `error ${r.status}`;
  } catch { msg = 'the app is not answering'; }
  if (msg) { clientWarn = `Could not save the file: ${msg}`; showWarn(); return; }
  clientWarn = '';
  exportDone = { file: j.file, dir: j.dir, settings: j.settings };
  await load();
}
$('editsBar').addEventListener('click', async (e) => {
  const undo = e.target.closest('[data-chg-undo]');
  const row = e.target.closest('.chg-row');
  if (e.target.closest('#changesBtn')) { changesOpen = !changesOpen; renderEditsBar(); $('changesBtn')?.focus(); }
  else if (undo) { undo.disabled = true; await saveBinds(undo.dataset.chgUndo, null); }   // (the list stays open)
  else if (row) { changesOpen = false; showAction(row.dataset.chg); }
  else if (e.target.id === 'exportBtn') { e.target.disabled = true; await exportEdits(); }
  else if (e.target.id === 'exportDismiss') { exportDone = null; renderEditsBar(); }
  else if (e.target.id === 'discardEdits' && confirm('Discard all bind edits?\n\nThe view goes back to what your controls file says. Files you already saved for import are kept.')) {
    closeBindMenu(); hlItem = null;
    await sendEdits({ clear: true }, 'discard the edits');
  }
});

// ---- "Bind order": one device order for the binds of every action ----
function renderOrderMenu() {
  if (!editing()) { toggleOrderMenu(false); $('orderMenu').innerHTML = ''; return; }
  const n = Object.keys(deviceOrderChanges(orderItems())).length;
  $('orderMenu').innerHTML = `<div class="pop-note">The order an action's binds are listed in, by device. A bind made of several inputs counts as the device of its last one.</div>
    <ol class="ord-list">${ui.devOrder.map((d, i) => `<li><span class="ord-n">${i + 1}</span><span class="ord-name">${DEV_NAME[d]}</span>
      <button class="mini" data-ord="${i}" data-to="${i - 1}"${i === 0 ? ' disabled' : ''} aria-label="Move ${DEV_NAME[d]} up">&uarr;</button>
      <button class="mini" data-ord="${i}" data-to="${i + 1}"${i === ui.devOrder.length - 1 ? ' disabled' : ''} aria-label="Move ${DEV_NAME[d]} down">&darr;</button></li>`).join('')}</ol>
    <label class="ord-scope">Apply to <select id="orderScope"><option value="view"${orderScope === 'view' ? ' selected' : ''}>the layers shown now</option><option value="all"${orderScope === 'all' ? ' selected' : ''}>every layer</option></select></label>
    <button id="orderApply"${n ? '' : ' disabled'}>${n ? `Reorder ${n} action${n === 1 ? '' : 's'}` : 'Everything is in this order'}</button>
    <div class="pop-note">One action at a time: click it in a side list and use "Order by device".</div>`;
}
function toggleOrderMenu(open) {
  const menu = $('orderMenu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('orderBtn').setAttribute('aria-expanded', String(show));
}
$('orderBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerMenu(false); toggleOrderMenu(); });
$('orderMenu').addEventListener('click', async (e) => {
  e.stopPropagation();
  const mv = e.target.closest('[data-ord]');
  if (mv && !mv.disabled) {
    const from = Number(mv.dataset.ord), to = Number(mv.dataset.to);
    [ui.devOrder[from], ui.devOrder[to]] = [ui.devOrder[to], ui.devOrder[from]];
    saveUi(); renderOrderMenu(); renderBindMenu();
    $('orderMenu').querySelector(`[data-ord="${to}"][data-to="${to + (to - from)}"]:not(:disabled)`)?.focus();
  } else if (e.target.id === 'orderApply') {
    const changes = deviceOrderChanges(orderItems());
    if (!Object.keys(changes).length) return;
    e.target.disabled = true;
    await sendEdits({ set: changes }, 'reorder the binds');
  }
});
$('orderMenu').addEventListener('change', (e) => { if (e.target.id === 'orderScope') { orderScope = e.target.value === 'all' ? 'all' : 'view'; renderOrderMenu(); $('orderScope').focus(); } });
document.addEventListener('click', () => toggleOrderMenu(false));
document.addEventListener('click', (e) => { if (changesOpen && !e.target.closest('#changesPop')) { changesOpen = false; renderEditsBar(); } });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || bindMenu?.cap) return;      // while a bind is being captured, Esc is a key like any other
  if (changesOpen) { changesOpen = false; renderEditsBar(); $('changesBtn')?.focus(); }
  else if (!$('orderMenu').hidden) { toggleOrderMenu(false); $('orderBtn').focus(); }
  else if (bindMenu && $('settings').hidden && $('layerMenu').hidden) { closeBindMenu(); hlItem = null; render(); }
});

// ---------------------------------------------------------------- "Also show" layer picker
function renderLayerMenu() {
  const others = TABS.filter(([k]) => k !== ui.tab);
  const on = extras();
  const thr = throughLayers();                       // layers that fill in unbound keys (default: all)
  const skipped = others.filter(([k]) => !on.includes(k) && !thr.includes(k)).length;   // layers switched off for show-through
  $('layerCount').textContent = on.length || skipped ? String(on.length + skipped) : '';
  const desc = [on.length ? `always: ${on.map((t) => SHORT[t]).join(', ')}` : '', skipped ? `not shown through: ${others.filter(([k]) => !on.includes(k) && !thr.includes(k)).map(([k]) => SHORT[k]).join(', ')}` : ''].filter(Boolean).join('; ');
  $('layerBtn').title = desc || 'Choose which other layers show on this one';
  $('layerMenu').innerHTML = `<div class="pop-grid">
      <span class="pop-h"></span><span class="pop-h" title="Always show this layer's keys here (teal), even where a key is already bound">Always</span><span class="pop-h" title="For keys with nothing bound here, show what they do on this layer (dim)">When unbound</span>
      ${others.map(([k, n]) => `<span class="pop-name">${esc(n)}</span>
        <input type="checkbox" data-extra="${k}" aria-label="Always show ${esc(n)}"${on.includes(k) ? ' checked' : ''}>
        <input type="checkbox" data-through="${k}" aria-label="Show ${esc(n)} on keys that are unbound here"${on.includes(k) ? ' disabled checked' : thr.includes(k) ? ' checked' : ''}>`).join('')}
    </div>
    <div class="pop-note">Teal: always shown (and not counted as missing). Dim: only fills in keys with nothing bound on this layer. Untick a layer there to stop it showing through.</div>`
    + ((on.length || skipped) ? '<button class="mini" id="layerClear">Reset</button>' : '');
}
function toggleLayerMenu(open) {
  const menu = $('layerMenu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('layerBtn').setAttribute('aria-expanded', String(show));
}

// ---------------------------------------------------------------- main render
function render() {
  if (!S) return;
  renderLayerMenu();
  $('tabs').innerHTML = TABS.map(([k, n]) => `<button class="tab" role="tab" aria-selected="${ui.tab === k}" data-tab="${k}">${n}</button>`).join('');
  $('overlay').checked = ui.common;
  $('drone').checked = ui.drone;
  $('droneWrap').hidden = !droneAvailable();
  for (const d of DEVS) {
    $(`show${d}`).setAttribute('aria-pressed', String(ui[`show${d}`]));
    document.body.classList.toggle(`no-${d.toLowerCase()}`, !ui[`show${d}`]);
  }
  $('optional').checked = ui.hideOptional;
  document.body.classList.toggle('kb-big', kbBig());
  for (const d of DEVS) {
    // the overlay fits everything to its small window, and a keyboard set to "fit the window" sizes itself
    const fit = d === 'Keyboard' && ui.kbSize === 'fit';
    const scale = ui.overlayMode || fit ? 1 : ui[`size${d}`] / 100;
    const panel = document.querySelector(`.device.${d.toLowerCase()}`);
    panel.style.setProperty('--dscale', scale);
    panel.classList.toggle('scaled-up', scale > 1 && d !== 'Keyboard');   // (the keyboard panel always scrolls sideways when it has to)
    const sel = $(`size${d}`);
    const want = fit ? 'fit' : String(ui[`size${d}`]);
    if (![...sel.options].some((o) => o.value === want)) sel.add(new Option(`${want}%`, want));   // a size typed into ui.json by hand
    sel.value = want;
  }
  $('deviceFlow').value = ui.deviceFlow;
  document.body.classList.toggle('side-scroll', ui.deviceFlow === 'row' && !ui.overlayMode);   // (the overlay is a small fixed window: it always stacks)
  $('compact').setAttribute('aria-pressed', String(ui.compact));
  document.body.classList.toggle('compact', ui.compact);
  document.body.classList.toggle('overlay', !!ui.overlayMode);
  document.body.classList.toggle('editing', editing());   // style.css hides the bind-editing controls without it
  document.body.classList.toggle('no-left', !ui.showLeft);
  document.body.classList.toggle('no-right', !ui.showRight);
  $('overlayChk').checked = !!ui.overlayMode;
  document.body.classList.toggle('setup', !!ui.overlaySetup);
  $('setupBar').hidden = !ui.overlaySetup;
  for (const d of DEVS) {
    $(`setup${d}`).checked = !!ui[`show${d}`];
    $(`overlay${d}`).checked = ui[`overlay${d}`] ?? (d !== 'Keyboard');
  }
  $('overlayOpacity').value = $('setupOpacity').value = ui.overlayOpacity ?? 100;
  $('overlayOpacityText').textContent = `${ui.overlayOpacity ?? 100}%`;
  window.kbHost?.reportOverlay?.(!!ui.overlayMode);   // lets the tray menu show the right check mark
  $('azName').textContent = S.azeron ? `· profile: ${S.azeron.name}` : '';
  $('azName').insertAdjacentHTML('beforeend', ' <span class="live-ind" id="liveInd"></span>');
  const cards = deviceCards();
  renderAzeron(cards.az);
  renderKeyboard(cards.kb);
  renderMouse(cards.ms);
  renderDetail(cards);
  renderMouseEditor();
  renderSides();
  renderAttention(cards);
  renderEditsBar();
  renderOrderMenu();
  renderBindMenu();
  showWarn();
  updateLive();   // the cards and the live indicator were just rebuilt: put the current input state back on them
}

function fillSelectors() {
  $('bindEditing').checked = editing();
  const stored = S.edits?.stored ?? 0;
  $('bindEditingNote').textContent = editing()
    ? 'On. Click an action in a side list to edit its binds; "Bind order" in the top bar sorts binds by device.'
    : `Off: the app only shows your binds.${stored ? ` ${stored} edit${stored === 1 ? '' : 's'} you made earlier ${stored === 1 ? 'is' : 'are'} kept, and hidden until you switch this on again.` : ''}`;
  const src = $('source');
  const cur = S.config.machine === 'auto' ? 'auto' : S.machine;
  src.innerHTML = `<option value="auto">Auto (newest live config)</option>` + S.sources.map((s) => `<option value="${esc(s.path)}">${esc(s.label)}</option>`).join('');
  src.value = [...src.options].some((o) => o.value === cur) ? cur : 'auto';
  const p = $('profile');
  p.innerHTML = (S.azeron?.profiles ?? [S.config.azeronProfile]).map((n) => `<option>${esc(n)}</option>`).join('');
  p.value = S.config.azeronProfile;
  const g = $('ghubProfile');
  g.innerHTML = `<option value="">(none)</option>` + (S.g502.ghubProfiles ?? []).map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
  g.value = S.g502.ghubProfile ?? '';
  const kl = $('kbLayout');
  kl.innerHTML = S.keyboardChoices.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  kl.value = S.layouts.keyboard.id;
  $('kbNote').textContent = S.layouts.keyboard.id === 'vanguard'
    ? 'Corsair Vanguard Pro 96, laid out from a photo: no navigation column, numpad right beside the main block, Right arrow in the numpad’s first column. The G-keys, LCD, dial and Elgato key are left out. Fn and the Windows key are kept visible (Fn sends nothing War Thunder can see).'
    : 'Function keys (F-row) and other keys a smaller board reaches through Fn are not modelled: only the physical keys of the chosen layout are shown.';
  $('dataPaths').innerHTML = [
    `Controls: ${esc(S.machine)}`,
    S.azeron ? `Azeron: ${esc(S.azeron.name)} (joystick buttons start at ${S.azeron.offset})` : 'Azeron: not found',
    `Mouse layout: ${S.g502.isDefault ? 'default (not edited yet)' : 'your saved layout'}`,
    `Settings folder: ${esc(S.dataDir ?? '')}`,
  ].join('<br>');
  if (!cal) $('calMsg').textContent = calText || (S.config.stickCal ? 'Calibrated.' : 'Using the stick’s X/Y axes.');
}

async function load() {
  try {
    const r = await fetch('/api/state');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    S = j; stamp = j.stamp;
    if (!uiFromServer) {                       // first load: the server's saved view settings REPLACE this origin's localStorage copy
      uiFromServer = true;                     // (a stale local copy must never override them, e.g. a leftover overlay flag)
      if (j.ui && Object.keys(j.ui).length) { for (const k of Object.keys(ui)) delete ui[k]; Object.assign(ui, j.ui); uiDefaults(); }
    }
    if (clientWarn.startsWith('Could not load')) clientWarn = '';
    if (!$('settings').hidden && !draft) draft = newDraft();   // Settings is open: its mouse-layout editor needs a working copy
    fillSelectors();
    render();
    startLive();
  } catch (e) {
    clientWarn = `Could not load: ${e.message}`;
    showWarn();
  }
}

async function setConfig(patch) {
  await post('/api/config', patch, 'save the setting');
  await load();   // (an open mouse-layout draft is kept as it is: load() only starts one when there is none)
}

/** Clicking a notification highlights the device key(s) it is about and opens that key's details. */
function focusFromRow(row) {
  const cards = deviceCards();
  const all = [...cards.az, ...cards.kb, ...cards.ms];
  const hit = new Set();
  if (row.dataset.focus) hit.add(row.dataset.focus);
  if (row.dataset.sigs) {
    const want = new Set(row.dataset.sigs.split(','));
    for (const c of all) if (c.sig && c.sig.split('+').some((s) => want.has(s))) hit.add(`${c.dev}:${c.key}`);
  }
  if (!hit.size) {
    $('attnCount').textContent = '(not on your devices)';
    setTimeout(() => renderAttention(deviceCards()), 2500);
    return;
  }
  const same = hit.size === flash.size && [...hit].every((k) => flash.has(k));
  flash = same ? new Set() : hit;
  if (!same) {
    const first = [...hit][0].split(':');
    selected = { dev: first[0], key: first[0] === 'az' ? Number(first[1]) : first.slice(1).join(':') };
  }
  const next = deviceCards(); // lighter than render(): keeps the sidebar sections as the user left them
  renderAzeron(next.az); renderKeyboard(next.kb); renderMouse(next.ms); renderDetail(next);
  updateLive();
  // the highlight is temporary: it fades after a few seconds
  clearTimeout(flashTimer);
  if (flash.size) flashTimer = setTimeout(() => {
    flash = new Set();
    const again = deviceCards();
    renderAzeron(again.az); renderKeyboard(again.kb); renderMouse(again.ms);
    updateLive();
  }, 3500);
  document.querySelector('.card.flash')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  if (e.target.closest('#mouseEditor')) return editorEvent(e);
  const sum = e.target.closest('.side summary');
  if (sum?.parentElement.dataset.k) { const d = sum.parentElement; setTimeout(() => sectionOpen.set(d.dataset.k, d.open)); return; }   // remember it (see sectionOpen)
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    ui.tab = tab.dataset.tab; flash.clear(); saveUi(); render();
    $('tabs').querySelector('[aria-selected="true"]')?.focus();   // render rebuilt the tab row: keep the keyboard position
    return;
  }
  const f = e.target.closest('.row[data-focus], .row[data-sigs]');
  if (f) { focusFromRow(f); return; }
  const card = e.target.closest('.card');
  if (card && bindMenu?.cap) { capAddCard(card); return; }   // the bind editor is capturing: the card's key joins the bind
  if (card) {
    flash.clear();
    const key = card.dataset.dev === 'az' ? Number(card.dataset.key) : card.dataset.key;
    const same = selected && selected.dev === card.dataset.dev && String(selected.key) === String(key);
    selected = same ? null : { dev: card.dataset.dev, key };
    render(); return;
  }
  const row = e.target.closest('.row[data-item]');
  if (row) {
    // an action: highlight its keys and open the bind editor (on the bind that was clicked, if one was); again closes it
    const id = row.dataset.item;
    const bind = e.target.closest('[data-bind]');
    const sel = bind ? Number(bind.dataset.bind) : null;
    if (!editing()) hlItem = hlItem === id ? null : id;   // bind editing is off: a click only highlights the action's keys
    else if (hlItem === id && (!bindMenu || (bindMenu.id === id && (sel == null || sel === bindMenu.sel)))) { closeBindMenu(); hlItem = null; }
    else { hlItem = id; if (!openBindMenu(id, sel, row)) closeBindMenu(); }
    render();
  }
});
$('layerBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleOrderMenu(false); toggleLayerMenu(); });
$('layerMenu').addEventListener('click', (e) => e.stopPropagation());
$('layerMenu').addEventListener('change', (e) => {
  const box = e.target.closest('input[data-extra], input[data-through]');
  if (!box) return;
  const field = box.dataset.extra ? 'extra' : 'showThrough';
  const layer = box.dataset.extra ?? box.dataset.through;
  const set = new Set(field === 'extra' ? ui.extra ?? [] : ui.showThrough ?? ALL_LAYERS);
  if (box.checked) set.add(layer); else set.delete(layer);
  ui[field] = [...set];
  saveUi(); render();
  $('layerMenu').querySelector(field === 'extra' ? `[data-extra="${layer}"]` : `[data-through="${layer}"]`)?.focus();   // render rebuilt the menu: keep the keyboard position
});
$('layerMenu').addEventListener('click', (e) => { if (e.target.id === 'layerClear') { ui.extra = []; ui.showThrough = null; saveUi(); render(); } });
document.addEventListener('click', () => toggleLayerMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('layerMenu').hidden) { toggleLayerMenu(false); $('layerBtn').focus(); } });
$('calStick').addEventListener('click', startCalibration);
$('calReset').addEventListener('click', () => {
  cal = null; calText = 'Reset to the default X/Y axes.'; showCalText();
  S.config.stickCal = '';
  post('/api/config', { stickCal: '' }, 'save the calibration');
});
$('ghubProfile').addEventListener('change', (e) => setConfig({ ghubProfile: e.target.value }));
$('kbLayout').addEventListener('change', (e) => setConfig({ keyboardLayout: e.target.value }));
$('deviceFlow').addEventListener('change', (e) => { ui.deviceFlow = e.target.value === 'row' ? 'row' : 'wrap'; saveUi(); render(); });
// Panel sizes (Settings > View): one list per device. The keyboard's list also offers "fit the window" (small square keys).
for (const d of DEVS) {
  const sel = $(`size${d}`);
  if (d === 'Keyboard') sel.add(new Option('Fit the window (small keys)', 'fit'));
  for (const n of SIZES) sel.add(new Option(n === 100 ? '100% (default)' : `${n}%`, String(n)));
  sel.addEventListener('change', (e) => {
    if (e.target.value === 'fit') ui.kbSize = 'fit';
    else {
      if (d === 'Keyboard') ui.kbSize = 'azeron';
      ui[`size${d}`] = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number(e.target.value) || 100));
    }
    saveUi(); render();
  });
}
// Side-by-side view: the mouse wheel over the panels scrolls the row sideways, unless the page itself still has somewhere to
// scroll up or down in that direction (then the wheel does that, as usual). Shift+wheel and touchpads work as they always do.
document.querySelector('.devices').addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.shiftKey || e.deltaX || !e.deltaY) return;
  // what scrolls sideways here: the whole row of panels (side by side), or the keyboard panel under the pointer when its
  // Azeron-sized keys make it wider than the window (stacked)
  const row = document.body.classList.contains('side-scroll') ? e.currentTarget
    : e.target.closest(document.body.classList.contains('kb-big') ? '.device.keyboard, .device.scaled-up' : '.device.scaled-up');
  if (!row) return;
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 0 || (e.deltaY < 0 ? row.scrollLeft <= 0 : row.scrollLeft >= max - 1)) return;      // nothing (more) to scroll sideways
  const centre = document.querySelector('.center');
  const page = getComputedStyle(centre).overflowY === 'visible' ? document.querySelector('.layout') : centre;   // (narrow windows scroll as a whole)
  const pageCanScroll = e.deltaY < 0 ? page.scrollTop > 0 : page.scrollTop < page.scrollHeight - page.clientHeight - 1;
  if (pageCanScroll) return;
  row.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 40 : 1);
  e.preventDefault();
}, { passive: false });
$('reloadData').addEventListener('click', load);

// ---- settings page (opened with the cog) ----
let settingsReturnFocus = null;
function openSettings() {
  if (!S) return;                                   // nothing loaded yet: there is nothing to set up
  settingsReturnFocus = document.activeElement;
  fillSelectors();
  draft = newDraft();                               // working copy for the mouse-layout editor
  renderMouseEditor();
  $('settings').hidden = false;
  $('settingsClose').focus();
}
/** Close Settings. With unsaved mouse-layout changes it asks whether to save them first. Returns false if it stayed open
 *  (the changes could not be saved: the editor says why). */
let closingSettings = false;
async function closeSettings() {
  if ($('settings').hidden) return true;
  if (closingSettings) return false;
  closingSettings = true;
  try {
    if (draftDirty() && confirm('Save your changes to the mouse layout?\n\nOK saves them. Cancel throws them away.') && !(await saveMouse())) return false;
    draft = null;
    $('settings').hidden = true;
    renderMouseEditor();
    settingsReturnFocus?.focus?.();
    return true;
  } finally { closingSettings = false; }
}
$('settingsBtn').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });   // click on the dimmed backdrop
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settings').hidden) closeSettings(); });
$('mouseEditor').addEventListener('input', editorEvent);
$('mouseEditor').addEventListener('change', editorEvent);
$('detail').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-layer]');
  if (input && selected) saveLabel(selected.dev, selected.key, input.dataset.layer, input.value);
});
$('overlay').addEventListener('change', (e) => { ui.common = e.target.checked; saveUi(); render(); });
for (const d of DEVS) {
  $(`show${d}`).addEventListener('click', () => { ui[`show${d}`] = !ui[`show${d}`]; saveUi(); render(); });
}
$('drone').addEventListener('change', (e) => { ui.drone = e.target.checked; saveUi(); render(); });
$('optional').addEventListener('change', (e) => { ui.hideOptional = e.target.checked; saveUi(); render(); });
$('compact').addEventListener('click', () => { ui.compact = !ui.compact; saveUi(); render(); });
// each side panel hides itself from its own header; a small edge tab brings it back
document.addEventListener('click', (e) => {
  const hide = e.target.closest('[data-hide]');
  if (hide) { if (hide.dataset.hide === 'left') ui.showLeft = false; else ui.showRight = false; saveUi(); render(); }
});
$('showLeft').addEventListener('click', () => { ui.showLeft = true; saveUi(); render(); });
$('showRight').addEventListener('click', () => { ui.showRight = true; saveUi(); render(); });
$('filter').addEventListener('input', () => S && renderSides());
$('reload').addEventListener('click', load);
$('source').addEventListener('change', (e) => setConfig({ machine: e.target.value }));
$('profile').addEventListener('change', (e) => setConfig({ azeronProfile: e.target.value }));
// Bind editing: off by default; switching it on asks first, because nobody at Gaijin has said such a file is allowed
const EDITING_WARNING = [
  'Switch on bind editing?',
  'Whether this is safe to use is not known. Gaijin has not said if a controls file made by another program is allowed, '
    + 'and its rules against "unauthorized modifications" do not say what counts.',
  'What the app does: it writes a NEW controls file into your Saves folder, and you load it yourself with the game\'s own '
    + 'Import from file. It never changes a file the game owns and never touches the running game. No rule or ban report against '
    + 'this was found, but there is no official permission either.',
  'Use it at your own risk.',
].join('\n\n');
$('bindEditing').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if (on && !confirm(EDITING_WARNING)) { e.target.checked = false; return; }
  if (!on) { closeBindMenu(); hlItem = null; changesOpen = false; }
  await setConfig({ bindEditing: on });
});

// Desktop shell (Electron) hooks; absent when running in a normal browser.
if (window.kbHost) {
  document.body.classList.add('hosted');   // reveals the window-only controls (opacity, overlay, pin, click-through, min, close)
  const toggle = (id, fn) => $(id).addEventListener('click', async () => { const on = $(id).getAttribute('aria-pressed') !== 'true'; $(id).setAttribute('aria-pressed', String(on)); fn(on); });
  toggle('pin', (on) => window.kbHost.setAlwaysOnTop(on));
  toggle('ghost', (on) => window.kbHost.setClickThrough(on));
  $('opacity').addEventListener('input', (e) => window.kbHost.setOpacity(Number(e.target.value) / 100));
  $('winmin').addEventListener('click', () => window.kbHost.minimize());
  $('winclose').addEventListener('click', () => window.kbHost.close());
  let host = { onTop: false, transparent: false };   // last window state reported by the desktop shell

  // "Hide background": the window itself must be transparent, so the shell recreates the window (the page reloads, settings come back from the server).
  $('noBg').addEventListener('change', (e) => window.kbHost.setTransparent(e.target.checked));

  // Overlay: compact view, no side panels, no background, always on top, at the position/size saved in Settings (default 880x600).
  // Leaving it restores what you had before. "Set up" runs the same overlay but with a solid, resizable window and a Save / Cancel bar.
  async function setOverlay(on, { setup = false } = {}) {
    const kb = window.kbHost;
    if (on) {
      // what to put back afterwards. Already in overlay mode (e.g. "Set up..." opened from it): keep the first snapshot,
      // otherwise the overlay's own look would be remembered as "your previous setup".
      if (!ui.overlayMode || !ui.overlayPrev) ui.overlayPrev = { compact: ui.compact, showLeft: ui.showLeft, showRight: ui.showRight, showAzeron: ui.showAzeron, showKeyboard: ui.showKeyboard, showMouse: ui.showMouse, transparent: host.transparent, onTop: host.onTop, opacity: host.opacity };
      ui.overlayMode = true; ui.overlaySetup = setup; ui.compact = true; ui.showLeft = false; ui.showRight = false;
      for (const d of DEVS) ui[`show${d}`] = ui[`overlay${d}`] ?? (d !== 'Keyboard');   // which device panels the overlay shows (same defaults as the Settings checkboxes)
    } else {
      const p = ui.overlayPrev ?? {};
      ui.overlayMode = false; ui.overlaySetup = false;
      ui.compact = p.compact ?? false; ui.showLeft = p.showLeft ?? true; ui.showRight = p.showRight ?? true;
      for (const d of DEVS) ui[`show${d}`] = p[`show${d}`] ?? true;
    }
    const prev = ui.overlayPrev ?? {};
    if (!ui.overlayMode) delete ui.overlayPrev;
    saveUi(); await postUi(); render();
    kb.setAlwaysOnTop(ui.overlayMode ? true : !!prev.onTop);
    kb.setOpacity(ui.overlayMode ? (ui.overlayOpacity ?? 100) / 100 : (prev.opacity ?? 1));   // the overlay has its own opacity; leaving restores yours
    if (ui.overlayMode) kb.applyOverlayBounds();     // (leaving overlay: the shell restores the exact previous bounds itself)
    // last: recreates the window when it changes. Setup needs a solid window (a transparent one can't be resized).
    setTimeout(() => kb.setTransparent(ui.overlayMode ? !ui.overlaySetup : !!prev.transparent), 120);
  }
  $('overlayChk').addEventListener('change', (e) => setOverlay(e.target.checked));

  // ---- overlay position / size / mouse: set up from Settings ----
  $('overlaySetup').addEventListener('click', async () => { if (await closeSettings()) setOverlay(true, { setup: true }); });
  for (const d of DEVS) $(`setup${d}`).addEventListener('change', (e) => { ui[`show${d}`] = e.target.checked; saveUi(); render(); });
  $('setupSave').addEventListener('click', async () => {
    for (const d of DEVS) ui[`overlay${d}`] = ui[`show${d}`];   // remember which panels you chose in the setup bar
    window.kbHost.saveOverlayBounds();              // position + size of the window as it is right now
    await setOverlay(false);
  });
  $('setupCancel').addEventListener('click', () => setOverlay(false));
  $('overlayBoundsReset').addEventListener('click', () => window.kbHost.resetOverlayBounds());
  for (const d of DEVS) $(`overlay${d}`).addEventListener('change', (e) => { ui[`overlay${d}`] = e.target.checked; saveUi(); });
  // overlay opacity: one value, editable in Settings and in the set-up bar; applied live while the overlay is on
  const setOverlayOpacity = (v) => {
    ui.overlayOpacity = Math.max(35, Math.min(100, Number(v) || 100));
    $('overlayOpacity').value = ui.overlayOpacity; $('setupOpacity').value = ui.overlayOpacity;
    $('overlayOpacityText').textContent = `${ui.overlayOpacity}%`;
    saveUi();
    if (ui.overlayMode) window.kbHost.setOpacity(ui.overlayOpacity / 100);
  };
  $('overlayOpacity').addEventListener('input', (e) => setOverlayOpacity(e.target.value));
  $('setupOpacity').addEventListener('input', (e) => setOverlayOpacity(e.target.value));

  window.kbHost.onCommand?.((c) => {
    if (c === 'compact') { ui.compact = !ui.compact; saveUi(); render(); }
    else if (c === 'overlay') $('overlayChk').click();     // tray icon click / overlay hotkey
  });

  // Global hotkeys (Settings > Hotkeys): click a button, then press the combination. It needs Ctrl, Alt or Win, because the
  // shortcut is taken away from every other program (the game included) while this app runs. Esc cancels, Backspace turns it off.
  const accelKey = (e) => /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d+$/.test(e.code) ? e.code
    : ({ Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Tab: 'Tab', Enter: 'Enter' })[e.code] ?? null;
  const niceAccel = (a) => String(a).replace('Control', 'Ctrl').replace('Super', 'Win');
  let hotkeys = {};        // name -> { accel, ok }, as reported by the desktop shell
  let hotkeyFailed = null; // { name, accel, why } for the last change that could not be applied
  let capturing = null;    // the button that is waiting for a key press
  const hotkeyText = (name) => {
    const k = hotkeys[name];
    return !k ? '...' : !k.accel ? 'Off' : `${niceAccel(k.accel)}${k.ok ? '' : ' (taken by another app)'}`;
  };
  const paintHotkeys = () => {
    for (const b of document.querySelectorAll('[data-hotkey]')) if (b !== capturing) b.textContent = hotkeyText(b.dataset.hotkey);
    $('hotkeyMsg').textContent = hotkeyFailed
      ? `${niceAccel(hotkeyFailed.accel)} ${hotkeyFailed.why === 'duplicate' ? 'is already used by another shortcut of this app' : 'is taken by another app'}: the previous shortcut was kept.` : '';
    const ct = hotkeys.clickThrough?.accel, sh = hotkeys.window?.accel;
    $('ghost').title = `Click-through: mouse clicks pass to the game.${ct ? ` ${niceAccel(ct)} toggles it.` : ''}${sh ? ` ${niceAccel(sh)} shows/hides the window.` : ''}`;
  };
  $('settings').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hotkey]');
    if (!btn || capturing) return;
    capturing = btn;
    btn.textContent = 'Press the keys...  (Esc cancels, Backspace = off)';
    const finish = () => { window.removeEventListener('keydown', onKey, true); capturing = null; paintHotkeys(); };
    const onKey = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === 'Escape') return finish();
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) return;
      const mods = [ev.ctrlKey && 'Control', ev.altKey && 'Alt', ev.shiftKey && 'Shift', ev.metaKey && 'Super'].filter(Boolean);
      if (ev.key === 'Backspace' && !mods.length) { window.kbHost.setHotkey(btn.dataset.hotkey, ''); return finish(); }
      const key = accelKey(ev);
      if (!key || !mods.some((m) => m !== 'Shift')) { btn.textContent = 'Use Ctrl / Alt / Win + a key'; return; }
      window.kbHost.setHotkey(btn.dataset.hotkey, [...mods, key].join('+'));
      finish();
    };
    window.addEventListener('keydown', onKey, true);
  });
  window.kbHost.onState?.((s) => {
    hotkeys = s.keys ?? {};
    hotkeyFailed = s.keyFailed ?? null;
    paintHotkeys();
  });
  window.kbHost.onState?.((s) => {
    const b = s.overlayBounds;
    $('overlayBoundsText').textContent = b ? `Saved: ${b.width} x ${b.height} at ${b.x}, ${b.y}` : 'Not set yet (default 880 x 600)';
    host = { onTop: !!s.onTop, transparent: !!s.transparent, opacity: s.opacity ?? 1 };
    if (s.opacity != null) $('opacity').value = Math.round(s.opacity * 100);
    $('pin').setAttribute('aria-pressed', String(!!s.onTop));
    $('ghost').setAttribute('aria-pressed', String(!!s.clickThrough));
    $('noBg').checked = !!s.transparent;
    document.body.classList.toggle('nobg', !!s.transparent);
  });
}

setInterval(async () => {
  if (document.hidden || draft || bindMenu?.cap) return;   // (a reload would not lose a half-entered bind, but it would flicker)
  try {
    const j = await (await fetch('/api/stamp')).json();
    if (stamp && j.stamp !== stamp) load();
  } catch { /* server stopped */ }
}, 2500);

load();
