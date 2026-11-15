// Builds a controls file for War Thunder's own "Import from file" (Controls menu) out of the user's controls file plus the
// binds edited in this app. Text in, text out: nothing is read or written here.
//
// The result has the shape of a file the game exports itself: a root `controls{}` block (version, base preset, hotkeys, axes,
// params, deviceMapping) and, where it can be reproduced, the root `settings{}` block. Everything the user did not edit is
// written back exactly as it was read; only the blocks of edited actions are replaced.
import { parseBlk, block, serializeBlk } from './blk.mjs';
import { bindSig } from './edits.mjs';

const FIELD = { key: 'keyboardKey', mouse: 'mouseButton', joy: 'joyButton' };
const KIND = { keyboardKey: 'key', mouseButton: 'mouse', joyButton: 'joy' };
/** One bind block as this app sees it ("key:29+key:46"); '' when it holds nothing the app shows (empty, or only a gesture). */
const blockSig = (b) => b.entries.filter((x) => KIND[x.k] && Number.isInteger(x.v) && x.v >= 0).map((x) => `${KIND[x.k]}:${x.v}`).join('+');

/**
 * @param sourceText   the controls file the edits were made on: a machine.blk (content{controls{}}) or a file exported by the game
 * @param edits        { ID_ACTION: [ [ {kind, code}, ... ], ... ] }  the action's binds, in order; [] = unbound
 * @param templateText optional: a file the game exported. Only used when the source is a machine.blk, and only for the LIST of
 *                     keys in its settings{} block; their values are taken from the source.
 * @returns { text, changed, settings: 'kept' | 'live' | 'none' }
 */
export function buildExport({ sourceText, edits, templateText = null }) {
  const root = parseBlk(sourceText);
  const content = block(root, 'content');
  const controls = block(content, 'controls') ?? block(root, 'controls');
  if (!controls) throw new Error('the controls file has no controls{} block');
  let hk = block(controls, 'hotkeys');
  if (!hk) {
    hk = { entries: [] };
    const after = controls.entries.findIndex((e) => e.k === 'basePresetPaths');
    controls.entries.splice(after < 0 ? controls.entries.length : after + 1, 0, { k: 'hotkeys', block: hk });
  }

  let changed = 0;
  for (const [id, binds] of Object.entries(edits)) {
    const old = hk.entries.filter((e) => e.block && e.k === id);
    const pool = old.filter((e) => blockSig(e.block));
    // a bind made only of things this app does not show (a touch gesture) cannot be edited here, so it is kept as it is
    const unseen = old.filter((e) => !blockSig(e.block) && e.block.entries.length);
    const next = binds.map((inputs) => {
      for (const i of inputs) if (!FIELD[i.kind] || !Number.isInteger(i.code) || i.code < 0) throw new Error(`bad input in the edit of ${id}`);
      // A bind that is already in the file keeps its own block, with anything else the game stored in it (activationType, ...)
      const at = pool.findIndex((e) => blockSig(e.block) === bindSig(inputs));
      if (at >= 0) return pool.splice(at, 1)[0];
      return { k: id, block: { entries: inputs.map((i) => ({ k: FIELD[i.kind], t: 'i', v: i.code })) } };
    });
    next.push(...unseen);
    if (!next.length) next.push({ k: id, block: { entries: [] } });   // an empty block is how the game writes "unbound on purpose"
    let at = hk.entries.findIndex((e) => e.k === id);
    hk.entries = hk.entries.filter((e) => !(e.block && e.k === id));
    if (at < 0) {   // not in the file yet: the game keeps hotkeys sorted by name
      at = hk.entries.findIndex((e) => e.k > id);
      if (at < 0) at = hk.entries.length;
    }
    hk.entries.splice(at, 0, ...next);
    changed++;
  }

  if (!content) {
    // the source is itself an exported file: everything else in it (its settings{} block, its params) goes out as it came in
    return { text: serializeBlk(root), changed, settings: block(root, 'settings') ? 'kept' : 'none' };
  }
  // The source is a machine.blk. A file the game exports also carries a settings{} block: a fixed selection of the values
  // in machine.blk's own settings{}. With a real export to take the selection from, the same block is written here with the
  // CURRENT values, so importing the file leaves those settings as they are whichever way the game treats a missing one.
  const out = { entries: [{ k: 'controls', block: controls }] };
  const live = block(content, 'settings');
  const wanted = templateText ? block(parseBlk(templateText), 'settings') : null;
  let settings = 'none';
  if (live && wanted) {
    const entries = [];
    for (const w of wanted.entries) {
      if (w.block) continue;
      const cur = live.entries.find((e) => !e.block && e.k === w.k && e.t === w.t);
      if (cur) entries.push(cur);
    }
    if (entries.length) { out.entries.push({ k: 'settings', block: { entries } }); settings = 'live'; }
  }
  return { text: serializeBlk(out), changed, settings };
}
