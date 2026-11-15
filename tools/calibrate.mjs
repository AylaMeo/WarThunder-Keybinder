// Sanity check: do Azeron key outputs line up with the joyButton numbers in machine.blk?
import { readFileSync } from 'node:fs';
import { readControls, resolveBinds, readDeviceMapping } from '../lib/wtconfig.mjs';
import { readStore, readProfile } from '../lib/azeron.mjs';

const machine = process.argv[2];
const presets = JSON.parse(readFileSync(new URL('../data/presets.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url))).items;
const controls = readControls(machine);
const { effective, chain } = resolveBinds(controls, presets);
console.log('chain:', chain.join(' -> '));
const dev = readDeviceMapping(controls);
console.log(dev);
const az = dev.find((d) => /azeron/i.test(d.name ?? '') || /16D0/i.test(d.devId ?? ''));
const prof = readProfile(readStore(), process.argv[3] ?? 'War Thunder V2');

// joyButton -> action ids (WT side)
const joyMap = new Map();
for (const [id, binds] of effective) for (const b of binds) for (const i of b.inputs) if (i.kind === 'joy') {
  (joyMap.get(i.code) ?? joyMap.set(i.code, []).get(i.code)).push(id);
}
for (const off of [az.buttonsOffset - 1, az.buttonsOffset, az.buttonsOffset + 1]) {
  let hits = 0, tot = 0;
  for (const k of Object.values(prof.keys)) if (k.joyBtn) { tot++; if (joyMap.has(off + k.joyBtn)) hits++; }
  console.log(`offset ${off}: ${hits}/${tot} azeron joy-keys have a WT bind (joyButton = ${off} + btn)`);
}
const off = az.buttonsOffset - 1;
for (const k of Object.values(prof.keys).filter((k) => k.joyBtn).sort((a, b) => a.id - b.id)) {
  const ids = joyMap.get(off + k.joyBtn) ?? [];
  console.log(`#${String(k.id).padStart(2)} btn${String(k.joyBtn).padStart(2)} -> joy${off + k.joyBtn}  [${k.label}]  WT: ${ids.join(', ')}`);
}
// WT joy binds that fall outside the Azeron range
const out = [...joyMap.keys()].filter((c) => c < az.buttonsOffset - 1 || c > az.buttonsOffset + az.buttonsCount);
console.log('joy codes outside azeron range:', out);
