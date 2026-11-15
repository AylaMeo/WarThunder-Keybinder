// Bind edits made in this app. They are a list of target binds per action ("ID_FIRE_MGUNS" -> its binds, in order), kept in
// edits.json and laid over what the controls file says. Nothing here touches a game file: lib/wtexport.mjs turns the edits into
// a new controls file that the user imports in game.
//
// A bind is a chord: [{ kind:'key'|'mouse'|'joy', code }, ...], held together (press order kept: modifier first).

/** The game's own limits: its Controls menu keeps at most 3 binds per action, and no stock preset uses more than 3 inputs in one. */
export const MAX_BINDS = 3;
export const MAX_CHORD = 3;
const RANGE = { key: [1, 255], mouse: [0, 15], joy: [0, 511] };

export const inputSig = (i) => `${i.kind}:${i.code}`;
export const bindSig = (inputs) => inputs.map(inputSig).join('+');
export const bindsEqual = (a, b) => a.length === b.length && a.every((x, i) => bindSig(x) === bindSig(b[i]));

/** Checks a list of binds that came from outside (the page, a hand-edited edits.json) and returns a clean copy.
 *  Throws with a message fit to show the user. */
export function cleanBinds(binds) {
  if (!Array.isArray(binds)) throw new Error('binds must be a list');
  if (binds.length > MAX_BINDS) throw new Error(`the game keeps at most ${MAX_BINDS} binds per action`);
  const seen = new Set();
  return binds.map((inputs) => {
    if (!Array.isArray(inputs) || !inputs.length) throw new Error('a bind needs at least one input');
    if (inputs.length > MAX_CHORD) throw new Error(`a bind can hold at most ${MAX_CHORD} inputs`);
    const out = inputs.map((i) => {
      const r = i && typeof i === 'object' && Object.hasOwn(RANGE, i.kind) ? RANGE[i.kind] : null;
      if (!r || !Number.isInteger(i.code) || i.code < r[0] || i.code > r[1]) throw new Error('unknown input in a bind');
      return { kind: i.kind, code: i.code };
    });
    if (new Set(out.map(inputSig)).size !== out.length) throw new Error('the same input is in a bind twice');
    const same = out.map(inputSig).sort().join('+');   // the game treats a chord as a set: A+B and B+A are one bind
    if (seen.has(same)) throw new Error('the same bind is listed twice');
    seen.add(same);
    return out;
  });
}

const deviceList = (d) => (Array.isArray(d) ? d : []).filter((x) => x && typeof x === 'object' && Number.isInteger(x.buttonsOffset) && Number.isInteger(x.buttonsCount))
  .map((x) => ({ devId: String(x.devId ?? ''), buttonsOffset: x.buttonsOffset, buttonsCount: x.buttonsCount }));
/** What is stored next to the edits: which joystick owned which button numbers when they were made. */
export const deviceSnapshot = (devices) => deviceList(devices);

/** Joystick button numbers are counted across all connected joysticks, so they shift when a device is added or removed (the
 *  game renumbers its own file the same way). Edits store the numbering they were made against; this moves their joystick
 *  codes to the numbering in use now, matching devices by id.
 *  -> { hotkeys, lost: ids of devices the edits use that are no longer in the controls file (their codes are left alone) } */
export function rebaseEdits(saved, devicesNow) {
  const then = deviceList(saved?.devices);
  const now = deviceList(devicesNow);
  const lost = new Set();
  const move = (code) => {
    const from = then.find((d) => code >= d.buttonsOffset && code < d.buttonsOffset + d.buttonsCount);
    if (!from || !from.devId) return code;
    const to = now.find((d) => d.devId === from.devId);
    if (!to) { lost.add(from.devId); return code; }
    return code - from.buttonsOffset + to.buttonsOffset;
  };
  const hotkeys = {};
  for (const [id, binds] of Object.entries(saved?.hotkeys ?? {})) {
    hotkeys[id] = binds.map((inputs) => inputs.map((i) => (i.kind === 'joy' ? { kind: 'joy', code: move(i.code) } : { ...i })));
  }
  return { hotkeys, lost: [...lost] };
}

/** The edits that change something: an edit equal to what the controls file already says is no edit (this is how edits
 *  disappear by themselves once the file has been imported in game). `fileBinds(id)` -> the file's binds as chords. */
export function activeEdits(hotkeys, fileBinds) {
  const out = {};
  for (const [id, binds] of Object.entries(hotkeys)) if (!bindsEqual(binds, fileBinds(id))) out[id] = binds;
  return out;
}
