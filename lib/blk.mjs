// Minimal parser for War Thunder BLK *text* files (machine.blk, presets, etc).
// Keeps duplicate keys (repeated blocks are separate bindings) and key order.
//
// Result node:  { entries: [ { k, block: Node } | { k, t, v, raw } ] }
// `raw` is the value exactly as it stands in the file (quotes included), so a value this app does not understand
// (1e-05, a path with backslashes) can be written back unchanged by serializeBlk.

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

  /** -> { text: the value (quotes and escapes removed), raw: as written in the file } */
  const readValue = () => {
    skipWs();
    const s = i;
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i++];
      let out = '';
      while (i < n && text[i] !== q) {
        if (text[i] === '\\' && i + 1 < n) { out += text[i + 1]; i += 2; } else out += text[i++];
      }
      i++;
      return { text: out, raw: text.slice(s, Math.min(i, n)) };
    }
    while (i < n && !/[\r\n};]/.test(text[i])) i++;
    const plain = text.slice(s, i).trim();
    return { text: plain, raw: plain };
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
        const val = readValue();
        node.entries.push({ k, t, v: castValue(t, val.text), raw: val.raw });
      } else if (text[i] === '=') {
        i++;
        const val = readValue();
        node.entries.push({ k, t: 't', v: val.text, raw: val.raw });
      }
    }
    return node;
  };

  return parseBody(false);
}

const NL = '\r\n';
const newValue = (e) => (e.t === 't' ? `"${String(e.v).replace(/[\\"]/g, '\\$&')}"` : e.t === 'b' ? (e.v ? 'yes' : 'no') : String(e.v));
/** Node -> BLK text laid out the way the game writes its own files: two-space indent, CRLF, an empty block on one line, and
 *  an empty line after a block that has something in it and between a value and the block that follows it. A value read
 *  from a file is written back exactly as it was (`raw`); only entries this app created are formatted here. Comments are
 *  not kept (the game's files have none). */
export function serializeBlk(node, indent = '') {
  const big = (e) => !!e?.block && e.block.entries.length > 0;
  let out = '';
  node.entries.forEach((e, idx) => {
    const prev = node.entries[idx - 1];
    if (prev && (big(prev) || (e.block && !prev.block))) out += NL;
    if (big(e)) out += `${indent}${e.k}{${NL}${serializeBlk(e.block, `${indent}  `)}${indent}}${NL}`;
    else if (e.block) out += `${indent}${e.k}{}${NL}`;
    else out += `${indent}${e.k}:${e.t}=${e.raw ?? newValue(e)}${NL}`;
  });
  return out;
}

export const blocks = (node, key) => (node?.entries ?? []).filter((e) => e.block && (key == null || e.k === key)).map((e) => e.block);
export const block = (node, key) => blocks(node, key)[0];
export const values = (node, key) => (node?.entries ?? []).filter((e) => !e.block && (key == null || e.k === key)).map((e) => e.v);
export const value = (node, key, dflt) => { const v = values(node, key); return v.length ? v[0] : dflt; };
