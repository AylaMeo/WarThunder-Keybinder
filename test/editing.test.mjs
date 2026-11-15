// Bind edits and the file written for the game's "Import from file". Everything happens in temp folders: the settings folder
// (WTKB_DATA_DIR) and a made-up Saves folder (WTKB_SAVES_DIR). Your own Saves folder, binds and device files are not opened
// (/api/state is not called).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBlk, block } from '../lib/blk.mjs';
import { readHotkeys } from '../lib/wtconfig.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'wtkb-edit-data-'));
const savesDir = mkdtempSync(join(tmpdir(), 'wtkb-edit-saves-'));
process.env.WTKB_DATA_DIR = dataDir;
process.env.WTKB_SAVES_DIR = savesDir;

const L = (...lines) => lines.join('\r\n') + '\r\n';
const machineText = (bombs) => L('version:i=144', '', 'content{', '  machineId:t="abc"', '',
  '  controls{', '    version:i=5', '    appliedFallbacksVer:i=3', '',
  '    basePresetPaths{', '      default:t="config/hotkeys/hotkey.keyboard_ver2.blk"', '    }', '',
  '    hotkeys{', ...bombs.flatMap((line) => ['      ID_BOMBS{', `        ${line}`, '      }', '']),
  '      ID_FLAPS{', '        joyButton:i=40', '      }', '    }', '',
  '    deviceMapping{', '      joystick{', '        connected:b=yes', '        devId:t="16D0:12F7"', '        name:t="Azeron Keypad - DirectInput"',
  '        buttonsOffset:i=28', '        buttonsCount:i=36', '        axesOffset:i=7', '        axesCount:i=8', '      }', '    }', '  }', '',
  '  settings{', '    forceGain:r=0.75', '    renderer:t="dx12"', '    invertY:b=yes', '  }', '}');
const MACHINE = machineText(['joyButton:i=30', 'keyboardKey:i=57']);
const machinePath = join(savesDir, '12345', 'production', 'machine.blk');
mkdirSync(join(savesDir, '12345', 'production'), { recursive: true });
writeFileSync(machinePath, MACHINE);
// a file "exported by the game" earlier, with other values: only its list of settings keys may be used
writeFileSync(join(savesDir, 'my-export.blk'), L('controls{', '  version:i=5', '', '  hotkeys{', '    ID_BOMBS{', '      keyboardKey:i=2', '    }', '  }', '}', '', 'settings{', '  invertY:b=no', '  forceGain:r=1', '}'));

const { createServer } = await import('../server.mjs');
for (const f of readdirSync(dataDir)) rmSync(join(dataDir, f), { force: true });   // start without the settings seeded from the app folder
const edits = () => JSON.parse(readFileSync(join(dataDir, 'edits.json'), 'utf8'));
const exported = () => readdirSync(savesDir).filter((f) => f.startsWith('wtkb-')).sort();

let server, port;
before(async () => {
  server = createServer({ cleanTemp: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); rmSync(savesDir, { recursive: true, force: true }); });

const post = (path, obj, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() }));
  });
  r.on('error', reject);
  r.end(JSON.stringify(obj));
});
const k = (code) => ({ kind: 'key', code });
const j = (code) => ({ kind: 'joy', code });

const config = () => JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'));

test('bind editing is off until it is switched on in Settings', async () => {
  // off by default: nothing is saved and no file is written
  for (const r of [await post('/api/edits', { set: { ID_BOMBS: [[k(57)], [j(30)]] } }), await post('/api/edits', { clear: true }), await post('/api/export', {})]) {
    assert.equal(r.status, 400);
    assert.match(r.json.error, /switched off/);
  }
  assert.equal(existsSync(join(dataDir, 'edits.json')), false);
  assert.deepEqual(exported(), []);
  // only a real true switches it on
  for (const bindEditing of ['true', 1, 'yes', null]) assert.equal((await post('/api/config', { bindEditing })).status, 200);
  assert.equal(config().bindEditing, undefined);
  assert.equal((await post('/api/edits', { set: { ID_BOMBS: [[k(57)], [j(30)]] } })).status, 400);
  assert.equal((await post('/api/config', { bindEditing: true })).status, 200);
  assert.equal(config().bindEditing, true);
  assert.equal((await post('/api/edits', { set: { ID_BOMBS: [[k(57)], [j(30)]] } })).status, 200);
  // off again: the edits made so far are kept, but nothing can be changed or exported
  assert.equal((await post('/api/config', { bindEditing: false })).status, 200);
  assert.equal(config().bindEditing, undefined);
  assert.equal((await post('/api/edits', { clear: true })).status, 400);
  assert.equal((await post('/api/export', {})).status, 400);
  assert.deepEqual(edits().hotkeys, { ID_BOMBS: [[k(57)], [j(30)]] });
  assert.deepEqual(exported(), []);
  // on for the tests that follow, starting without edits
  assert.equal((await post('/api/config', { bindEditing: true })).status, 200);
  assert.equal((await post('/api/edits', { clear: true })).status, 200);
});

test('edits: saved per action, with the joystick numbering they were made against', async () => {
  assert.equal((await post('/api/edits', { set: { ID_BOMBS: [[{ ...k(57), text: 'Space', junk: 1 }], [j(30)]] } })).status, 200);
  assert.deepEqual(edits(), { devices: [{ devId: '16D0:12F7', buttonsOffset: 28, buttonsCount: 36 }], hotkeys: { ID_BOMBS: [[k(57)], [j(30)]] } });
  // a second action; the first one stays
  assert.equal((await post('/api/edits', { set: { ID_FLAPS: [] } })).status, 200);
  assert.deepEqual(Object.keys(edits().hotkeys).sort(), ['ID_BOMBS', 'ID_FLAPS']);
  // null puts an action back to what the file says; an edit that equals the file is not kept either
  assert.equal((await post('/api/edits', { set: { ID_FLAPS: null, ID_BOMBS: [[j(30)], [k(57)]] } })).status, 200);
  assert.deepEqual(edits().hotkeys, {});
  assert.equal((await post('/api/edits', { set: { ID_FLAPS: [[j(40)]] } })).status, 200);   // exactly the file's bind
  assert.deepEqual(edits().hotkeys, {});
});

test('edits: only real actions and binds the game could hold', async () => {
  assert.equal((await post('/api/edits', { set: { ID_BOMBS: [[k(57)], [j(30)]] } })).status, 200);
  const before = readFileSync(join(dataDir, 'edits.json'), 'utf8');
  const bad = [
    { set: { ID_NOT_A_REAL_ACTION: [[k(30)]] } },
    { set: { throttle: [[k(30)]] } },                                   // an axis, not a shortcut
    { set: { __proto__: [[k(30)]] } },
    { set: { ID_BOMBS: 'x' } },
    { set: { ID_BOMBS: [[]] } },
    { set: { ID_BOMBS: [[{ kind: 'hat', code: 1 }]] } },
    { set: { ID_BOMBS: [[{ kind: 'key', code: '57' }]] } },
    { set: { ID_BOMBS: [[k(57), k(57)]] } },
    { set: { ID_BOMBS: [[k(1)], [k(2)], [k(3)], [k(4)]] } },             // the game keeps three
    { set: { ID_BOMBS: [[k(1), k(2), k(3), k(4)]] } },
    { set: { ID_FLAPS: [[k(30)]], ID_BOMBS: [[{ kind: 'key', code: 999 }]] } },   // one bad entry refuses the whole request
  ];
  for (const b of bad.slice(0, 2).concat(bad.slice(3))) assert.equal((await post('/api/edits', b)).status, 400, JSON.stringify(b));
  assert.equal((await post('/api/edits', JSON.parse('{"set":{"__proto__":[[{"kind":"key","code":30}]]}}'))).status, 400);
  assert.equal((await post('/api/edits', { set: { ID_BOMBS: [] } }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await post('/api/export', {}, { origin: 'http://evil.example' })).status, 403);
  assert.equal(readFileSync(join(dataDir, 'edits.json'), 'utf8'), before, 'a refused request must not change the edits');
  assert.deepEqual(exported(), []);
  assert.equal(({}).ID_BOMBS, undefined);
});

test('export: a new file in Saves, the game\'s own files untouched', async () => {
  assert.equal((await post('/api/edits', { set: { ID_BOMBS: [[k(57)], [j(30)]], ID_FLARES: [[k(29), k(33)]] } })).status, 200);
  const r = await post('/api/export', { file: '..\\..\\evil.blk', dir: 'C:\\Windows', text: 'x' });   // nothing from the page is used
  assert.equal(r.status, 200);
  assert.match(r.json.file, /^wtkb-\d{4}-\d\d-\d\d-\d{4}\.blk$/);
  assert.equal(r.json.changed, 2);
  assert.equal(r.json.settings, 'live');
  assert.deepEqual(exported(), [r.json.file]);
  const text = readFileSync(join(savesDir, r.json.file), 'utf8');
  const hk = readHotkeys(block(parseBlk(text), 'controls'));
  const shown = (id) => hk.get(id).map((b) => b.inputs.map((i) => `${i.kind}:${i.code}`).join('+'));
  assert.deepEqual(shown('ID_BOMBS'), ['key:57', 'joy:30']);
  assert.deepEqual(shown('ID_FLARES'), ['key:29+key:33']);
  assert.deepEqual(shown('ID_FLAPS'), ['joy:40']);
  assert.ok(text.startsWith('controls{\r\n  version:i=5\r\n'));
  assert.match(text, /devId:t="16D0:12F7"/);                                        // the numbering the joystick codes belong to
  assert.ok(text.endsWith(L('settings{', '  invertY:b=yes', '  forceGain:r=0.75', '}')));   // the export's keys, the live values
  assert.ok(!text.includes('renderer') && !text.includes('machineId'));
  // the same minute again: another file, never an overwrite
  const again = await post('/api/export', {});
  assert.equal(again.status, 200);
  assert.notEqual(again.json.file, r.json.file);
  assert.equal(exported().length, 2);
  assert.equal(readFileSync(join(savesDir, r.json.file), 'utf8'), text);
  // nothing the game owns was touched, and nothing else appeared
  assert.equal(readFileSync(machinePath, 'utf8'), MACHINE);
  assert.deepEqual(readdirSync(join(savesDir, '12345', 'production')), ['machine.blk']);
  assert.deepEqual(readdirSync(savesDir).filter((f) => !f.startsWith('wtkb-')).sort(), ['12345', 'my-export.blk']);
  assert.ok(!existsSync(join(savesDir, '..', 'evil.blk')));
});

test('after the import: edits the file now contains drop out by themselves', async () => {
  // what the game would save once the exported file was imported (bomb binds swapped; flares still to come)
  writeFileSync(machinePath, machineText(['keyboardKey:i=57', 'joyButton:i=30']));
  assert.equal((await post('/api/edits', { set: {} })).status, 200);
  assert.deepEqual(edits().hotkeys, { ID_FLARES: [[k(29), k(33)]] });
  assert.equal((await post('/api/edits', { clear: true })).status, 200);
  assert.deepEqual(edits().hotkeys, {});
  const none = await post('/api/export', {});
  assert.equal(none.status, 400);
  assert.match(none.json.error, /no edited binds/);
  assert.equal(exported().length, 2);
});

test('a hand-edited edits.json cannot smuggle anything in', async () => {
  writeFileSync(join(dataDir, 'edits.json'), JSON.stringify({ devices: 'junk', hotkeys: { ID_BOMBS: [[k(30)]], ID_FAKE: [[k(31)]], ID_FLAPS: [[{ kind: 'key', code: '1}evil{' }]], throttle: [[k(32)]] } }));
  const r = await post('/api/export', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.changed, 1);
  const text = readFileSync(join(savesDir, r.json.file), 'utf8');
  assert.ok(!text.includes('ID_FAKE') && !text.includes('evil') && !text.includes('throttle'));
  assert.deepEqual(readdirSync(dataDir).filter((f) => f.endsWith('.tmp')), []);
});
