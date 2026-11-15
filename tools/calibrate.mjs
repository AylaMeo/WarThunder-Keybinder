// Sanity check: do Azeron key outputs line up with the joyButton numbers in machine.blk?
//   node tools/calibrate.mjs <machine.blk> ["Azeron profile"]
import { readFileSync } from 'node:fs';
import { readControls, resolveBinds, readDeviceMapping } from '../lib/wtconfig.mjs';
import { readStore, readProfile } from '../lib/azeron.mjs';

const machine = process.argv[2];
if (!machine) { console.error('usage: node tools/calibrate.mjs <machine.blk> ["Azeron profile"]'); process.exit(1); }
const presets = JSON.parse(readFileSync(new URL('../data/presets.json', import.meta.url)));
const controls = readControls(machine);
const { effective, chain } = resolveBinds(controls, presets);
console.log('chain:', chain.join(' -> '));
const dev = readDeviceMapping(controls);
console.log(dev);
const az = dev.find((d) => /azeron/i.test(d.name) || /^16D0:/i.test(d.devId));
if (!az) { console.error('No Azeron in this file\'s deviceMapping (exported presets carry none: use the live machine.blk).'); process.exit(1); }
const prof = readProfile(readStore(), process.argv[3] ?? 'War Thunder V2');
console.log('azeron profile:', prof.name);

// joyButton -> action ids (WT side)
const joyMap = new Map();
for (const [id, binds] of effective) for (const b of binds) for (const i of b.inputs) if (i.kind === 'joy') {
  (joyMap.get(i.code) ?? joyMap.set(i.code, []).get(i.code)).push(id);
}
const joyKeys = Object.values(prof.keys).filter((k) => k.kind === 'joy');
for (const off of [az.buttonsOffset - 1, az.buttonsOffset, az.buttonsOffset + 1]) {
  const hits = joyKeys.filter((k) => joyMap.has(off + k.joyBtn)).length;
  console.log(`offset ${off}: ${hits}/${joyKeys.length} azeron joy-keys have a WT bind (joyButton = ${off} + btn)`);
}
// the app uses joyButton = buttonsOffset + btn - 1
const off = az.buttonsOffset - 1;
for (const k of joyKeys.sort((a, b) => a.id - b.id)) {
  const ids = joyMap.get(off + k.joyBtn) ?? [];
  console.log(`#${String(k.id).padStart(2)} btn${String(k.joyBtn).padStart(2)} -> joy${off + k.joyBtn}  WT: ${ids.join(', ') || '(nothing bound)'}`);
}
// WT joy binds that fall outside the Azeron range
const outside = [...joyMap.keys()].filter((c) => c < az.buttonsOffset || c >= az.buttonsOffset + az.buttonsCount).sort((a, b) => a - b);
console.log('joy codes outside the azeron range:', outside);
