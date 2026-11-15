// Builds data/catalog.json + data/presets.json from a *copy* of the game's vromfs files
// that was unpacked with wt_ext_cli (--format BlkText).  Never touches the game folder.
//   node tools/build-data.mjs <unpacked-dir>
// <unpacked-dir> contains aces.vromfs.bin_u, gui.vromfs.bin_u, lang.vromfs.bin_u
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlk, block } from '../lib/blk.mjs';
import { readHotkeys, readAxes, basePreset } from '../lib/wtconfig.mjs';

const root = process.argv[2];
if (!root) { console.error('usage: node tools/build-data.mjs <unpacked-dir>'); process.exit(1); }
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
/** Stop without touching data/: a half-understood game update must not replace data that works. */
const fail = (msg) => { console.error(`build-data: ${msg}\nNothing was written; data/ is unchanged.`); process.exit(1); };

// ---- presets (read with the same code the app uses for your own controls file) -----------
const hkDir = join(root, 'aces.vromfs.bin_u', 'config', 'hotkeys');
const presets = {};
for (const f of readdirSync(hkDir)) {
  const m = f.match(/^hotkey\.(.+)\.blk$/);
  if (!m) continue;
  const c = block(parseBlk(readFileSync(join(hkDir, f), 'utf8')), 'controls');
  if (!c) continue;
  presets[m[1]] = { base: basePreset(c), hotkeys: Object.fromEntries(readHotkeys(c)), axes: readAxes(c) };
}
if (Object.keys(presets).length < 5) fail(`only ${Object.keys(presets).length} presets found in ${hkDir}`);
console.log('presets:', Object.keys(presets).length);

// ---- localized names -----------------------------------------------------------------
const csv = readFileSync(join(root, 'lang.vromfs.bin_u', 'lang', 'controls.csv'), 'utf8');
const names = {};
for (const line of csv.split(/\r?\n/)) {
  const m = line.match(/^"([^"]+)";"([^"]*)"/);
  if (m) names[m[1]] = m[2];
}

// ---- catalog (shortcut ids, grouped by the game's own shortcut-list scripts) ---------
const GROUPS = {
  aircraft: 'air', helicopter: 'heli',
  tank: 'ground', artillery: 'ground',
  ship: 'naval', submarine: 'sub',
  special: 'common', ingame: 'common', view: 'common', interface: 'common', voice: 'common', replay: 'spectator',
  trackir: 'common', // only 3 shortcuts (reset position + 2 axes): a tab of its own would be nearly empty
  // gamepad: its group holds no shortcuts of its own (only stick-swap buttons); gamepad binds are the normal vehicle actions
};
const SUB = { aircraft: 'Aircraft', helicopter: 'Helicopter', tank: 'Tank', artillery: 'Artillery', ship: 'Ship', submarine: 'Submarine' };
const dir = join(root, 'gui.vromfs.bin_u', 'scripts', 'controls', 'shortcutslist');
const items = [];
const seen = new Set();
const pretty = (id) => id.replace(/^ID_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const perFile = {};
for (const [file, tab] of Object.entries(GROUPS)) {
  const txt = readFileSync(join(dir, `shortcutsgroup${file}.nut`), 'utf8');
  // top-level items are indented exactly two spaces: "  {" ... "  }"
  const parts = txt.split(/\r?\n  \{\r?\n/).slice(1);
  let recognised = 0;   // entries whose id could be read at all (before types are filtered and repeats dropped)
  let section = '';
  for (const raw of parts) {
    const body = raw.split(/\r?\n  \}/)[0];
    const id = body.match(/^\s*id = "(\w+)"/)?.[1];
    if (!id) continue;
    recognised++;
    const type = body.match(/type = CONTROL_TYPE\.(\w+)/)?.[1];
    if (type === 'SECTION' || type === 'HEADER') { section = names[`hotkeys/${id}`] ?? pretty(id.replace(/_HEADER$/, '')); continue; }
    if (type === 'AXIS') {
      // analog axis + its button-driven "<axis>_rangeMin/Max" shortcuts (e.g. throttle up/down on keys)
      const common = { tab, sub: SUB[file] ?? null, section, optional: true };
      const nm = (k) => names[`hotkeys/${k}`] ?? names[`controls/${k}`];
      if (!seen.has(`${tab}:${id}`)) {
        seen.add(`${tab}:${id}`);
        items.push({ id, axis: true, name: names[`controls/${id}`] ?? nm(id) ?? pretty(id), ...common });
      }
      for (const [suffix, role] of [['_rangeMin', 'min'], ['_rangeMax', 'max']]) {
        const rid = id + suffix;
        if (seen.has(`${tab}:${rid}`) || !nm(rid)) continue;
        seen.add(`${tab}:${rid}`);
        items.push({ id: rid, axisRange: role, axisOf: id, name: nm(rid), ...common });
      }
      continue;
    }
    if (type) continue;               // sliders, switches, buttons: not plain shortcuts
    if (!id.startsWith('ID_')) continue;
    const key = `${tab}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id, tab, sub: SUB[file] ?? null, section,
      name: names[`hotkeys/${id}`] ?? pretty(id),
      optional: /checkAssign\s*=\s*false/.test(body),
    });
  }
  perFile[file] = recognised;
}
// The scripts are read by their shape (indentation, `id = "..."`), not parsed. If a game update changes that shape, a file yields
// no entries at all or the total collapses; better to stop here than to ship a catalog with a layer missing.
// (Entries are counted as read, not as kept: a group may legitimately add nothing new because another group listed the same ids.)
const empty = Object.entries(perFile).filter(([, n]) => n === 0).map(([f]) => f);
if (empty.length) fail(`nothing could be read from these shortcut groups: ${empty.join(', ')}. The .nut layout has probably changed.`);
if (items.length < 400) fail(`only ${items.length} shortcuts found (expected 800 or so). The .nut layout has probably changed.`);
if (Object.keys(names).length < 500) fail(`only ${Object.keys(names).length} names read from controls.csv`);
// ---- re-file: infantry gets its own tab; drone control becomes ground/naval sub-overlays -------------
for (const it of items) {
  if (it.tab === 'common' && /^Spectator/i.test(it.section)) { it.tab = 'spectator'; it.sub = 'Replay / Spectator'; }
  else if (it.tab === 'common' && /^Human /.test(it.section)) {
    if (it.section === 'Human Uav' || /HUMAN_DRONE$/.test(it.id)) { it.tab = 'drone'; it.droneFor = ['ground', 'naval']; it.sub = 'Drone'; }
    else { it.tab = 'infantry'; it.sub = 'Infantry'; }
  } else if (it.tab === 'common' && /_HUMAN$|^human_/.test(it.id)) { it.tab = 'infantry'; it.sub = 'Infantry'; }
  else if (it.tab === 'ground' && it.section === 'Scout UAV') { it.tab = 'drone'; it.droneFor = ['ground']; it.sub = 'Drone'; }
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'presets.json'), JSON.stringify(presets));
writeFileSync(join(out, 'catalog.json'), JSON.stringify({ items }));
const by = {}; items.forEach((i) => (by[i.tab] = (by[i.tab] ?? 0) + 1));
console.log('catalog items:', items.length, by);
