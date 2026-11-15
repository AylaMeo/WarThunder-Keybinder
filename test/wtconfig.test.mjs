import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlk, block } from '../lib/blk.mjs';
import { readHotkeys, readAxes, readDeviceMapping, resolveBinds, basePreset, describeBinding } from '../lib/wtconfig.mjs';

const controls = (text) => block(parseBlk(`controls{ ${text} }`), 'controls');
const bind = (...inputs) => ({ inputs: inputs.map(([kind, code]) => ({ kind, code })) });

test('readHotkeys: single keys, chords, several binds, explicit unbind', () => {
  const hk = readHotkeys(controls(`hotkeys{
    ID_FIRE{ joyButton:i=30 }
    ID_FIRE{ keyboardKey:i=57 }
    ID_ZOOM{ keyboardKey:i=29; keyboardKey:i=46 }
    ID_AIR_BRAKE{}
    ID_MOUSE{ mouseButton:i=4 }
  }`));
  assert.deepEqual(hk.get('ID_FIRE'), [bind(['joy', 30]), bind(['key', 57])]);
  assert.deepEqual(hk.get('ID_ZOOM'), [bind(['key', 29], ['key', 46])]);   // order kept: modifier first, trigger last
  assert.deepEqual(hk.get('ID_AIR_BRAKE'), []);                            // present but empty = unbound on purpose
  assert.deepEqual(hk.get('ID_MOUSE'), [bind(['mouse', 4])]);
  assert.equal(hk.has('ID_NOT_THERE'), false);
});

test('readHotkeys: codes that are not whole numbers never get through', () => {
  const hk = readHotkeys(controls(`hotkeys{
    ID_A{ joyButton:t="1\\"><img src=x onerror=alert(1)>" }
    ID_B{ keyboardKey:i=oops }
    ID_C{ keyboardKey:r=1.5 }
    ID_D{ keyboardKey:i=-3 }
    ID_E{ keyboardKey:i=30; joyButton:t="x" }
  }`));
  for (const id of ['ID_A', 'ID_B', 'ID_C', 'ID_D']) assert.deepEqual(hk.get(id), [], id);
  assert.deepEqual(hk.get('ID_E'), [bind(['key', 30])]);
  for (const binds of hk.values()) for (const b of binds) for (const i of b.inputs) assert.ok(Number.isInteger(i.code));
});

test('readAxes and readDeviceMapping return clean numbers', () => {
  const c = controls(`
    axes{ throttle{ axisId:i=3; inverse:b=yes } wheel{ mouseAxisId:i=2 } odd{ axisId:t="x" } }
    deviceMapping{ joystick{ name:t="Azeron Keypad"; devId:t="16D0:12F7"; buttonsOffset:i=28; buttonsCount:i=36; axesOffset:i=6; axesCount:i=4; connected:b=yes }
                   joystick{ name:t="Broken"; buttonsOffset:t="nope" } }`);
  assert.deepEqual(readAxes(c), {
    throttle: { axisId: 3, mouseAxisId: null, inverse: true },
    wheel: { axisId: null, mouseAxisId: 2, inverse: false },
    odd: { axisId: null, mouseAxisId: null, inverse: false },
  });
  const [az, broken] = readDeviceMapping(c);
  assert.deepEqual(az, { devId: '16D0:12F7', name: 'Azeron Keypad', buttonsOffset: 28, buttonsCount: 36, axesOffset: 6, axesCount: 4, connected: true });
  assert.deepEqual(broken, { devId: '', name: 'Broken', buttonsOffset: 0, buttonsCount: 0, axesOffset: 0, axesCount: 0, connected: false });
});

const PRESETS = {
  ver2: { base: 'ver1', hotkeys: { ID_FIRE: [bind(['key', 57])], ID_GEAR: [bind(['key', 34])] }, axes: { throttle: { axisId: 1, mouseAxisId: null, inverse: false } } },
  ver1: { base: null, hotkeys: { ID_FIRE: [bind(['key', 28])], ID_FLAPS: [bind(['key', 33])], ID_BOMB: [bind(['key', 48])] }, axes: {} },
  loopA: { base: 'loopB', hotkeys: { ID_A: [bind(['key', 30])] }, axes: {} },
  loopB: { base: 'loopA', hotkeys: { ID_B: [bind(['key', 48])] }, axes: {} },
};

test('resolveBinds: defaults, newer preset wins, your file wins over both, empty block unbinds', () => {
  const c = controls(`
    basePresetPaths{ default:t="config/hotkeys/hotkey.ver2.blk" }
    hotkeys{ ID_GEAR{ joyButton:i=40 } ID_BOMB{} }
    axes{ throttle{ axisId:i=7 } }`);
  assert.equal(basePreset(c), 'ver2');
  const { effective, origin, axes, chain } = resolveBinds(c, PRESETS);
  assert.deepEqual(chain, ['ver1', 'ver2', '(your config)']);
  assert.deepEqual(effective.get('ID_FLAPS'), [bind(['key', 33])]);   // only in the oldest preset
  assert.deepEqual(effective.get('ID_FIRE'), [bind(['key', 57])]);    // ver2 replaces ver1
  assert.deepEqual(effective.get('ID_GEAR'), [bind(['joy', 40])]);    // your file replaces the preset
  assert.deepEqual(effective.get('ID_BOMB'), []);                     // explicitly unbound
  assert.equal(origin.get('ID_FLAPS'), 'ver1');
  assert.equal(origin.get('ID_FIRE'), 'ver2');
  assert.equal(origin.get('ID_GEAR'), '(your config)');
  assert.equal(axes.throttle.axisId, 7);
});

test('resolveBinds: unknown preset, preset loop, odd preset names', () => {
  const missing = resolveBinds(controls('basePresetPaths{ default:t="hotkey.gone.blk" } hotkeys{ ID_X{ keyboardKey:i=2 } }'), PRESETS);
  assert.deepEqual(missing.chain, ['gone (MISSING)', '(your config)']);
  assert.deepEqual(missing.effective.get('ID_X'), [bind(['key', 2])]);

  const loop = resolveBinds(controls('basePresetPaths{ default:t="hotkey.loopA.blk" }'), PRESETS);
  assert.deepEqual(loop.chain, ['loopB', 'loopA', '(your config)']);   // stops instead of going round forever

  const proto = resolveBinds(controls('basePresetPaths{ default:t="hotkey.constructor.blk" }'), PRESETS);
  assert.deepEqual(proto.chain, ['constructor (MISSING)', '(your config)']);   // not something inherited from Object

  assert.deepEqual(resolveBinds(controls(''), PRESETS).chain, ['(your config)']);
});

test('describeBinding names the inputs', () => {
  assert.equal(describeBinding(bind(['key', 29], ['key', 46])), 'LCtrl + C');
  assert.equal(describeBinding(bind(['joy', 43], ['mouse', 4])), 'JOY43 + Mouse5');
});
