import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hidToDik, keyName, mouseName } from './dik.mjs';

export const defaultDbPath = () => join(process.env.LOCALAPPDATA ?? '', 'LGHUB', 'settings.db');

// Built-in G HUB "system" cards for mouse buttons (4 hex digits of the card id).
// Only the standard Windows buttons are decoded; anything else is shown as its raw card code.
const BUILTIN = {
  '0201': { label: 'Left click', mouse: 0 },
  '0202': { label: 'Right click', mouse: 1 },
  '0203': { label: 'Middle click', mouse: 2 },
  '0204': { label: 'Back', mouse: 3 },
  '0205': { label: 'Forward', mouse: 4 },
};

/** Read-only: copies settings.db (+wal) to a temp dir first, so nothing in LGHUB is ever touched. */
function load(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`G HUB db not found: ${dbPath}`);
  const tmp = mkdtempSync(join(tmpdir(), 'wtkb-ghub-'));
  const copy = join(tmp, 'settings.db');
  copyFileSync(dbPath, copy);
  for (const ext of ['-wal', '-shm']) if (existsSync(dbPath + ext)) copyFileSync(dbPath + ext, copy + ext);
  const db = new DatabaseSync(copy, { readOnly: true });
  try {
    const row = db.prepare('select file from data order by _id desc limit 1').get();
    return JSON.parse(Buffer.from(row.file).toString('utf8'));
  } finally { db.close(); }
}

/** Every G HUB profile with the app it belongs to. */
export function listGHubProfiles(dbPath = defaultDbPath()) {
  const j = load(dbPath);
  const apps = j.applications?.applications ?? [];
  return (j.profiles?.profiles ?? []).map((p) => {
    const app = apps.find((a) => a.applicationId === p.applicationId);
    const appName = !app ? '?' : /^APPLICATION_NAME_DESKTOP$/.test(app.name) ? 'Desktop' : app.name;
    const pname = /^PROFILE_NAME_DEFAULT$/.test(p.name) ? 'Default' : p.name;
    return { id: p.id, label: `${appName} / ${pname}` };
  });
}

/** Decode a profile's mouse slots (g1.., scroll1..): [{slot,label,mouse?,key?,decoded}] */
export function readGHubProfile(profileId, dbPath = defaultDbPath(), model = 'g502x-lightspeed') {
  const j = load(dbPath);
  const profile = (j.profiles?.profiles ?? []).find((p) => p.id === profileId);
  if (!profile) throw new Error(`G HUB profile not found: ${profileId}`);
  const cards = Object.fromEntries((j.cards?.cards ?? []).map((c) => [c.id, c]));
  const re = new RegExp(`^${model}_(g\\d+|scroll\\d+)_m1(_shifted)?$`);
  const slots = [];
  for (const a of profile.assignments ?? []) {
    const m = a.slotId.match(re);
    if (!m || m[2]) continue;
    const hex = a.cardId.slice(-12, -8);
    const known = BUILTIN[hex];
    const card = cards[a.cardId];
    // 01xx = keystroke card, xx is the USB HID keyboard usage (inferred: 010c = I, 0133 = ';', 0134 = "'").
    // Exception from the user's G HUB screenshot: the thumb-top button shows `\` but its stored card is 010c, not the HID code of `\`.
    const dik = hex === '010c' ? 43 : hex.startsWith('01') ? hidToDik(parseInt(hex.slice(2), 16)) : null;
    slots.push({
      slot: m[1],
      label: card?.macro?.actionName ?? card?.name ?? known?.label ?? (dik != null ? `Key ${keyName(dik)}` : `G HUB ${hex}`),
      mouse: known?.mouse,
      key: dik ?? undefined,
      decoded: !!(known || dik != null),
    });
  }
  return slots.sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }));
}
export { mouseName };
