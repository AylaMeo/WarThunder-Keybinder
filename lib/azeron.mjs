import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { vkToDik } from './dik.mjs';

export const defaultStorePath = () => join(process.env.APPDATA ?? '', 'azeron-software-v1', 'store.db');

/** store.db is a NeDB append-only log (one JSON doc per line, later lines win). Read-only. */
export function readStore(path = defaultStorePath()) {
  if (!existsSync(path)) throw new Error(`Azeron store not found: ${path}`);
  const settings = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.$$deleted) continue;
      if (d.setting != null) settings.set(d.setting, d.value);
    } catch { /* torn line */ }
  }
  return settings;
}

export const listProfiles = (settings) => (settings.get('PROFILES') ?? []).map((p) => ({ id: p.id, name: p.name }));

/**
 * Normalise one Azeron profile into key descriptors.
 *   type 5  -> joystick button `btn` (1-based within the Azeron device)
 *   type 12 -> thumbstick direction (value = degrees)
 *   others  -> reported raw
 */
export function readProfile(settings, name) {
  const prof = (settings.get('PROFILES') ?? []).find((p) => p.name === name);
  if (!prof) throw new Error(`Azeron profile not found: ${name}`);
  const keys = {};
  for (const inp of prof.inputs) {
    const type = Number(inp.types?.[0]);
    const kv = Number(inp.keyValues?.[0]);
    const meta = Number(inp.metaValues?.[0] ?? 0);
    // Azeron's own labels are deliberately NOT read: labels are set in this app, per layer.
    const k = { id: inp.id, pin: inp.pinOne, type, kv, kind: 'none' };
    if (type === 5) { k.kind = 'joy'; k.joyBtn = kv; }                 // joystick button (1-based on the Azeron device)
    else if (type === 1) {                                              // keyboard: kv = Windows virtual-key, meta = modifier VK
      const code = kv ? vkToDik(kv) : null;
      const mod = meta ? vkToDik(meta) : null;
      if (kv === 0 && mod != null) { k.kind = 'key'; k.key = { code: mod, mods: [], modOnly: true, vk: meta }; }
      else if (code != null) { k.kind = 'key'; k.key = { code, mods: mod != null ? [mod] : [], vk: kv, modVk: mod != null ? meta : null }; }
      else if (kv) { k.kind = 'key'; k.key = { code: null, mods: [], unknownVk: kv }; }
    }
    else if (type === 12) { k.kind = 'dir'; k.dir = kv; }               // thumbstick direction
    else if (type === 3) { k.kind = 'analog'; }
    k.assigned = k.kind !== 'none';
    keys[inp.id] = k;
  }
  return { name: prof.name, keys };
}
