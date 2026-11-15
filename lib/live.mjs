// Live input for the "press a key, see it light up" feature. Runs tools/input-helper.ps1 and fans its output out to SSE clients.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'input-helper.ps1');
const MAX_RESTARTS = 5;   // in a row, without the helper ever reporting in

export function createLive() {
  const clients = new Set();
  let child = null;
  let sig = '';
  let spec = null;
  const blank = (status) => ({ status, joy: 0, vks: [], pov: 65535, axes: [32767, 32767, 32767, 32767, 32767, 32767] });
  let state = blank('idle');
  let stopTimer = null;
  let restartTimer = null;
  let fails = 0;

  const broadcast = () => { const msg = `data: ${JSON.stringify(state)}\n\n`; for (const res of clients) res.write(msg); };

  function stop() {
    clearTimeout(restartTimer);
    const c = child;
    child = null;                       // first, so the dying helper's last output and exit event are ignored
    if (c) { c.removeAllListeners(); c.stdout?.removeAllListeners(); c.kill(); }
    sig = ''; spec = null; fails = 0;
    state = blank('idle');
  }

  function start() {
    if (process.platform !== 'win32') { state = blank('unsupported'); return; }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-ParentPid', String(process.pid)];
    if (spec.vid && spec.pid) args.push('-VendorId', spec.vid, '-ProductId', spec.pid);
    if (spec.vks.length) args.push('-Vks', spec.vks.join(','));
    state = blank('starting');
    const c = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child = c;
    let buf = '';
    c.stdout.on('data', (d) => {
      if (child !== c) return;          // output of a helper that has been replaced
      buf += d;
      let i;
      let changed = false;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        // (trim() above removes the trailing space of an empty "K " release line, so match on the first letter only)
        const rest = line.slice(1).trim();
        if (line[0] === 'S') { state = { ...state, status: rest }; changed = true; fails = 0; }
        else if (line[0] === 'J') { state = { ...state, joy: Number(rest) | 0 }; changed = true; }
        else if (line[0] === 'K') { state = { ...state, vks: rest.split(',').filter(Boolean).map(Number) }; changed = true; }
        else if (line[0] === 'P') { state = { ...state, pov: Number(rest) }; changed = true; }
        else if (line[0] === 'A') { state = { ...state, axes: rest.split(',').map(Number) }; changed = true; }
      }
      if (changed) broadcast();
    });
    // The helper died on its own (crash, killed from outside): tell the page, then bring it back while somebody is still watching.
    const gone = (status) => {
      if (child !== c) return;
      child = null;
      state = blank(status);
      broadcast();
      clearTimeout(restartTimer);
      if (clients.size && spec && ++fails <= MAX_RESTARTS) restartTimer = setTimeout(() => { if (!child && clients.size && spec) { start(); broadcast(); } }, 2000);
    };
    c.on('exit', () => gone('stopped'));
    c.on('error', () => gone('error'));
  }

  return {
    /** spec = { vid:'16D0', pid:'12F7', vks:[1,2,...] } (validated by the caller) */
    subscribe(res, next) {
      clearTimeout(stopTimer);
      const nextSig = JSON.stringify(next);
      // a different set of keys, or the same one whose helper is no longer running (a page reload is the user's "try again")
      if (nextSig !== sig || (!child && process.platform === 'win32')) { stop(); sig = nextSig; spec = next; start(); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      res.on('close', () => {
        clients.delete(res);
        if (!clients.size) stopTimer = setTimeout(stop, 5000); // nobody watching: stop polling
      });
    },
    close: stop,
  };
}
