// Which devices are on this PC, and what is skipped for the ones that are not. /api/state is called here, so everything it
// looks at is made up and sits in temp folders: the settings folder (WTKB_DATA_DIR), the Saves folder (WTKB_SAVES_DIR), and the
// folders the Azeron software and G HUB keep their files in (APPDATA / LOCALAPPDATA, pointed at empty temp folders for this
// test process only). Your own binds, Azeron profile and G HUB database are not opened.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tmp = (name) => mkdtempSync(join(tmpdir(), `wtkb-present-${name}-`));
const dataDir = tmp('data'), savesDir = tmp('saves'), appData = tmp('appdata'), localAppData = tmp('local');
process.env.WTKB_DATA_DIR = dataDir;
process.env.WTKB_SAVES_DIR = savesDir;
process.env.APPDATA = appData;
process.env.LOCALAPPDATA = localAppData;

const L = (...lines) => lines.join('\r\n') + '\r\n';
const AZERON_JOYSTICK = ['      joystick{', '        connected:b=yes', '        devId:t="16D0:12F7"', '        name:t="Azeron Keypad - DirectInput"',
  '        buttonsOffset:i=28', '        buttonsCount:i=36', '        axesOffset:i=7', '        axesCount:i=8', '      }'];
const OTHER_JOYSTICK = ['      joystick{', '        connected:b=yes', '        devId:t="044F:B10A"', '        name:t="T.16000M"',
  '        buttonsOffset:i=0', '        buttonsCount:i=16', '        axesOffset:i=0', '        axesCount:i=4', '      }'];
const machinePath = join(savesDir, '12345', 'production', 'machine.blk');
mkdirSync(join(savesDir, '12345', 'production'), { recursive: true });
/** The controls file the game wrote, with these joysticks in its deviceMapping. */
const writeMachine = (...joysticks) => writeFileSync(machinePath, L('version:i=144', '', 'content{', '  controls{', '    version:i=5', '',
  '    basePresetPaths{', '      default:t="config/hotkeys/hotkey.keyboard_ver2.blk"', '    }', '',
  '    hotkeys{', '      ID_FLAPS{', '        joyButton:i=30', '      }', '    }', '',
  '    deviceMapping{', ...joysticks.flat(), '    }', '  }', '}'));

const storePath = join(appData, 'azeron-software-v1', 'store.db');
const writeStore = () => {
  mkdirSync(join(appData, 'azeron-software-v1'), { recursive: true });
  const key = { id: 3, pinOne: 3, types: ['5', '11', '11'], keyValues: ['3', '0'], metaValues: ['0', '0'] };   // joystick button 3
  writeFileSync(storePath, JSON.stringify({ _id: 'a', setting: 'PROFILES', value: [{ id: 1, name: 'War Thunder V2', inputs: [key] }] }) + '\n');
};
const ghubPath = join(localAppData, 'LGHUB', 'settings.db');
const writeGHub = () => {
  mkdirSync(join(localAppData, 'LGHUB'), { recursive: true });
  const db = new DatabaseSync(ghubPath);
  try {
    db.exec('create table data (_id integer primary key, file blob)');
    db.prepare('insert into data (file) values (?)').run(Buffer.from(JSON.stringify({
      applications: { applications: [{ applicationId: 'app1', name: 'WAR THUNDER' }] },
      profiles: { profiles: [{ id: 'p1', applicationId: 'app1', name: 'PROFILE_NAME_DEFAULT' }] },
    })));
  } finally { db.close(); }
};

writeMachine(OTHER_JOYSTICK);
const { createServer } = await import('../server.mjs');
for (const f of readdirSync(dataDir)) rmSync(join(dataDir, f), { force: true });   // start without the settings seeded from the app folder

let server, port;
before(async () => {
  server = createServer({ cleanTemp: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); server.closeAllConnections();   // (fetch keeps its connection open for a few seconds otherwise)
  for (const d of [dataDir, savesDir, appData, localAppData]) rmSync(d, { recursive: true, force: true }); });

const state = async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/state`);
  assert.equal(r.status, 200);
  return r.json();
};
const about = (s, re) => s.warnings.filter((w) => re.test(w));

test('no Azeron and no G HUB: nothing of them is read, and that is not reported as a problem', async () => {
  const s = await state();
  assert.deepEqual(s.present, { azeron: false, ghub: false });
  assert.equal(s.azeron, null);
  assert.deepEqual(s.g502.ghubProfiles, []);
  assert.deepEqual(s.g502.ghubSlots, []);
  assert.deepEqual(about(s, /azeron|g hub/i), []);
  assert.ok(s.g502.cells.length > 0, 'the mouse panel does not depend on G HUB');
  assert.ok(s.items.length > 0 && s.layouts.keyboard.keys.length > 0, 'binds and the keyboard are shown as ever');
  writeMachine();   // no joystick of any kind (keyboard and mouse only): nothing to warn about either
  assert.deepEqual((await state()).warnings, []);
});

test('the game lists an Azeron, the Azeron software is not here: present, with one warning saying why its keys are missing', async () => {
  writeMachine(OTHER_JOYSTICK, AZERON_JOYSTICK);
  const s = await state();
  assert.deepEqual(s.present, { azeron: true, ghub: false });
  assert.equal(s.azeron, null);
  assert.equal(about(s, /azeron/i).length, 1);
  assert.match(about(s, /azeron/i)[0], /settings were not found/);
  assert.deepEqual(about(s, /g hub/i), []);
});

test('the Azeron software is here: its profile is read; an Azeron the game does not list is still warned about', async () => {
  writeStore();
  let s = await state();
  assert.equal(s.present.azeron, true);
  assert.equal(s.azeron.name, 'War Thunder V2');
  assert.equal(s.azeron.keys[3].joyCode, 30);            // buttonsOffset 28 + button 3 - 1
  assert.equal(s.azeron.device.devId, '16D0:12F7');
  assert.deepEqual(about(s, /azeron/i), []);
  writeMachine(OTHER_JOYSTICK);
  s = await state();
  assert.equal(s.present.azeron, true);
  assert.equal(s.azeron.device, null);
  assert.match(about(s, /azeron/i).join(), /not found in deviceMapping/);
});

test('G HUB is here: its profiles are read; a database that cannot be read is still reported', async () => {
  writeGHub();
  let s = await state();
  assert.equal(s.present.ghub, true);
  assert.deepEqual(s.g502.ghubProfiles, [{ id: 'p1', label: 'WAR THUNDER / Default' }]);
  assert.deepEqual(about(s, /g hub/i), []);
  writeFileSync(ghubPath, 'not a database');
  s = await state();
  assert.equal(s.present.ghub, true);
  assert.equal(about(s, /g hub/i).length, 1);
});

test('live input: with no joystick to read and no keys to watch, the input helper is not started', async () => {
  /** The first message of the live stream for this query. */
  const first = (query) => new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: `/api/live${query}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      res.once('data', (d) => { r.destroy(); resolve(JSON.parse(String(d).replace(/^data: /, ''))); });
    });
    r.on('error', reject);
  });
  assert.equal((await first('')).status, process.platform === 'win32' ? 'idle' : 'unsupported');
  assert.equal((await first('?vid=16D0&vks=')).status, process.platform === 'win32' ? 'idle' : 'unsupported');   // half a device id is no joystick
});
