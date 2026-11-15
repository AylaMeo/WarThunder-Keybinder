// The file written for the game's "Import from file". Made-up data only; nothing is read from or written to disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport } from '../lib/wtexport.mjs';
import { parseBlk, block, blocks } from '../lib/blk.mjs';
import { readHotkeys, readDeviceMapping } from '../lib/wtconfig.mjs';

const L = (...lines) => lines.join('\r\n') + '\r\n';
const CONTROLS = [
  'controls{',
  '  version:i=5',
  '  appliedFallbacksVer:i=3',
  '',
  '  basePresetPaths{',
  '    default:t="config/hotkeys/hotkey.keyboard_ver2.blk"',
  '  }',
  '',
  '  hotkeys{',
  '    ID_AAM{',
  '      keyboardKey:i=56',
  '      keyboardKey:i=29',
  '    }',
  '',
  '    ID_AAM{',
  '      mouseButton:i=4',
  '    }',
  '',
  '    ID_BOMBS{',
  '      joyButton:i=30',
  '      activationType:t="hold"',
  '    }',
  '',
  '    ID_BOMBS{',
  '      keyboardKey:i=57',
  '    }',
  '',
  '    ID_SWIPE{',
  '      gesture:i=2',
  '    }',
  '',
  '    ID_TARGET_CAMERA{}',
  '    ID_ZOOM{',
  '      joyButton:i=43',
  '    }',
  '  }',
  '',
  '  axes{',
  '    gm_throttle{',
  '      axisId:i=9',
  '      innerDeadzone:r=2.1e-05',
  '      inverse:b=yes',
  '    }',
  '  }',
  '',
  '  params{',
  '    mouseJoystick:b=false',
  '  }',
  '',
  '  deviceMapping{',
  '    joystick{',
  '      connected:b=yes',
  '      devId:t="16D0:12F7\\x"',
  '      name:t="Azeron Keypad - DirectInput"',
  '      buttonsOffset:i=28',
  '      buttonsCount:i=36',
  '      axesOffset:i=7',
  '      axesCount:i=8',
  '    }',
  '  }',
  '}',
];
const indent = (lines) => lines.map((l) => (l ? `  ${l}` : l));
const MACHINE = L('version:i=144', '', 'content{', '  machineId:t="abc"', '', ...indent(CONTROLS), '',
  '  settings{', '    forceGain:r=0.75', '    renderer:t="dx12"', '    invertY:b=yes', '    zoomSens:r=1e-03', '  }', '}');
const EXPORT = L(...CONTROLS, '', 'settings{', '  invertY:b=no', '  forceGain:r=1', '  notInMachine:b=yes', '  zoomSens:i=1', '}');
const k = (code) => ({ kind: 'key', code });
const j = (code) => ({ kind: 'joy', code });
const m = (code) => ({ kind: 'mouse', code });
const hotkeys = (text) => readHotkeys(block(parseBlk(text), 'controls'));
const shown = (text, id) => (hotkeys(text).get(id) ?? []).map((b) => b.inputs.map((i) => `${i.kind}:${i.code}`).join('+'));

test('no edits: the controls block comes out exactly as it went in', () => {
  const { text, changed, settings } = buildExport({ sourceText: MACHINE, edits: {} });
  assert.equal(text, L(...CONTROLS));          // un-nested from content{}, otherwise character for character
  assert.equal(changed, 0);
  assert.equal(settings, 'none');
  assert.equal(buildExport({ sourceText: EXPORT, edits: {} }).text, EXPORT);
});

test('reordering keeps each bind\'s own block, with what the game stored in it', () => {
  const { text } = buildExport({ sourceText: MACHINE, edits: { ID_BOMBS: [[k(57)], [j(30)]], ID_AAM: [[m(4)], [k(56), k(29)]] } });
  assert.deepEqual(shown(text, 'ID_BOMBS'), ['key:57', 'joy:30']);
  assert.deepEqual(shown(text, 'ID_AAM'), ['mouse:4', 'key:56+key:29']);
  const hk = block(block(parseBlk(text), 'controls'), 'hotkeys');
  assert.deepEqual(blocks(hk, 'ID_BOMBS')[1].entries.map((e) => `${e.k}=${e.raw}`), ['joyButton=30', 'activationType="hold"']);
  // nothing else moved: the file holds the very same lines, only in another order
  const rest = (t) => t.split('\r\n').filter((l) => l.trim());
  assert.deepEqual(rest(text).sort(), rest(L(...CONTROLS)).sort());
});

test('changed, added and removed binds', () => {
  const { text, changed } = buildExport({ sourceText: MACHINE, edits: {
    ID_AAM: [[k(29), j(43)]],          // one new chord instead of the two old binds
    ID_ZOOM: [],                       // unbound on purpose
    ID_FLARES: [[k(33)], [m(3)]],      // not in the file yet (its binds came from the preset)
    ID_AAA_FIRST: [[k(2)]],
    ID_ZZZ_LAST: [[k(3)]],
  } });
  assert.equal(changed, 5);
  assert.deepEqual(shown(text, 'ID_AAM'), ['key:29+joy:43']);
  assert.deepEqual(hotkeys(text).get('ID_ZOOM'), []);
  assert.match(text, /\r\n {4}ID_ZOOM\{\}\r\n/);
  assert.deepEqual(shown(text, 'ID_FLARES'), ['key:33', 'mouse:3']);
  const ids = block(block(parseBlk(text), 'controls'), 'hotkeys').entries.map((e) => e.k);
  assert.deepEqual(ids, [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'hotkeys stay sorted by name, as the game writes them');
  assert.deepEqual(shown(text, 'ID_BOMBS'), ['joy:30', 'key:57']);   // untouched
  assert.match(text, /innerDeadzone:r=2\.1e-05\r\n/);                 // values the app does not model are not reformatted
  assert.equal(readDeviceMapping(block(parseBlk(text), 'controls'))[0].devId, '16D0:12F7x');
  assert.match(text, /devId:t="16D0:12F7\\x"\r\n/);
});

test('a bind this app cannot show (a gesture) survives an edit of its action', () => {
  const { text } = buildExport({ sourceText: MACHINE, edits: { ID_SWIPE: [[k(30)]] } });
  const got = blocks(block(block(parseBlk(text), 'controls'), 'hotkeys'), 'ID_SWIPE').map((b) => b.entries.map((e) => `${e.k}=${e.v}`).join());
  assert.deepEqual(got, ['keyboardKey=30', 'gesture=2']);
  const none = buildExport({ sourceText: MACHINE, edits: { ID_SWIPE: [] } }).text;
  assert.equal(blocks(block(block(parseBlk(none), 'controls'), 'hotkeys'), 'ID_SWIPE').length, 1);
  assert.match(none, /gesture:i=2/);
});

test('settings block: taken from the live file, for the keys a real export lists', () => {
  const { text, settings } = buildExport({ sourceText: MACHINE, edits: { ID_ZOOM: [] }, templateText: EXPORT });
  assert.equal(settings, 'live');
  // the export's selection and order, machine.blk's current values; a key machine.blk lacks (or holds as another type) is left out
  assert.ok(text.endsWith(L('}', '', 'settings{', '  invertY:b=yes', '  forceGain:r=0.75', '}')));
  assert.ok(!text.includes('renderer'), 'settings the game does not export stay out of the file');
  assert.ok(!text.includes('machineId'));
  // an export as the source keeps its own block untouched, template or not
  const own = buildExport({ sourceText: EXPORT, edits: { ID_ZOOM: [] }, templateText: MACHINE });
  assert.equal(own.settings, 'kept');
  assert.ok(own.text.endsWith(L('settings{', '  invertY:b=no', '  forceGain:r=1', '  notInMachine:b=yes', '  zoomSens:i=1', '}')));
});

test('bad input is refused, not written', () => {
  assert.throws(() => buildExport({ sourceText: 'nothing{}', edits: {} }), /controls/);
  assert.throws(() => buildExport({ sourceText: MACHINE, edits: { ID_X: [[{ kind: 'hat', code: 1 }]] } }), /ID_X/);
  assert.throws(() => buildExport({ sourceText: MACHINE, edits: { ID_X: [[{ kind: 'key', code: '1; evil{}' }]] } }), /ID_X/);
});

test('a file with no hotkeys block yet gets one', () => {
  const { text } = buildExport({ sourceText: L('controls{', '  version:i=5', '', '  basePresetPaths{', '    default:t="x"', '  }', '}'), edits: { ID_A: [[k(30)]] } });
  assert.deepEqual(shown(text, 'ID_A'), ['key:30']);
});
