import { readFileSync } from 'node:fs';
import { parseBlk, block, blocks, value } from './blk.mjs';
import { keyName, mouseName } from './dik.mjs';

const KINDS = { keyboardKey: 'key', mouseButton: 'mouse', joyButton: 'joy' };

/** hotkeys{} block -> Map<id, Binding[]>; Binding = { inputs:[{kind,code}] } (several inputs = chord).
 *  An id present with no bindings (e.g. `ID_AIR_BRAKE{}`) is an explicit unbind. */
export function readHotkeys(controlsBlock) {
  const map = new Map();
  const hk = block(controlsBlock, 'hotkeys');
  for (const e of hk?.entries ?? []) {
    if (!e.block) continue;
    const inputs = e.block.entries.filter((x) => KINDS[x.k]).map((x) => ({ kind: KINDS[x.k], code: x.v }));
    if (!map.has(e.k)) map.set(e.k, []);
    if (inputs.length) map.get(e.k).push({ inputs });
  }
  return map;
}

/** Parse a user machine.blk / exported preset .blk and return its controls{} node. */
export function readControls(path) {
  const root = parseBlk(readFileSync(path, 'utf8'));
  // machine.blk wraps in content{controls{}}; exported presets have controls{} at top.
  const controls = block(block(root, 'content'), 'controls') ?? block(root, 'controls');
  if (!controls) throw new Error(`No controls{} block in ${path}`);
  return controls;
}

/** Chain: base presets (oldest first) then the user's overrides. A layer replaces an id wholesale. */
export function resolveBinds(controls, presets) {
  const chain = [{ name: '(your config)', hotkeys: readHotkeys(controls), axes: readAxes(controls) }];
  const seen = new Set();
  let path = value(block(controls, 'basePresetPaths'), 'default');
  while (path && !seen.has(path)) {
    seen.add(path);
    const name = path.replace(/^.*hotkey\./, '').replace(/\.blk$/, '');
    const p = presets[name];
    if (!p) { chain.push({ name, missing: true, hotkeys: new Map() }); break; }
    chain.push({ name, hotkeys: new Map(Object.entries(p.hotkeys)), axes: p.axes ?? {} });
    path = p.base;
  }
  chain.reverse(); // oldest first
  const effective = new Map();
  const origin = new Map();
  const axes = {};
  for (const layer of chain) {
    for (const [id, binds] of layer.hotkeys) { effective.set(id, binds); origin.set(id, layer.name); }
    for (const [id, a] of Object.entries(layer.axes ?? {})) axes[id] = a; // an axis block replaces the earlier one
  }
  return { effective, origin, axes, chain: chain.map((c) => c.name + (c.missing ? ' (MISSING)' : '')) };
}

export const describeInput = (inp) =>
  inp.kind === 'key' ? keyName(inp.code) : inp.kind === 'mouse' ? mouseName(inp.code) : `JOY${inp.code}`;

export const describeBinding = (b) => b.inputs.map(describeInput).join(' + ');

export function readAxes(controls) {
  const out = {};
  for (const e of block(controls, 'axes')?.entries ?? []) {
    if (!e.block) continue;
    out[e.k] = {
      axisId: value(e.block, 'axisId', null),
      mouseAxisId: value(e.block, 'mouseAxisId', null),
      inverse: value(e.block, 'inverse', false),
    };
  }
  return out;
}

export function readDeviceMapping(controls) {
  return blocks(block(controls, 'deviceMapping'), 'joystick').map((j) => ({
    devId: value(j, 'devId'), name: value(j, 'name'),
    buttonsOffset: value(j, 'buttonsOffset', 0), buttonsCount: value(j, 'buttonsCount', 0),
    axesOffset: value(j, 'axesOffset', 0), axesCount: value(j, 'axesCount', 0),
    connected: value(j, 'connected', false),
  }));
}
