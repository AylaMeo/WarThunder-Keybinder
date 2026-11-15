import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hidToDik, keyName } from './dik.mjs';

export const defaultDbPath = () => join(process.env.LOCALAPPDATA ?? '', 'LGHUB', 'settings.db');
/** Is G HUB set up on this PC? (Just a look at whether its settings file is there: nothing is copied or opened.) */
export const hasGHub = (dbPath = defaultDbPath()) => existsSync(dbPath);

const TMP_PREFIX = 'wtkb-ghub-';
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const remove = (dir) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* still locked: the next start-up sweep gets it */ } };

// Built-in G HUB "system" cards for mouse buttons (4 hex digits of the card id).
// Only the standard Windows buttons are decoded; anything else is shown as its raw card code.
const BUILTIN = {
  '0201': { label: 'Left click', mouse: 0 },
  '0202': { label: 'Right click', mouse: 1 },
  '0203': { label: 'Middle click', mouse: 2 },
  '0204': { label: 'Back', mouse: 3 },
  '0205': { label: 'Forward', mouse: 4 },
};

let cache = null;   // { key, json }: the db is only copied and parsed again when it (or its write-ahead log) changed

/** Read-only: copies settings.db (+wal) to a temp dir first, so nothing in LGHUB is ever touched. The copy is deleted straight after. */
export function loadGHub(dbPath = defaultDbPath()) {
  if (!existsSync(dbPath)) throw new Error(`G HUB db not found: ${dbPath}`);
  const key = [dbPath, mtime(dbPath), mtime(dbPath + '-wal')].join('|');
  if (cache?.key === key) return cache.json;
  const tmp = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  try {
    const copy = join(tmp, 'settings.db');
    copyFileSync(dbPath, copy);
    for (const ext of ['-wal', '-shm']) if (existsSync(dbPath + ext)) copyFileSync(dbPath + ext, copy + ext);
    const db = new DatabaseSync(copy, { readOnly: true });
    let json;
    try {
      const row = db.prepare('select file from data order by _id desc limit 1').get();
      if (!row?.file) throw new Error('G HUB db holds no settings');
      json = JSON.parse(Buffer.from(row.file).toString('utf8'));
    } finally { db.close(); }
    cache = { key, json };
    return json;
  } finally { remove(tmp); }
}

/** Removes temp copies an earlier version (or a crashed run) left behind. Only this app's own, and only ones older than a minute. */
export function cleanStaleCopies(maxAgeMs = 60_000) {
  let n = 0;
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(TMP_PREFIX)) continue;
      const dir = join(tmpdir(), name);
      const age = Date.now() - mtime(dir);
      if (age > maxAgeMs) { remove(dir); n++; }
    }
  } catch { /* temp dir unreadable: nothing to clean */ }
  return n;
}

/** Every G HUB profile with the app it belongs to. `j` = loadGHub(). */
export function listGHubProfiles(j) {
  const apps = j.applications?.applications ?? [];
  return (j.profiles?.profiles ?? []).map((p) => {
    const app = apps.find((a) => a.applicationId === p.applicationId);
    const appName = !app ? '?' : /^APPLICATION_NAME_DESKTOP$/.test(app.name) ? 'Desktop' : app.name;
    const pname = /^PROFILE_NAME_DEFAULT$/.test(p.name) ? 'Default' : p.name;
    return { id: p.id, label: `${appName} / ${pname}` };
  });
}

/**
 * Decode a profile's button slots (g1.., scroll1..): [{slot,label,mouse?,key?,decoded}]. `j` = loadGHub().
 *   model      G HUB device prefix of the slots (e.g. "g502x-lightspeed"). Default: the device with the most button slots in the profile.
 *   overrides  { "<4 hex digits of the card id>": DirectInput scancode } for cards whose inferred key is wrong on your set-up.
 */
export function readGHubProfile(j, profileId, { model, overrides } = {}) {
  const profile = (j.profiles?.profiles ?? []).find((p) => p.id === profileId);
  if (!profile) throw new Error(`G HUB profile not found: ${profileId}`);
  const cards = Object.fromEntries((j.cards?.cards ?? []).map((c) => [c.id, c]));
  const byModel = new Map();
  for (const a of profile.assignments ?? []) {
    const m = String(a.slotId ?? '').match(/^(.+)_(g\d+|scroll\d+)_m1$/);   // (the "_shifted" G-shift layer is not read)
    if (m) (byModel.get(m[1]) ?? byModel.set(m[1], []).get(m[1])).push({ slot: m[2], cardId: String(a.cardId ?? '') });
  }
  const pick = model && byModel.has(model) ? model : [...byModel].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const slots = [];
  for (const { slot, cardId } of byModel.get(pick) ?? []) {
    const hex = cardId.slice(-12, -8).toLowerCase();
    const known = BUILTIN[hex];
    const card = cards[cardId];
    // Built-in cards carry no data of their own, only the id. 01xx = keystroke card where xx is the USB HID keyboard usage
    // (inferred: 0133 = ';', 0134 = "'"). Where that guess is wrong for a card, config.json's ghubKeyOverrides corrects it.
    const forced = overrides?.[hex];
    const dik = Number.isInteger(forced) ? forced : hex.startsWith('01') ? hidToDik(parseInt(hex.slice(2), 16)) : null;
    slots.push({
      slot,
      label: card?.macro?.actionName ?? card?.name ?? known?.label ?? (dik != null ? `Key ${keyName(dik)}` : `G HUB ${hex}`),
      mouse: known?.mouse,
      key: dik ?? undefined,
      decoded: !!(known || dik != null),
    });
  }
  return slots.sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }));
}
