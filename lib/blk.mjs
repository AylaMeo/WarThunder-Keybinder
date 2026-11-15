// Minimal parser for War Thunder BLK *text* files (machine.blk, presets, etc).
// Keeps duplicate keys (repeated blocks are separate bindings) and key order.
//
// Result node:  { entries: [ { k, block: Node } | { k, t, v } ] }

export function parseBlk(text) {
  let i = 0;
  const n = text.length;

  const skipWs = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      if (text[i] === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
      break;
    }
  };

  const readIdent = () => {
    const s = i;
    while (i < n && !/[\s{}:=;]/.test(text[i])) i++;
    return text.slice(s, i);
  };

  const readValue = () => {
    skipWs();
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i++];
      let out = '';
      while (i < n && text[i] !== q) {
        if (text[i] === '\\' && i + 1 < n) { out += text[i + 1]; i += 2; } else out += text[i++];
      }
      i++;
      return out;
    }
    const s = i;
    while (i < n && !/[\r\n};]/.test(text[i])) i++;
    return text.slice(s, i).trim();
  };

  const castValue = (t, raw) => {
    switch (t) {
      case 'i': return parseInt(raw, 10);
      case 'r': return parseFloat(raw);
      case 'b': return /^(yes|true|on|1)$/i.test(raw);
      default: return raw; // t (string), p2/p3/c/m ... kept raw
    }
  };

  const parseBody = (untilBrace) => {
    const node = { entries: [] };
    for (;;) {
      skipWs();
      if (i >= n) break;
      if (text[i] === '}') { if (untilBrace) { i++; } break; }
      if (text[i] === ';') { i++; continue; }
      const k = readIdent();
      if (!k) { i++; continue; }
      skipWs();
      if (text[i] === '{') {
        i++;
        node.entries.push({ k, block: parseBody(true) });
      } else if (text[i] === ':') {
        i++;
        const t = readIdent();
        skipWs();
        if (text[i] === '=') i++;
        node.entries.push({ k, t, v: castValue(t, readValue()) });
      } else if (text[i] === '=') {
        i++;
        node.entries.push({ k, t: 't', v: readValue() });
      }
    }
    return node;
  };

  return parseBody(false);
}

export const blocks = (node, key) => (node?.entries ?? []).filter((e) => e.block && (key == null || e.k === key)).map((e) => e.block);
export const block = (node, key) => blocks(node, key)[0];
export const values = (node, key) => (node?.entries ?? []).filter((e) => !e.block && (key == null || e.k === key)).map((e) => e.v);
export const value = (node, key, dflt) => { const v = values(node, key); return v.length ? v[0] : dflt; };
