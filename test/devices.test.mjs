// The Azeron and G HUB readers, fed made-up data (no real device files are read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStore, listProfiles, readProfile, decodeFunction } from '../lib/azeron.mjs';
import { listGHubProfiles, readGHubProfile } from '../lib/ghub.mjs';
import { dikByName } from '../lib/dik.mjs';

const input = (id, type, kv = 0, meta = 0) => ({ id, pinOne: id, types: [String(type), '11', '11'], keyValues: [String(kv), '0'], metaValues: [String(meta), '0'] });

test('Azeron store: later lines replace earlier ones, deleted settings go away, torn lines are skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtkb-test-'));
  try {
    const file = join(dir, 'store.db');
    writeFileSync(file, [
      JSON.stringify({ _id: 'a', setting: 'PROFILES', value: [{ id: 1, name: 'Old', inputs: [] }] }),
      JSON.stringify({ _id: 'b', setting: 'GONE', value: 1 }),
      '{"_id":"c","setting":"TORN","val',
      JSON.stringify({ _id: 'a', setting: 'PROFILES', value: [{ id: 1, name: 'New', inputs: [] }, { id: 2, name: 'Second', inputs: [] }] }),
      JSON.stringify({ _id: 'b', $$deleted: true }),
      JSON.stringify({ $$indexCreated: { fieldName: 'setting' } }),
      '',
    ].join('\n'));
    const store = readStore(file);
    assert.deepEqual(listProfiles(store), [{ id: 1, name: 'New' }, { id: 2, name: 'Second' }]);
    assert.equal(store.has('GONE'), false);
    assert.equal(store.has('TORN'), false);
    assert.throws(() => readStore(join(dir, 'nope.db')), /not found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Azeron profile: each kind of key', () => {
  const store = new Map([['PROFILES', [{ id: 7, name: 'WT', inputs: [
    input(1, 5, 9),            // joystick button 9
    input(2, 1, 81),           // keyboard Q
    input(3, 1, 67, 17),       // Ctrl+C
    input(4, 1, 0, 16),        // Shift on its own
    input(5, 1, 135),          // F24: no DirectInput code
    input(6, 12, 90),          // thumb-pad right
    input(7, 3),               // analog stick
    input(8, 11),              // disabled
    input(9, 1),               // keyboard, nothing chosen
  ] }]]]);
  const { name, keys } = readProfile(store, 'WT');
  assert.equal(name, 'WT');
  assert.deepEqual([keys[1].kind, keys[1].joyBtn], ['joy', 9]);
  assert.deepEqual(keys[2].key, { code: dikByName('Q'), mods: [], vk: 81, modVk: null });
  assert.deepEqual(keys[3].key, { code: dikByName('C'), mods: [dikByName('LCtrl')], vk: 67, modVk: 17 });
  assert.deepEqual(keys[4].key, { code: dikByName('LShift'), mods: [], modOnly: true, vk: 16 });
  assert.deepEqual(keys[5].key, { code: null, mods: [], unknownVk: 135 });
  assert.deepEqual([keys[6].kind, keys[6].dir], ['dir', 90]);
  assert.equal(keys[7].kind, 'analog');
  for (const id of [8, 9]) assert.deepEqual([keys[id].kind, keys[id].assigned], ['none', false], `input ${id}`);
  for (const id of [1, 2, 3, 4, 5, 6, 7]) assert.equal(keys[id].assigned, true, `input ${id}`);
});

test('Azeron functions: every type a key can be given is decoded', () => {
  const f = decodeFunction;
  // what the game can see
  assert.deepEqual(f(5, { kv: 12 }), { kind: 'joy', joyBtn: 12 });
  assert.deepEqual(f(15, { kv: 1 }), { kind: 'mouse', mouse: 0 });   // Azeron numbers them left, middle, right, back, forward
  assert.deepEqual(f(15, { kv: 2 }), { kind: 'mouse', mouse: 2 });
  assert.deepEqual(f(15, { kv: 3 }), { kind: 'mouse', mouse: 1 });
  assert.deepEqual(f(15, { kv: 4 }), { kind: 'mouse', mouse: 3 });
  assert.deepEqual(f(15, { kv: 5 }), { kind: 'mouse', mouse: 4 });
  assert.deepEqual(f(29), { kind: 'wheel', wheel: 'up' });
  assert.deepEqual(f(30), { kind: 'wheel', wheel: 'down' });
  assert.deepEqual(f(35, { y: 1 }), { kind: 'wheel', wheel: 'up' });            // a key set to turn the wheel
  assert.deepEqual(f(35, { y: -3, x: 2 }), { kind: 'wheel', wheel: 'down' });
  assert.deepEqual(f(31, { subType: 1, kv: 81 }).key.code, dikByName('Q'));     // a wheel notch re-used as a key
  assert.deepEqual(f(31, { subType: 30 }), { kind: 'wheel', wheel: 'down' });
  assert.equal(f(12, { kv: 270 }).dir, 270);
  assert.equal(f(3).kind, 'analog');
  // what it cannot: named, and never matched to a bind
  const others = { 2: 'Profile switch', 4: 'Stick as keys', 16: 'Macro', 21: 'Xbox stick', 22: 'Xbox button', 23: 'Xbox trigger', 24: 'Switch profile', 33: 'DPI up', 37: 'Input sequence', 38: 'Media key', 40: 'Stick as mouse' };
  for (const [type, label] of Object.entries(others)) assert.deepEqual(f(Number(type), { kv: 5 }), { kind: 'other', label }, `type ${type}`);
  assert.deepEqual(f(35, { x: 1 }), { kind: 'other', label: 'Wheel sideways' });
  assert.deepEqual(f(15, { kv: 9 }), { kind: 'other', label: 'Mouse button 9' });
  assert.deepEqual(f(99), { kind: 'other', label: 'Azeron function 99' });       // a type a newer Azeron version might add
  // nothing
  for (const [type, v] of [[6], [11], [1, { kv: 0 }], [5, { kv: 0 }], [35, {}], [31, { subType: 31 }], [31, {}], [NaN], [0], [undefined]]) {
    assert.deepEqual(f(type, v), { kind: 'none' }, `type ${type}`);
  }
});

test('Azeron profile: long-press and double-press functions are read too', () => {
  const store = new Map([['PROFILES', [{ id: 1, name: 'P', inputs: [
    { id: 1, pinOne: 2, types: ['5', '1', '16'], keyValues: ['7'], metaValues: ['0'], keyValuesLong: ['81'], metaValuesLong: ['17'], keyValuesDouble: ['0'], metaValuesDouble: ['0'] },
    { id: 2, pinOne: 3, types: ['35', '35', '11'], y: 1, x: 0, yLong: -1, xLong: 0, keyValues: ['0'], keyValuesLong: ['0'] },
    { id: 3, pinOne: 4, types: ['11', '11', '15'], keyValues: ['0'], keyValuesDouble: ['4'] },
    { id: 4, pinOne: 5, types: ['1'], keyValues: ['65'] },
  ] }]]]);
  const { keys } = readProfile(store, 'P');
  assert.deepEqual([keys[1].kind, keys[1].joyBtn, keys[1].assigned], ['joy', 7, true]);
  assert.deepEqual(keys[1].alt.map((a) => [a.press, a.kind]), [['long', 'key'], ['double', 'other']]);
  assert.deepEqual(keys[1].alt[0].key, { code: dikByName('Q'), mods: [dikByName('LCtrl')], vk: 81, modVk: 17 });
  assert.equal(keys[1].alt[1].label, 'Macro');
  assert.deepEqual([keys[2].kind, keys[2].wheel], ['wheel', 'up']);
  assert.deepEqual(keys[2].alt, [{ press: 'long', kind: 'wheel', wheel: 'down' }]);
  assert.deepEqual([keys[3].kind, keys[3].assigned], ['none', false]);            // nothing on a plain press...
  assert.deepEqual(keys[3].alt, [{ press: 'double', kind: 'mouse', mouse: 3 }]);  // ...but a double press sends Mouse4
  assert.deepEqual(keys[4].alt, []);
});

test('Azeron profile: a name that no longer exists falls back to the active profile, else fails clearly', () => {
  const profiles = [{ id: 1, name: 'A', inputs: [] }, { id: 2, name: 'B', inputs: [] }];
  assert.equal(readProfile(new Map([['PROFILES', profiles], ['ACTIVE_PROFILE', 2]]), 'Renamed').name, 'B');
  assert.equal(readProfile(new Map([['PROFILES', profiles], ['ACTIVE_PROFILE', { id: 1 }]]), 'Renamed').name, 'A');
  assert.equal(readProfile(new Map([['PROFILES', profiles], ['ACTIVE_PROFILE', 'B']]), 'Renamed').name, 'B');
  assert.throws(() => readProfile(new Map([['PROFILES', profiles]]), 'Renamed'), /not found: Renamed/);
  assert.throws(() => readProfile(new Map(), 'X'), /not found/);
  assert.deepEqual(readProfile(new Map([['PROFILES', [{ id: 3, name: 'NoInputs' }]]]), 'NoInputs').keys, {});
});

const card = (hex) => `0f82f693-5b78-4cf5-867e-${hex}00000000`;
const GHUB = {
  applications: { applications: [{ applicationId: 'app1', name: 'WAR THUNDER' }, { applicationId: 'desk', name: 'APPLICATION_NAME_DESKTOP' }] },
  cards: { cards: [{ id: 'custom-1', name: 'My macro', macro: { actionName: 'Ctrl + Z' } }] },
  profiles: { profiles: [
    { id: 'p1', applicationId: 'app1', name: 'PROFILE_NAME_DEFAULT', assignments: [
      { slotId: 'g502x-lightspeed_g1_m1', cardId: card('0201') },
      { slotId: 'g502x-lightspeed_g4_m1', cardId: card('0204') },
      { slotId: 'g502x-lightspeed_g10_m1', cardId: card('0134') },
      { slotId: 'g502x-lightspeed_g5_m1', cardId: card('010c') },
      { slotId: 'g502x-lightspeed_g2_m1', cardId: card('0905') },
      { slotId: 'g502x-lightspeed_g7_m1', cardId: 'custom-1' },
      { slotId: 'g502x-lightspeed_scroll1_m1', cardId: card('0409') },
      { slotId: 'g502x-lightspeed_g1_m1_shifted', cardId: card('0907') },
      { slotId: 'g502x-lightspeed_mouse_settings', cardId: 'whatever' },
      { slotId: 'g733_g1_m1', cardId: card('016f') },
    ] },
    { id: 'p2', applicationId: 'desk', name: 'Work' },
    { id: 'p3', applicationId: 'unknown', name: 'Orphan', assignments: [{ slotId: 'g733_g1_m1', cardId: card('0203') }] },
  ] },
};

test('G HUB: profile list', () => {
  assert.deepEqual(listGHubProfiles(GHUB), [{ id: 'p1', label: 'WAR THUNDER / Default' }, { id: 'p2', label: 'Desktop / Work' }, { id: 'p3', label: '? / Orphan' }]);
  assert.deepEqual(listGHubProfiles({}), []);
});

test('G HUB: slots of the device with the most buttons, in natural order, G-shift layer ignored', () => {
  const slots = readGHubProfile(GHUB, 'p1');
  assert.deepEqual(slots.map((s) => s.slot), ['g1', 'g2', 'g4', 'g5', 'g7', 'g10', 'scroll1']);
  const by = Object.fromEntries(slots.map((s) => [s.slot, s]));
  assert.deepEqual(by.g1, { slot: 'g1', label: 'Left click', mouse: 0, key: undefined, decoded: true });
  assert.deepEqual(by.g4, { slot: 'g4', label: 'Back', mouse: 3, key: undefined, decoded: true });
  assert.deepEqual([by.g10.key, by.g10.decoded], [dikByName("'"), true]);        // 0134: HID usage 0x34
  assert.deepEqual([by.g5.key, by.g5.label], [dikByName('I'), 'Key I']);          // 010c: HID usage 0x0c
  assert.deepEqual([by.g2.decoded, by.g2.label], [false, 'G HUB 0905']);          // not a button or keystroke card
  assert.equal(by.g7.label, 'Ctrl + Z');                                          // a card with its own data
});

test('G HUB: a model can be named, and a card code can be overridden', () => {
  assert.deepEqual(readGHubProfile(GHUB, 'p1', { model: 'g733' }).map((s) => s.slot), ['g1']);
  assert.equal(readGHubProfile(GHUB, 'p1', { model: 'not-there' }).length, 7);     // unknown model: back to the default pick
  const g5 = readGHubProfile(GHUB, 'p1', { overrides: { '010c': 43 } }).find((s) => s.slot === 'g5');
  assert.deepEqual([g5.key, g5.label], [43, 'Key \\']);
  const bad = readGHubProfile(GHUB, 'p1', { overrides: { '010c': 'x' } }).find((s) => s.slot === 'g5');
  assert.equal(bad.key, dikByName('I'));                                          // an unusable override is ignored
});

test('G HUB: missing pieces', () => {
  assert.deepEqual(readGHubProfile(GHUB, 'p2'), []);
  assert.equal(readGHubProfile(GHUB, 'p3')[0].mouse, 2);
  assert.throws(() => readGHubProfile(GHUB, 'nope'), /profile not found/);
});
