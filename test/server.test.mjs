// The server's request checks and its four write endpoints. Settings go to a temp folder (WTKB_DATA_DIR). /api/state is not
// called, so binds, the Azeron profile and the G HUB database are not opened; /api/stamp and the controls-file check do look
// for control files in Saves/ (as the app does on every start) and read the modification times of the device files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'wtkb-test-'));
process.env.WTKB_DATA_DIR = dataDir;
const { createServer } = await import('../server.mjs');
// A new settings folder starts with copies of the settings in the app folder (yours, when run from the project). Check that that
// happened for whichever exist, then start every test from an empty folder so the results don't depend on your settings.
const SETTINGS = ['config.json', 'ui.json', 'labels.json', 'mouse-layout.json'];
const seeded = SETTINGS.filter((f) => existsSync(join(dataDir, f)));
const shipped = SETTINGS.filter((f) => existsSync(new URL(`../${f}`, import.meta.url)));
for (const f of SETTINGS) rmSync(join(dataDir, f), { force: true });
const saved = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

test('a new settings folder is seeded from the app folder', () => assert.deepEqual(seeded, shipped));

let server, port;
before(async () => {
  server = createServer({ cleanTemp: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });

/** Raw request, so the Host / Origin / Sec-Fetch-Site headers can be forged. */
const req = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject);
  if (body != null) r.write(body);
  r.end();
});
const post = (path, obj, headers = {}) => req(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj) });

test('static files: served with security headers, nothing outside public/', async () => {
  const page = await req('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal((await req('/app.js')).status, 200);
  assert.equal((await req('/style.css')).status, 200);
  for (const p of ['/..%2f..%2fserver.mjs', '/..%5c..%5cserver.mjs', '/%2e%2e/package.json', '/nope.js', '/data/catalog.json']) assert.equal((await req(p)).status, 404, p);
  assert.equal((await req('/%E0%A4%A')).status, 400);   // malformed escape: a clean refusal, not a crash
});

test('the API only answers this app\'s own page', async () => {
  const ok = { status: 200 };
  assert.equal((await req('/api/stamp')).status, ok.status);
  assert.equal((await req('/api/stamp', { headers: { origin: `http://127.0.0.1:${port}` } })).status, 200);
  assert.equal((await req('/api/stamp', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await req('/api/stamp', { headers: { 'sec-fetch-site': 'none' } })).status, 200);               // typed into the address bar
  const refused = [
    { host: 'evil.example' },                                       // DNS rebinding
    { host: `evil.example:${port}` },
    { origin: 'http://evil.example' },                              // another website's script
    { origin: `http://localhost:${port + 1}` },                     // another local server
    { origin: 'null' },                                             // sandboxed page / file://
    { origin: 'not a url' },
    { 'sec-fetch-site': 'cross-site' },                             // <img> / <script> tag on another site (sends no Origin)
    { 'sec-fetch-site': 'same-site' },
  ];
  for (const headers of refused) assert.equal((await req('/api/stamp', { headers })).status, 403, JSON.stringify(headers));
  assert.equal((await post('/api/labels', { dev: 'az', key: '1', layer: 'air', text: 'x' }, { origin: 'http://evil.example' })).status, 403);
  assert.equal(existsSync(join(dataDir, 'labels.json')), false, 'a refused request must not write anything');
});

test('labels: saved per device / key / layer, emptied ones removed', async () => {
  assert.equal((await post('/api/labels', { dev: 'az', key: '36', layer: 'air', text: '  Bino  ' })).status, 200);
  assert.equal((await post('/api/labels', { dev: 'az', key: '36', layer: 'ground', text: 'Smoke' })).status, 200);
  assert.equal((await post('/api/labels', { dev: 'kb', key: 'g:Fn', layer: 'common', text: 'x'.repeat(100) })).status, 200);
  assert.deepEqual(saved('labels.json'), { az: { 36: { air: 'Bino', ground: 'Smoke' } }, kb: { 'g:Fn': { common: 'x'.repeat(60) } } });
  assert.equal((await post('/api/labels', { dev: 'az', key: '36', layer: 'air', text: '' })).status, 200);
  assert.equal((await post('/api/labels', { dev: 'az', key: '36', layer: 'ground', text: '   ' })).status, 200);
  assert.deepEqual(saved('labels.json').az, {});
});

test('labels: bad targets are refused and cannot reach Object.prototype', async () => {
  const bad = [
    { dev: 'az', key: '__proto__', layer: 'air', text: 'polluted' },
    { dev: 'az', key: 'constructor', layer: 'air', text: 'polluted' },
    { dev: 'az', key: 'prototype', layer: 'air', text: 'polluted' },
    { dev: '__proto__', key: '1', layer: 'air', text: 'polluted' },
    { dev: 'az', key: '1', layer: '__proto__', text: 'polluted' },
    { dev: 'az', key: '1', layer: 'moon', text: 'x' },
    { dev: 'az', key: '', layer: 'air', text: 'x' },
    { dev: 'az', key: '<img src=x>', layer: 'air', text: 'x' },
    { dev: 'az', key: 'k'.repeat(41), layer: 'air', text: 'x' },
    { dev: 'az', layer: 'air', text: 'x' },
  ];
  for (const b of bad) assert.equal((await post('/api/labels', b)).status, 400, JSON.stringify(b));
  assert.equal(({}).air, undefined);
  assert.equal(Object.air, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);
});

test('config: only known settings, and only a controls file the app found itself', async () => {
  assert.equal((await post('/api/config', { azeronProfile: 'My profile', keyboardLayout: 'tkl', stickCal: '{"xi":0}', evil: 'x', machine: 'auto' })).status, 200);
  assert.deepEqual(saved('config.json'), { machine: 'auto', azeronProfile: 'My profile', ghubProfile: '', keyboardLayout: 'tkl', stickCal: '{"xi":0}' });
  for (const machine of ['C:\\Windows\\win.ini', '/etc/passwd', '..\\..\\secret.blk', '']) {
    assert.equal((await post('/api/config', { machine })).status, 400, machine);
  }
  assert.equal((await post('/api/config', { keyboardLayout: 'nope', azeronProfile: 42 })).status, 200);   // ignored, not an error
  assert.deepEqual(saved('config.json'), { machine: 'auto', azeronProfile: 'My profile', ghubProfile: '', keyboardLayout: 'tkl', stickCal: '{"xi":0}' });
});

test('ui: unknown fields are dropped, numbers are clamped', async () => {
  assert.equal((await post('/api/ui', { tab: 'ground', compact: true, common: 'yes', extra: ['air', 'moon', 'air'], showThrough: null,
    overlayOpacity: 5, overlayPrev: { compact: false, w: 99999, opacity: 9, junk: 1 }, junk: { a: 1 }, __proto__: { x: 1 } })).status, 200);
  assert.deepEqual(saved('ui.json'), { tab: 'ground', compact: true, extra: ['air'], showThrough: null, overlayOpacity: 35, overlayPrev: { compact: false, w: 8000, opacity: 1 } });
  // device panels: stacked or side by side, nothing else
  assert.equal((await post('/api/ui', { deviceFlow: 'row' })).status, 200);
  assert.deepEqual(saved('ui.json'), { deviceFlow: 'row' });
  assert.equal((await post('/api/ui', { deviceFlow: 'wrap' })).status, 200);
  assert.deepEqual(saved('ui.json'), { deviceFlow: 'wrap' });
  for (const deviceFlow of ['diagonal', '', 5, null]) {
    assert.equal((await post('/api/ui', { deviceFlow })).status, 200);
    assert.deepEqual(saved('ui.json'), {}, String(deviceFlow));
  }
  // keyboard key size: as big as the Azeron's keys, or small to fit
  for (const kbSize of ['azeron', 'fit']) {
    assert.equal((await post('/api/ui', { kbSize })).status, 200);
    assert.deepEqual(saved('ui.json'), { kbSize });
  }
  assert.equal((await post('/api/ui', { kbSize: 'huge' })).status, 200);
  assert.deepEqual(saved('ui.json'), {});
  // panel sizes: whole percentages within sensible limits
  assert.equal((await post('/api/ui', { sizeAzeron: 125, sizeKeyboard: 79.6, sizeMouse: 5, sizeOther: 100 })).status, 200);
  assert.deepEqual(saved('ui.json'), { sizeAzeron: 125, sizeKeyboard: 80, sizeMouse: 40 });
  assert.equal((await post('/api/ui', { sizeAzeron: 9999, sizeKeyboard: '150', sizeMouse: null })).status, 200);
  assert.deepEqual(saved('ui.json'), { sizeAzeron: 250 });
});

test('mouse layout: cleaned and validated', async () => {
  const cells = [
    { id: 'lmb', label: 'Left', c: 1, r: 0, mouse: 0, vk: 1, junk: true },
    { id: 'k', label: '', c: 99, r: -4, key: 43 },
    { id: 'none', label: 'Side', c: '2', r: 1.9 },
    { id: 'both', label: 'x'.repeat(50), c: 0, r: 0, mouse: 3, key: 30 },
    { id: 'range', label: 'Bad code', c: 0, r: 0, mouse: 16 },
  ];
  assert.equal((await post('/api/mouse-layout', { cells })).status, 200);
  assert.deepEqual(saved('mouse-layout.json'), [
    { id: 'lmb', label: 'Left', c: 1, r: 0, mouse: 0 },
    { id: 'k', label: 'k', c: 7, r: 0, key: 43 },
    { id: 'none', label: 'Side', c: 2, r: 1 },
    { id: 'both', label: 'x'.repeat(30), c: 0, r: 0, mouse: 3 },
    { id: 'range', label: 'Bad code', c: 0, r: 0 },
  ]);
  const bad = [
    { cells: 'nope' },
    { cells: [{ id: 'a' }, { id: 'a' }] },
    { cells: [null] },
    { cells: [{ id: '__proto__' }] },
    { cells: [{ id: '"><script>' }] },
    { cells: Array.from({ length: 41 }, (_, i) => ({ id: `b${i}` })) },
  ];
  for (const b of bad) assert.equal((await post('/api/mouse-layout', b)).status, 400, JSON.stringify(b).slice(0, 60));
  assert.equal(saved('mouse-layout.json').length, 5, 'a refused layout must not replace the saved one');
});

test('other requests', async () => {
  assert.equal((await post('/api/nope', {})).status, 404);
  assert.equal((await req('/api/labels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })).status, 400);
  assert.equal((await req('/api/config')).status, 404);   // write endpoints answer POST only
  assert.deepEqual(readdirSync(dataDir).filter((f) => f.endsWith('.tmp')), [], 'no half-written temp files are left behind');
});
