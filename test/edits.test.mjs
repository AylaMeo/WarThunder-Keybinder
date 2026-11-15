import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBinds, rebaseEdits, activeEdits, bindsEqual, deviceSnapshot, MAX_BINDS, MAX_CHORD } from '../lib/edits.mjs';

const k = (code) => ({ kind: 'key', code });
const j = (code) => ({ kind: 'joy', code });
const m = (code) => ({ kind: 'mouse', code });

test('cleanBinds: keeps order, strips anything extra', () => {
  assert.deepEqual(cleanBinds([[{ kind: 'key', code: 29, text: 'LCtrl', junk: 1 }, k(46)], [j(40)], [m(4)]]), [[k(29), k(46)], [j(40)], [m(4)]]);
  assert.deepEqual(cleanBinds([]), []);   // unbound
});

test('cleanBinds: refuses what the game could not hold', () => {
  const bad = [
    'nope', null, [[]], [k(30)], [['x']], [[{ kind: 'hat', code: 1 }]], [[{ kind: 'key', code: 0 }]], [[{ kind: 'key', code: 256 }]],
    [[{ kind: 'key', code: 1.5 }]], [[{ kind: 'key', code: '30' }]], [[{ kind: 'joy', code: -1 }]], [[{ kind: 'mouse', code: 16 }]],
    [[{ kind: '__proto__', code: 1 }]], [[{ kind: 'constructor', code: 1 }]],
    [[k(30), k(30)]],                                   // the same key twice in one chord
    [[k(29), k(46)], [k(46), k(29)]],                   // the same chord twice (order does not matter in game)
    Array.from({ length: MAX_BINDS + 1 }, (_, i) => [k(30 + i)]),
    [Array.from({ length: MAX_CHORD + 1 }, (_, i) => k(30 + i))],
  ];
  for (const b of bad) assert.throws(() => cleanBinds(b), Error, JSON.stringify(b));
});

test('bindsEqual and activeEdits: an edit equal to the file is no edit', () => {
  assert.ok(bindsEqual([[k(1)], [j(2)]], [[k(1)], [j(2)]]));
  assert.ok(!bindsEqual([[k(1)], [j(2)]], [[j(2)], [k(1)]]));   // order is the whole point
  assert.ok(!bindsEqual([[k(1)]], []));
  const file = { ID_A: [[k(1)], [j(2)]], ID_B: [] };
  const edits = { ID_A: [[k(1)], [j(2)]], ID_B: [], ID_C: [], ID_D: [[m(3)]], ID_E: [[j(2)], [k(1)]] };
  assert.deepEqual(Object.keys(activeEdits(edits, (id) => file[id] ?? [])), ['ID_D', 'ID_E']);
});

test('rebaseEdits: joystick codes follow their device when the numbering shifts', () => {
  const then = [{ devId: 'PAD', buttonsOffset: 0, buttonsCount: 28 }, { devId: '16D0:12F7', buttonsOffset: 28, buttonsCount: 36 }];
  const saved = { devices: then, hotkeys: { ID_A: [[k(29), j(43)], [j(3)]], ID_B: [[m(4)]] } };
  // same devices: nothing moves
  assert.deepEqual(rebaseEdits(saved, then), { hotkeys: saved.hotkeys, lost: [] });
  // the pad was unplugged: the Azeron now starts at 0
  const now = [{ devId: '16D0:12F7', buttonsOffset: 0, buttonsCount: 36, name: 'Azeron' }];
  assert.deepEqual(rebaseEdits(saved, now), { hotkeys: { ID_A: [[k(29), j(15)], [j(3)]], ID_B: [[m(4)]] }, lost: ['PAD'] });
  // no numbering stored (or junk): codes are left alone
  assert.deepEqual(rebaseEdits({ hotkeys: saved.hotkeys }, now).hotkeys, saved.hotkeys);
  assert.deepEqual(rebaseEdits({ devices: 'x', hotkeys: saved.hotkeys }, now).hotkeys, saved.hotkeys);
  assert.deepEqual(rebaseEdits(null, now), { hotkeys: {}, lost: [] });
  assert.deepEqual(deviceSnapshot([...now, { devId: 'x' }, null]), [{ devId: '16D0:12F7', buttonsOffset: 0, buttonsCount: 36 }]);
});
