// Live input for the "press a key, see it light up" feature. Runs tools/input-helper.ps1 and fans its output out to SSE clients.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'input-helper.ps1');

export function createLive() {
  const clients = new Set();
  let child = null;
  let sig = '';
  const blank = (status) => ({ status, joy: 0, vks: [], pov: 65535, axes: [32767, 32767, 32767, 32767, 32767, 32767] });
  let state = blank('idle');
  let stopTimer = null;

  const broadcast = () => { const msg = `data: ${JSON.stringify(state)}\n\n`; for (const res of clients) res.write(msg); };

  function stop() {
    if (child) { child.removeAllListeners(); child.kill(); child = null; }
    sig = '';
    state = blank('idle');
  }

  function start(spec) {
    if (process.platform !== 'win32') { state = blank('unsupported'); return; }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-ParentPid', String(process.pid)];
    if (spec.vid && spec.pid) args.push('-VendorId', spec.vid, '-ProductId', spec.pid);
    if (spec.vks.length) args.push('-Vks', spec.vks.join(','));
    state = blank('starting');
    child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      let changed = false;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        // (trim() above removes the trailing space of an empty "K " release line, so match on the first letter only)
        const rest = line.slice(1).trim();
        if (line[0] === 'S') { state = { ...state, status: rest }; changed = true; }
        else if (line[0] === 'J') { state = { ...state, joy: Number(rest) | 0 }; changed = true; }
        else if (line[0] === 'K') { state = { ...state, vks: rest.split(',').filter(Boolean).map(Number) }; changed = true; }
        else if (line[0] === 'P') { state = { ...state, pov: Number(rest) }; changed = true; }
        else if (line[0] === 'A') { state = { ...state, axes: rest.split(',').map(Number) }; changed = true; }
      }
      if (changed) broadcast();
    });
    child.on('exit', () => { child = null; state = blank('stopped'); broadcast(); });
    child.on('error', () => { child = null; state = blank('error'); broadcast(); });
  }

  return {
    /** spec = { vid:'16D0', pid:'12F7', vks:[1,2,...] } (validated by the caller) */
    subscribe(res, spec) {
      clearTimeout(stopTimer);
      const next = JSON.stringify(spec);
      if (next !== sig) { stop(); sig = next; start(spec); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
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
