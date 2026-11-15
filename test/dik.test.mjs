import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyName, dikByName, keyTable, vkToDik, dikToVk, hidToDik, mouseName, MOUSE_VK } from '../lib/dik.mjs';
import { keyboardLayout, keyboardChoices } from '../lib/kblayout.mjs';

test('names and codes agree both ways', () => {
  for (const [code, name] of keyTable()) {
    assert.equal(keyName(code), name);
    assert.equal(dikByName(name), code, name);
  }
  assert.equal(new Set(keyTable().map(([, n]) => n)).size, keyTable().length, 'no two keys share a name');
  assert.equal(keyName(999), 'Key999');
  assert.equal(dikByName('NoSuchKey'), undefined);
});

test('Windows virtual-keys -> DirectInput', () => {
  const cases = { 65: 'A', 90: 'Z', 48: '0', 57: '9', 112: 'F1', 123: 'F12', 124: 'F13', 126: 'F15', 96: 'Num0', 105: 'Num9',
    13: 'Enter', 27: 'Esc', 32: 'Space', 44: 'PrtSc', 16: 'LShift', 161: 'RShift', 17: 'LCtrl', 163: 'RCtrl', 18: 'LAlt', 165: 'RAlt',
    186: ';', 222: "'", 220: '\\', 192: '`', 37: 'Left', 39: 'Right' };
  for (const [vk, name] of Object.entries(cases)) assert.equal(keyName(vkToDik(Number(vk))), name, `vk ${vk}`);
  for (const vk of [0, 7, 127, 135, 255, 9999]) assert.equal(vkToDik(vk), null, `vk ${vk}`);   // F16+ have no DirectInput code
});

test('DirectInput -> virtual-key (used to ask Windows whether a key is down)', () => {
  assert.equal(dikToVk(dikByName('Q')), 81);
  assert.equal(dikToVk(dikByName('PrtSc')), 44);
  assert.equal(dikToVk(dikByName('NumEnter')), 13);
  assert.equal(dikToVk(dikByName('F13')), 124);
  assert.equal(dikToVk(999), null);
  for (const [code, name] of keyTable()) {
    const vk = dikToVk(code);
    if (vk != null && name !== 'NumEnter') assert.equal(vkToDik(vk), code, name);
  }
});

test('USB HID usages -> DirectInput', () => {
  const cases = { 0x04: 'A', 0x0c: 'I', 0x1d: 'Z', 0x1e: '1', 0x26: '9', 0x27: '0', 0x28: 'Enter', 0x31: '\\', 0x33: ';', 0x34: "'",
    0x3a: 'F1', 0x45: 'F12', 0x68: 'F13', 0x6a: 'F15', 0x4f: 'Right', 0x52: 'Up' };
  for (const [u, name] of Object.entries(cases)) assert.equal(keyName(hidToDik(Number(u))), name, `usage ${u}`);
  assert.equal(hidToDik(0), null);
  assert.equal(hidToDik(0xe0), null);
});

test('mouse buttons', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 9].map(mouseName), ['LMB', 'RMB', 'MMB', 'Mouse4', 'Mouse5', 'Mouse8', 'Mouse10']);
  assert.deepEqual(MOUSE_VK, { 0: 1, 1: 2, 2: 4, 3: 5, 4: 6 });
});

test('every keyboard layout builds, fits its frame and has no overlapping keys', () => {
  assert.ok(keyboardChoices.length >= 7);
  for (const { id, name } of keyboardChoices) {
    const L = keyboardLayout(id);
    assert.equal(L.id, id);
    assert.equal(L.name, name);
    const fixed = L.keys.filter((k) => k.d != null).map((k) => k.d);
    assert.equal(new Set(fixed).size, fixed.length, `${id}: a key appears twice`);
    for (const k of L.keys) {
      assert.ok(k.x >= 0 && k.y >= 0 && k.x + k.w <= L.w + 1e-9 && k.y + k.h <= L.h + 1e-9, `${id}: ${k.l} is outside the board`);
    }
    for (let a = 0; a < L.keys.length; a++) for (let b = a + 1; b < L.keys.length; b++) {
      const p = L.keys[a], q = L.keys[b];
      const overlap = p.x < q.x + q.w - 1e-9 && q.x < p.x + p.w - 1e-9 && p.y < q.y + q.h - 1e-9 && q.y < p.y + p.h - 1e-9;
      assert.ok(!overlap, `${id}: ${p.l} overlaps ${q.l}`);
    }
  }
});

test('an unknown keyboard layout falls back to full size', () => {
  for (const id of ['nope', undefined, null, 'constructor', '__proto__', 42]) assert.equal(keyboardLayout(id).id, 'full', String(id));
});
