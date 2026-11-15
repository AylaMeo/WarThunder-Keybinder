import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { vkToDik } from './dik.mjs';

export const defaultStorePath = () => join(process.env.APPDATA ?? '', 'azeron-software-v1', 'store.db');
/** Has the Azeron software ever saved its settings on this PC? (Just a look at whether the file is there: nothing is opened.) */
export const hasStore = (path = defaultStorePath()) => existsSync(path);

/** store.db is a NeDB append-only log (one JSON doc per line, later lines win). Read-only. */
export function readStore(path = defaultStorePath()) {
  if (!existsSync(path)) throw new Error(`Azeron store not found: ${path}`);
  const docs = new Map();   // _id -> latest doc (a later line replaces or deletes an earlier one)
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.$$deleted) { docs.delete(d._id); continue; }
      if (d.setting != null) docs.set(d._id ?? `setting:${d.setting}`, d);
    } catch { /* torn line */ }
  }
  return new Map([...docs.values()].map((d) => [d.setting, d.value]));
}

export const listProfiles = (settings) => (settings.get('PROFILES') ?? []).map((p) => ({ id: p.id, name: p.name }));

// What an Azeron key can be set to do. The numbers are the Azeron software's own function types (its `types` field); any of
// them can sit on any key, and a key has up to three: press, long press, double press.
const TYPE = {
  KEY: 1, SWITCH: 2, ANALOG: 3, STICK_KEYS: 4, DINPUT: 5, DISABLED: 6, NONE: 11, DPAD: 12, MOUSE: 15,
  WHEEL_UP: 29, WHEEL_DOWN: 30, WHEEL_TRIGGER: 31, BUTTON_WHEEL: 35,
};
// Functions the game cannot bind as such (or that never reach it): shown by name, never matched to a bind.
const OTHER = {
  2: 'Profile switch', 4: 'Stick as keys', 7: 'Stick key (up)', 8: 'Stick key (right)', 9: 'Stick key (down)', 10: 'Stick key (left)',
  13: 'Toggle analog', 14: 'Toggle analog (hold)', 16: 'Macro', 17: 'Stick key (up)', 18: 'Stick key (right)', 19: 'Stick key (down)', 20: 'Stick key (left)',
  21: 'Xbox stick', 22: 'Xbox button', 23: 'Xbox trigger', 24: 'Switch profile', 25: 'Stick key (up)', 26: 'Stick key (right)', 27: 'Stick key (down)', 28: 'Stick key (left)',
  32: 'Profile wheel', 33: 'DPI up', 34: 'DPI down', 36: 'Analog wheel', 37: 'Input sequence', 38: 'Media key', 39: 'Xbox stick + keys', 40: 'Stick as mouse',
};
// Azeron's mouse-button numbers (1 left, 2 middle, 3 right, 4 back, 5 forward) -> War Thunder's mouseButton (0 left, 1 right, 2 middle, 3, 4).
const MOUSE_BUTTON = { 1: 0, 2: 2, 3: 1, 4: 3, 5: 4 };

/**
 * One function of a key -> what it sends:
 *   { kind:'joy', joyBtn }                joystick button (1-based within the Azeron device)
 *   { kind:'key', key:{code,mods,...} }   keyboard key (code = DirectInput scancode), optionally with a modifier
 *   { kind:'dir', dir }                   thumb-pad direction as a hat switch (degrees)
 *   { kind:'analog' }                     the analog stick as joystick axes
 *   { kind:'mouse', mouse }               mouse button (War Thunder numbering)
 *   { kind:'wheel', wheel:'up'|'down' }   one notch of the mouse wheel
 *   { kind:'other', label }               anything else the key does (macro, Xbox button, profile switch, ...)
 *   { kind:'none' }                       nothing (disabled / not set)
 * `v` = that function's own values: { kv, meta, x, y, subType }.
 */
export function decodeFunction(type, v = {}) {
  const kv = Number(v.kv) || 0;
  const meta = Number(v.meta) || 0;
  switch (type) {
    case TYPE.DINPUT: return kv > 0 ? { kind: 'joy', joyBtn: kv } : { kind: 'none' };
    case TYPE.KEY: {                                                      // kv = Windows virtual-key, meta = modifier VK
      const code = kv ? vkToDik(kv) : null;
      const mod = meta ? vkToDik(meta) : null;
      if (kv === 0 && mod != null) return { kind: 'key', key: { code: mod, mods: [], modOnly: true, vk: meta } };
      if (code != null) return { kind: 'key', key: { code, mods: mod != null ? [mod] : [], vk: kv, modVk: mod != null ? meta : null } };
      if (kv) return { kind: 'key', key: { code: null, mods: [], unknownVk: kv } };
      return { kind: 'none' };
    }
    case TYPE.DPAD: return { kind: 'dir', dir: kv };
    case TYPE.ANALOG: return { kind: 'analog' };
    case TYPE.MOUSE: return MOUSE_BUTTON[kv] != null ? { kind: 'mouse', mouse: MOUSE_BUTTON[kv] } : { kind: 'other', label: `Mouse button ${kv}` };
    case TYPE.WHEEL_UP: return { kind: 'wheel', wheel: 'up' };
    case TYPE.WHEEL_DOWN: return { kind: 'wheel', wheel: 'down' };
    case TYPE.BUTTON_WHEEL: {                                             // a key that turns the wheel: y = notches up (+) / down (-), x = sideways
      const y = Number(v.y) || 0;
      if (y) return { kind: 'wheel', wheel: y > 0 ? 'up' : 'down' };
      return (Number(v.x) || 0) ? { kind: 'other', label: 'Wheel sideways' } : { kind: 'none' };
    }
    case TYPE.WHEEL_TRIGGER: {                                            // a wheel notch re-used for another function (named by subType)
      const sub = Number(v.subType);
      return sub && sub !== TYPE.WHEEL_TRIGGER ? decodeFunction(sub, { ...v, subType: 0 }) : { kind: 'none' };
    }
    case TYPE.DISABLED: case TYPE.NONE: return { kind: 'none' };
    default: return Object.hasOwn(OTHER, type) ? { kind: 'other', label: OTHER[type] } : Number.isFinite(type) && type > 0 ? { kind: 'other', label: `Azeron function ${type}` } : { kind: 'none' };
  }
}

/**
 * Normalise one Azeron profile into key descriptors: { id, pin, type, kv, ...decodeFunction(press), assigned, alt }.
 * `alt` lists what the key does on a long press / double press, when set: [{ press:'long'|'double', ...decodeFunction() }].
 */
export function readProfile(settings, name) {
  const all = settings.get('PROFILES') ?? [];
  let prof = all.find((p) => p.name === name);
  if (!prof) {
    // renamed or deleted in the Azeron software: fall back to the profile that is active there, if that can be told
    const act = settings.get('ACTIVE_PROFILE');
    const ref = act && typeof act === 'object' ? act.id ?? act.name : act;
    prof = ref == null ? null : all.find((p) => p.id === ref || p.name === ref);
  }
  if (!prof) throw new Error(`Azeron profile not found: ${name}`);
  const keys = {};
  for (const inp of prof.inputs ?? []) {
    const type = Number(inp.types?.[0]);
    const kv = Number(inp.keyValues?.[0]);
    // Azeron's own labels are deliberately NOT read: labels are set in this app, per layer.
    const k = { id: inp.id, pin: inp.pinOne, type, kv, ...decodeFunction(type, { kv, meta: inp.metaValues?.[0], x: inp.x, y: inp.y, subType: inp.subType }) };
    k.assigned = k.kind !== 'none';
    k.alt = [];
    for (const [i, press, sfx] of [[1, 'long', 'Long'], [2, 'double', 'Double']]) {
      const f = decodeFunction(Number(inp.types?.[i]), { kv: inp[`keyValues${sfx}`]?.[0], meta: inp[`metaValues${sfx}`]?.[0], x: inp[`x${sfx}`], y: inp[`y${sfx}`] });
      if (f.kind !== 'none') k.alt.push({ press, ...f });
    }
    keys[inp.id] = k;
  }
  return { name: prof.name, keys };
}
