// War Thunder Keybinder front-end. Vanilla JS. Data comes from /api/state; edits go back through small POST endpoints.
const TABS = [['air', 'Air'], ['heli', 'Helicopter'], ['ground', 'Ground'], ['naval', 'Naval'], ['sub', 'Submarine'], ['infantry', 'Infantry'], ['spectator', 'Replay']];
const TAB_NAME = { air: 'Air', heli: 'Helicopter', ground: 'Ground', naval: 'Naval', sub: 'Submarine', infantry: 'Infantry', spectator: 'Replay / Spectator', drone: 'Drone', common: 'Common' };
// layers that can carry their own custom labels
const LAYERS = [['air', 'Air'], ['heli', 'Helicopter'], ['ground', 'Ground'], ['naval', 'Naval'], ['sub', 'Submarine'], ['infantry', 'Infantry'], ['spectator', 'Replay'], ['ground-drone', 'Ground drone'], ['naval-drone', 'Naval drone'], ['common', 'Common']];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = (a) => [...new Set(a)];
const DEVS = ['Azeron', 'Keyboard', 'Mouse'];   // device panels, left to right. Each has: ui.show<D>, ui.overlay<D>, buttons show<D> / setup<D> / overlay<D>

const ui = (() => { try { return JSON.parse(localStorage.getItem('wtkb-ui') ?? '{}'); } catch { return {}; } })();
// View settings are kept in the browser AND on the server (ui.json): the desktop window changes port / is recreated, which would lose localStorage.
let uiTimer = null;
const postUi = () => fetch('/api/ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ui) }).catch(() => {});
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
  ui.showLeft ??= true; ui.showRight ??= true;
  if (!TABS.some(([k]) => k === ui.tab)) ui.tab = 'air';
  if (new URLSearchParams(location.search).get('mini')) ui.compact = true;
}
uiDefaults();

let S = null;          // last state from the server
let stamp = null;
let selected = null;   // { dev:'az'|'ms', key }
let hlItem = null;     // action highlighted from a sidebar row
let draft = null;      // mouse layout being edited (null = not editing)
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
/** Custom-label layers consulted for the current view, most specific first. */
const labelLayers = () => [ui.tab, ...(droneOn() ? [`${ui.tab}-drone`] : []), ...(ui.common ? ['common'] : []), ...extras(), ...throughLayers()];
function labelFor(dev, key) {
  const L = S.labels?.[dev]?.[key];
  if (!L) return null;
  for (const l of labelLayers()) if (L[l]) return { text: L[l], layer: l };
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

  for (const cell of S.layouts.azeron.cells) {
    const k = azKeys[cell.id] ?? { id: cell.id, kind: 'none', ident: '', assigned: false };
    let entries = [], modEntries = [];
    if (k.kind === 'joy') {
      entries = trig.get(`joy:${k.joyCode}`) ?? [];
      modEntries = mods.get(`joy:${k.joyCode}`) ?? [];
    } else if (k.kind === 'key' && k.key.code != null) {
      const own = `key:${k.key.code}`;
      // Azeron sends modifier + key together, so only that exact chord counts
      entries = k.key.mods.length ? bySig.get([...k.key.mods.map((m) => `key:${m}`), own].join('+')) ?? [] : trig.get(own) ?? [];
      modEntries = k.key.mods.length ? [] : mods.get(own) ?? [];
    }
    // thumb-pad direction keys send a hat direction; War Thunder's config has no hat binds, so they show as "not bound in game"
    const c = classify(entries, k.assigned && (k.kind === 'joy' || k.kind === 'key' || k.kind === 'dir'));
    if (c.cls === 'unbound' && modEntries.some((e) => inSet(e.item))) c.cls = 'bound'; // used only as a modifier
    const sig = k.kind === 'joy' ? `joy:${k.joyCode}` : k.kind === 'key' && k.key.code != null ? [...k.key.mods, k.key.code].map((m) => `key:${m}`).join('+') : null;
    out.az.push({ dev: 'az', key: cell.id, cell, k, entries, modEntries, sig, ...c });
  }

  // The wheel can be an axis (scrolling: mouse axes 2+ are the game's per-vehicle wheel slots) or up/down buttons (WT mouse 5/6).
  // When this layer uses it as an axis and nothing is bound to wheel up/down, show ONE "Scroll wheel" card instead of two.
  const wheelAxes = S.axes.filter((a) => a.mouseAxisId != null && a.mouseAxisId >= 2 && axisShown(a));
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
  for (const k of Object.values(S.azeron?.keys ?? {})) if (k.kind === 'key') { if (k.key.vk) vks.add(k.key.vk); if (k.key.modVk) vks.add(k.key.modVk); }
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
  liveSrc.onmessage = (e) => { live = JSON.parse(e.data); updateLive(); };
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
    fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stickCal: S.config.stickCal }) });
  }
  showCalText();
}

function updateLive() {
  const down = new Set(live.vks);
  const next = new Set();
  for (const k of Object.values(S?.azeron?.keys ?? {})) {
    if (k.kind === 'joy' && k.joyBtn <= 32 && ((live.joy >>> (k.joyBtn - 1)) & 1)) next.add(`az:${k.id}`);
    else if (k.kind === 'key' && k.key.vk && down.has(k.key.vk) && (!k.key.modVk || down.has(k.key.modVk))) next.add(`az:${k.id}`);
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
    stickCalibrationStep();
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

function cardBody(c) {
  const lab = labelFor(c.dev, c.key);
  const other = c.cls === 'through' ? '<span class="sub">other: </span>' : '';   // (the layers are listed in the tooltip and the details)
  let html = '';
  if (lab) {
    html += `<div class="lab" title="${esc(lab.layer)} label">${esc(lab.text)}</div>`;
    if (c.list.length) html += `<div class="acts small">${other}${esc(actNames(c.list).slice(0, 2).join(' / '))}${actNames(c.list).length > 2 ? ' +' : ''}</div>`;
  } else if (c.list.length) html += actsHtml(c.list, c.list.length > 2 ? ' more' : '', other);
  else if (c.cls === 'unbound') html += '<div class="acts">not bound in game</div>';
  if (c.modEntries.length) html += `<div class="mod">modifier &times;${c.modEntries.length}</div>`;
  return html;
}

function tip(c) {
  const lines = c.entries.map((e) => `${TAB_NAME[e.item.tab]}: ${e.item.name}${e.bind.inputs.length > 1 ? ' (' + e.bind.text + ')' : ''}`);
  if (c.dev === 'kb') return lines.join('\n') || c.cell.tip || 'Nothing bound in game';
  return lines.join('\n') || (c.cls === 'empty' ? 'Not assigned' : 'Nothing bound');
}

// ---------------------------------------------------------------- keyboard rendering
function keyBody(c) {
  const lab = labelFor('kb', c.key);
  let html = '';
  if (lab) html += `<div class="lab" title="${esc(lab.layer)} label">${esc(lab.text)}</div>`;
  else if (c.list.length) {
    const names = actNames(c.list);
    html += `<div class="acts">${c.cls === 'through' ? '<span class="sub">other: </span>' : ''}${esc(names[0])}${names.length > 1 ? ` +${names.length - 1}` : ''}</div>`;
  }
  if (c.modEntries.length) html += `<div class="mod">modifier &times;${c.modEntries.length}</div>`;
  return html;
}

function renderKeyboard(cards) {
  const L = S.layouts.keyboard;
  const el = $('keyboard');
  el.style.setProperty('--kw', L.w);
  el.style.setProperty('--kh', L.h);
  $('kbName').textContent = `· ${L.name}`;
  const at = (c) => `left:calc(var(--ku) * ${c.x});top:calc(var(--ku) * ${c.y});width:calc(var(--ku) * ${c.w} - 3px);height:calc(var(--ku) * ${c.h} - 3px);margin:1.5px`;
  const decor = (L.decor ?? []).map((d) => `<div class="kdecor ${esc(d.kind)}" style="${at(d)}">${esc(d.label)}</div>`).join('');
  el.innerHTML = decor + cards.map((c) => {
    const sel = selected?.dev === 'kb' && String(selected.key) === String(c.key) ? ' sel' : '';
    const hl = (hlItem && c.entries.some((e) => e.item.id === hlItem) ? ' hl' : '') + (flash.has(`kb:${c.key}`) ? ' flash' : '') + ovHide(c);
    return `<button class="card kkey ${c.cls}${c.cell.keep ? ' keep' : ''}${sel}${hl}" style="${at(c.cell)}" data-dev="kb" data-key="${esc(c.key)}" title="${esc(tip(c))}">
      <span class="ident">${esc(c.cell.l)}</span>${keyBody(c)}</button>`;
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
    const hl = (hlItem && c.entries.some((e) => e.item.id === hlItem) ? ' hl' : '') + (flash.has(`az:${cell.id}`) ? ' flash' : '') + (livePressed.has(`az:${cell.id}`) ? ' live' : '') + ovHide(c);
    if (cell.stick) return stickHtml(c, pos, sel + (livePressed.has(`az:${cell.id}`) ? ' live' : ''));
    return `<button class="card ${c.cls}${sel}${hl}" style="${pos}" data-dev="az" data-key="${cell.id}" title="${esc(tip(c))}">
      <span class="ident">${esc(k.ident)}</span>${cardBody(c)}<span class="id">#${cell.id}</span></button>`;
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
  const lab = labelFor('az', c.cell.id);
  return `<button class="card stick bound${sel}" style="${pos}" data-dev="az" data-key="${c.cell.id}" title="Analog stick: axes assigned in game for this layer">
    <span class="sname">Analog Joystick</span><div class="ring"><i></i></div>
    ${lab ? `<div class="lab">${esc(lab.text)}</div>` : ''}
    <div class="axl">${rows.length ? rows.join('<br>') : '<span class="dim">no stick axes for this layer</span>'}</div>
    <span class="id">#${c.cell.id}</span></button>`;
}
const axisName = (n) => n.replace(/^(gm|ship|sub|submarine|human)_/, '').replace(/_/g, ' ');

function renderMouse(cards) {
  const g = $('g502');
  const cols = Math.max(1, ...S.g502.cells.map((c) => c.c + 1));
  const rows = Math.max(1, ...S.g502.cells.map((c) => c.r + 1));
  g.style.gridTemplateColumns = `repeat(${cols}, var(--w))`;
  g.style.gridTemplateRows = `repeat(${rows}, var(--h))`;
  $('mouseEditor').parentElement.style.setProperty('--mcols', cols);
  g.innerHTML = cards.map((c) => {
    const { cell } = c;
    const pos = `grid-column:${cell.c + 1};grid-row:${cell.r + 1}`;
    const sel = selected?.dev === 'ms' && selected.key === cell.id ? ' sel' : '';
    const hl = (hlItem && c.entries.some((e) => e.item.id === hlItem) ? ' hl' : '') + (flash.has(`ms:${cell.id}`) ? ' flash' : '') + (livePressed.has(`ms:${cell.id}`) ? ' live' : '') + ovHide(c);
    if (c.merged) {
      const lab = labelFor('ms', cell.id);
      const body = (lab ? `<div class="lab">${esc(lab.text)}</div>` : '') + (c.wheelAxes.length
        ? `<div class="acts${lab ? ' small' : ''}">${c.wheelAxes.slice(0, 3).map((a) => esc(axisName(a.name))).join('<br>')}${c.wheelAxes.length > 3 ? `<br>+${c.wheelAxes.length - 3} more` : ''}</div>` : '');
      return `<button class="card ${c.cls}${sel}${hl}" style="${pos}" data-dev="ms" data-key="${esc(cell.id)}" title="Scroll wheel (axis): ${esc(c.wheelAxes.map((a) => axisName(a.name)).join(', ') || 'nothing for this layer')}">
        <span class="ident">Scroll wheel</span>${body}<span class="id">axis</span></button>`;
    }
    const unset = cell.mouse == null && cell.key == null;
    return `<button class="card ${c.cls}${sel}${hl}" style="${pos}" data-dev="ms" data-key="${esc(cell.id)}" title="${esc(unset ? 'No input set: use Edit layout' : tip(c))}">
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
    const how = k.kind === 'joy' ? `joystick button ${k.joyBtn}, game sees JOY${k.joyCode}` : k.kind === 'key' ? 'keyboard output' : k.kind === 'dir' ? 'thumbstick direction' : k.kind === 'analog' ? 'analog stick' : 'not assigned in Azeron software';
    title = `Azeron #${k.id} &ndash; ${esc(k.ident || 'unassigned')} <span class="dim">${esc(how)}</span>`;
  } else if (selected.dev === 'kb') {
    title = `Keyboard &ndash; ${esc(c.cell.l)} <span class="dim">${c.cell.d != null ? 'DirectInput key ' + c.cell.d : esc(c.cell.tip ?? 'no fixed key code')}</span>`;
  } else {
    title = `Mouse &ndash; ${esc(c.cell.label)} <span class="dim">${c.cell.mouse != null ? 'game sees Mouse' + (c.cell.mouse + 1) : c.cell.key != null ? 'sends keyboard key ' + esc(keyNameOf(c.cell.key)) : 'no game input set (edit layout)'}</span>`;
  }
  const byTab = {};
  for (const e of c.entries) (byTab[e.item.tab] ??= []).push(e);
  if (c.merged) {
    title = `Mouse &ndash; Scroll wheel <span class="dim">used as an axis (scrolling), not as up/down buttons</span>`;
    for (const a of S.axes.filter((x) => x.mouseAxisId != null && x.mouseAxisId >= 2)) (byTab[a.tab] ??= []).push({ item: { name: axisName(a.name) }, bind: { inputs: [], text: '' } });
  }
  let rows =Object.keys(TAB_NAME).filter((t) => byTab[t]).map((t) =>
    `<tr><td>${TAB_NAME[t]}</td><td>${uniq(byTab[t].map((e) => esc(e.item.name) + (e.bind.inputs.length > 1 ? ` <span class="sub">(${esc(e.bind.text)})</span>` : ''))).join('<br>')}</td></tr>`).join('');
  if (c.modEntries.length) rows += `<tr><td>Modifier</td><td>${uniq(c.modEntries.map((e) => esc(e.item.name) + ` <span class="sub">(${esc(e.bind.text)})</span>`)).join('<br>')}</td></tr>`;
  const mine = S.labels?.[selected.dev]?.[selected.key] ?? {};
  const labelInputs = LAYERS.map(([id, name]) => `<label class="lbl${labelLayers().includes(id) ? ' live' : ''}"><span>${name}</span><input type="text" maxlength="60" data-layer="${id}" value="${esc(mine[id] ?? '')}" placeholder="&ndash;"></label>`).join('');
  const stickTools = c.cell?.stick ? '<div class="dim" style="margin-top:6px;font-size:11px">Stick calibration is in Settings (the cog).</div>' : '';
  el.innerHTML = `<h3>${title}</h3>
    <div class="detail-cols"><div>${rows ? `<table>${rows}</table>` : '<span class="dim">Nothing bound to this key in game.</span>'}${stickTools}</div>
    <div class="labels"><div class="dim lbl-head">Custom label per layer (highlighted layers are active now)</div><div class="lbl-grid">${labelInputs}</div></div></div>`;
}

async function saveLabel(dev, key, layer, text) {
  const all = (S.labels[dev] ??= {});
  const k = String(key);
  all[k] ??= {};
  if (text.trim()) all[k][layer] = text.trim(); else delete all[k][layer];
  if (!Object.keys(all[k]).length) delete all[k];
  const cards = deviceCards();
  renderAzeron(cards.az); renderKeyboard(cards.kb); renderMouse(cards.ms); // not the detail panel: keep the input focused
  await fetch('/api/labels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dev, key: k, layer, text }) });
}

// ---------------------------------------------------------------- mouse layout editor
function renderMouseEditor() {
  const el = $('mouseEditor');
  $('editMouse').textContent = draft ? 'Cancel' : 'Edit layout';
  el.hidden = !draft;
  if (!draft) return;
  const profiles = S.g502.ghubProfiles ?? [];
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
        : `<span class="note">${S.g502.ghubProfile ? 'Every button of the chosen G HUB profile is already added.' : 'Choose a G HUB profile in Settings to add its buttons here.'}</span>`}
    </div>
    <div class="mrow-actions"><button id="mSave">Save layout</button><button class="mini" id="mCancel">Cancel</button></div>`;
}

function nextFree() {
  for (let r = 0; r < 10; r++) for (let c = 0; c < 4; c++) if (!draft.some((x) => x.c === c && x.r === r)) return { c, r };
  return { c: 0, r: 9 };
}
const newId = () => { let n = 1; while (draft.some((c) => c.id === `btn${n}`)) n++; return `btn${n}`; };

function editorEvent(e) {
  const row = e.target.closest('.mrow');
  if (row) {
    const c = draft[Number(row.dataset.i)];
    if (e.target.matches('.m-label')) c.label = e.target.value;
    else if (e.target.matches('.m-c')) c.c = Math.max(0, Math.min(7, Number(e.target.value) | 0));
    else if (e.target.matches('.m-r')) c.r = Math.max(0, Math.min(9, Number(e.target.value) | 0));
    else if (e.target.matches('.m-kind')) {
      delete c.mouse; delete c.key;
      if (e.target.value === 'key') c.key = 23; else if (e.target.value === 'mouse') c.mouse = 0;
      renderMouseEditor();
    }
    else if (e.target.matches('.m-code')) { const v = Number(e.target.value); if (c.key != null) c.key = v; else c.mouse = v; }
    else if (e.target.matches('.m-del') && e.type === 'click') { draft.splice(Number(row.dataset.i), 1); renderMouseEditor(); }
    return;
  }
  if (e.type !== 'change' && e.type !== 'click') return;
  if (e.target.id === 'mAdd') { draft.push({ id: newId(), label: 'Button', mouse: 3, ...nextFree() }); renderMouseEditor(); }
  else if (e.target.id === 'mCancel') { draft = null; render(); }
  else if (e.target.id === 'mSave') saveMouse();
  else if (e.target.id === 'ghubAdd' && e.target.value) {
    const s = S.g502.ghubSlots.find((x) => x.slot === e.target.value);
    const cell = { id: `g-${s.slot}`, label: s.slot.toUpperCase(), ...nextFree() };
    if (s.mouse != null) cell.mouse = s.mouse; else cell.key = s.key;
    draft.push(cell); renderMouseEditor();
  }
}

async function saveMouse() {
  const r = await fetch('/api/mouse-layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cells: draft }) });
  const j = await r.json();
  if (!r.ok) { alert(`Could not save: ${j.error}`); return; }
  draft = null;
  await load();
}

// ---------------------------------------------------------------- sidebars
function inputChip(inp) {
  if (inp.kind === 'joy' && S.azeron) {
    const k = Object.values(S.azeron.keys).find((x) => x.joyCode === inp.code);
    if (k) return `<span class="chip az" title="Azeron key #${k.id}">AZ #${k.id}</span>`;
    return `<span class="chip warn" title="No Azeron key sends this button">JOY${inp.code}</span>`;
  }
  if (inp.kind === 'mouse') {
    const g = S.g502.cells.find((c) => c.mouse === inp.code);
    return `<span class="chip ms" title="${g ? 'Mouse: ' + esc(g.label) : 'mouse button'}">${esc(inp.text)}</span>`;
  }
  if (inp.kind === 'key') {
    const az = S.azeron && Object.values(S.azeron.keys).find((k) => k.kind === 'key' && k.key.code === inp.code && !k.key.mods.length);
    if (az) return `<span class="chip az" title="Azeron key #${az.id} sends ${esc(inp.text)}">AZ #${az.id}</span>`;
    const g = S.g502.cells.find((c) => c.key === inp.code);
    if (g) return `<span class="chip ms" title="Mouse ${esc(g.label)} sends this key">${esc(inp.text)}</span>`;
  }
  return `<span class="chip kb">${esc(inp.text)}</span>`;
}
const bindChips = (item) => [
  ...item.binds.map((b) => b.inputs.map(inputChip).join('<span class="sub">+</span>')),
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

  const rowHtml = (it, dim) => `<div class="row${hlItem === it.id ? ' hl' : ''}" data-item="${esc(it.id)}"><span class="nm">${esc(it.name)}</span><span class="keys">${dim ? (it.explicitUnbind ? '<span class="chip warn">unbound</span>' : '') : bindChips(it)}</span></div>`;
  const list = (items, dim) => !items.length ? '<div class="note">Nothing here.</div>'
    : [...groupBySection(items)].map(([k, v]) => `<details ${q || v.length < 12 ? 'open' : ''}><summary>${esc(k)} <span class="count">(${v.length})</span></summary>${v.map((it) => rowHtml(it, dim)).join('')}</details>`).join('');
  $('boundList').innerHTML = list(bound, false);
  const optBlock = optional.length && !ui.hideOptional
    ? `<details class="opt"${q ? ' open' : ''}><summary>Optional &ndash; the game doesn't warn if these are unbound (${optional.length})</summary>${list(optional, true)}</details>` : '';
  $('missList').innerHTML = (essential.length ? list(essential, true) : '<div class="note">Every essential action is bound.</div>') + optBlock;
}

function renderAttention(cards) {
  const out = [];
  const idle = (c) => !c.entries.length && !c.modEntries.length;
  const deadAz = cards.az.filter((c) => (c.k.kind === 'joy' || c.k.kind === 'dir' || (c.k.kind === 'key' && c.k.key.code != null)) && idle(c));
  if (deadAz.length) out.push(`<details open><summary>Azeron keys with nothing bound in game (${deadAz.length})</summary>${deadAz.map((c) => `<div class="row focus" data-focus="az:${c.key}" title="Click to highlight this key"><span class="nm">#${c.k.id} ${esc(labelFor('az', c.key)?.text ?? '')}</span><span class="keys"><span class="chip warn">${esc(c.k.ident)}</span></span></div>`).join('')}</details>`);
  // wheel up/down (WT mouse 5/6) aren't real buttons: a wheel used as an axis (or merged card) is never "unbound"
  const deadMs = cards.ms.filter((c) => !c.merged && c.cell.mouse !== 5 && c.cell.mouse !== 6 && (c.cell.mouse != null || c.cell.key != null) && idle(c));
  if (deadMs.length) out.push(`<details open><summary>Mouse buttons with nothing bound (${deadMs.length})</summary>${deadMs.map((c) => `<div class="row focus" data-focus="ms:${esc(c.key)}" title="Click to highlight this button"><span class="nm">${esc(c.cell.label)}</span><span class="keys"><span class="chip warn">${esc(c.k.ident)}</span></span></div>`).join('')}</details>`);

  if (S.azeron) {
    const sent = new Set(Object.values(S.azeron.keys).map((k) => k.joyCode).filter((c) => c != null));
    const dev = S.azeron.device;
    const orphans = new Map();
    for (const it of S.items) if (inSet(it)) for (const b of it.binds) for (const i of b.inputs) {
      if (i.kind === 'joy' && !sent.has(i.code) && dev && i.code >= dev.buttonsOffset && i.code < dev.buttonsOffset + dev.buttonsCount) (orphans.get(i.code) ?? orphans.set(i.code, []).get(i.code)).push(it.name);
    }
    if (orphans.size) out.push(`<details open><summary>Bound to an Azeron button no key sends (${orphans.size})</summary>${[...orphans].map(([c, n]) => `<div class="row"><span class="nm">${esc(uniq(n).join(', '))}</span><span class="keys"><span class="chip warn">JOY${c - dev.buttonsOffset + 1}</span></span></div>`).join('')}</details>`);
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
  if (conflicts.size) out.push(`<details><summary>Same input, several actions (${conflicts.size})</summary><div class="note">Often intentional (different weapons/modes). Shown so you can spot accidents.</div>${[...conflicts.values()].map((c) => `<div class="row focus" data-sigs="${c.sigs.join(',')}" title="Click to highlight the key(s) on your devices"><span class="nm">${c.names.map(esc).join(' / ')}</span><span class="keys"><span class="chip">${esc(c.text)}</span></span></div>`).join('')}</details>`);
  $('attnCount').textContent = out.length ? '' : '(none)';
  $('attn').innerHTML = out.join('') || '<div class="note">Everything set up on your devices is bound in game.</div>';
}

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
  $('compact').setAttribute('aria-pressed', String(ui.compact));
  document.body.classList.toggle('compact', ui.compact);
  document.body.classList.toggle('overlay', !!ui.overlayMode);
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
  const w = $('warn');
  w.hidden = !S.warnings.length;
  w.textContent = S.warnings.join('  |  ');
}

function fillSelectors() {
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
    fillSelectors();
    render();
    startLive();
    updateLive();
  } catch (e) {
    const w = $('warn'); w.hidden = false; w.textContent = `Could not load: ${e.message}`;
  }
}

async function setConfig(patch) {
  await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  const keepDraft = draft;
  await load();
  if (keepDraft) { draft = keepDraft; renderMouseEditor(); }
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
  // the highlight is temporary: it fades after a few seconds
  clearTimeout(flashTimer);
  if (flash.size) flashTimer = setTimeout(() => {
    flash = new Set();
    const again = deviceCards();
    renderAzeron(again.az); renderKeyboard(again.kb); renderMouse(again.ms);
  }, 3500);
  document.querySelector('.card.flash')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  if (e.target.closest('#mouseEditor')) return editorEvent(e);
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; flash.clear(); saveUi(); render(); return; }
  const f = e.target.closest('.row[data-focus], .row[data-sigs]');
  if (f) { focusFromRow(f); return; }
  const card = e.target.closest('.card');
  if (card) {
    flash.clear();
    const key = card.dataset.dev === 'az' ? Number(card.dataset.key) : card.dataset.key;
    const same = selected && selected.dev === card.dataset.dev && String(selected.key) === String(key);
    selected = same ? null : { dev: card.dataset.dev, key };
    render(); return;
  }
  const row = e.target.closest('.row[data-item]');
  if (row) { hlItem = hlItem === row.dataset.item ? null : row.dataset.item; render(); }
});
$('layerBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerMenu(); });
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
  fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stickCal: '' }) });
});
$('ghubProfile').addEventListener('change', (e) => setConfig({ ghubProfile: e.target.value }));
$('kbLayout').addEventListener('change', (e) => setConfig({ keyboardLayout: e.target.value }));
$('reloadData').addEventListener('click', load);

// ---- settings page (opened with the cog) ----
let settingsReturnFocus = null;
function openSettings() {
  settingsReturnFocus = document.activeElement;
  fillSelectors();
  $('settings').hidden = false;
  $('settingsClose').focus();
}
function closeSettings() {
  if ($('settings').hidden) return;
  $('settings').hidden = true;
  settingsReturnFocus?.focus?.();
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
$('editMouse').addEventListener('click', () => { draft = draft ? null : S.g502.cells.map((c) => ({ ...c })); render(); });
$('overlay').addEventListener('change', (e) => { ui.common = e.target.checked; saveUi(); render(); });
for (const d of DEVS) {
  $(`show${d}`).addEventListener('click', () => { ui[`show${d}`] = !ui[`show${d}`]; if (d === 'Mouse' && !ui.showMouse) draft = null; saveUi(); render(); });
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
      ui.overlayPrev = { compact: ui.compact, showLeft: ui.showLeft, showRight: ui.showRight, showAzeron: ui.showAzeron, showKeyboard: ui.showKeyboard, showMouse: ui.showMouse, transparent: host.transparent, onTop: host.onTop, opacity: host.opacity };
      ui.overlayMode = true; ui.overlaySetup = setup; ui.compact = true; ui.showLeft = false; ui.showRight = false;
      for (const d of DEVS) if (ui[`overlay${d}`] !== undefined) ui[`show${d}`] = ui[`overlay${d}`];   // which device panels the overlay shows
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
  $('overlaySetup').addEventListener('click', () => { closeSettings(); setOverlay(true, { setup: true }); });
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

  // Overlay hotkey: click the button, then press the combination (needs Ctrl, Alt or Shift). Esc cancels.
  const accelKey = (e) => /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d+$/.test(e.code) ? e.code
    : ({ Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Tab: 'Tab', Enter: 'Enter' })[e.code] ?? null;
  const niceAccel = (a) => String(a).replace('Control', 'Ctrl').replace('Super', 'Win');
  let hotkeyLabel = 'Ctrl+Alt+O';
  $('hotkeyBtn').addEventListener('click', () => {
    const btn = $('hotkeyBtn');
    btn.textContent = 'Press the keys...  (Esc cancels)';
    const finish = () => { window.removeEventListener('keydown', onKey, true); btn.textContent = hotkeyLabel; };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return finish();
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const key = accelKey(e);
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
      if (!key || !mods.length) { btn.textContent = 'Use Ctrl / Alt / Shift + a key'; return; }
      window.kbHost.setOverlayHotkey([...mods, key].join('+'));
      finish();
    };
    window.addEventListener('keydown', onKey, true);
  });
  window.kbHost.onState?.((s) => {
    if (s.overlayKey) {
      hotkeyLabel = `${niceAccel(s.overlayKey)}${s.overlayKeyOk === false ? ' (taken by another app)' : ''}`;
      if (!$('hotkeyBtn').textContent.startsWith('Press')) $('hotkeyBtn').textContent = hotkeyLabel;
    }
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
  if (document.hidden || draft) return;
  try {
    const j = await (await fetch('/api/stamp')).json();
    if (stamp && j.stamp !== stamp) load();
  } catch { /* server stopped */ }
}, 2500);

load();
