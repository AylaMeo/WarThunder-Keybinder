import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlk, serializeBlk, block, blocks, value, values } from '../lib/blk.mjs';

test('typed values, nested blocks and comments', () => {
  const root = parseBlk(`
    // a line comment
    name:t="Azeron Keypad"
    count:i=36            /* a block comment */
    ratio:r=0.5
    on:b=yes
    off:b=no
    inner{ deep{ x:i=1 } }
  `);
  assert.equal(value(root, 'name'), 'Azeron Keypad');
  assert.equal(value(root, 'count'), 36);
  assert.equal(value(root, 'ratio'), 0.5);
  assert.equal(value(root, 'on'), true);
  assert.equal(value(root, 'off'), false);
  assert.equal(value(block(block(root, 'inner'), 'deep'), 'x'), 1);
  assert.equal(value(root, 'missing', 'fallback'), 'fallback');
});

test('repeated keys are kept, in order', () => {
  const root = parseBlk('ID_FIRE{ joyButton:i=3 }\nID_FIRE{ keyboardKey:i=57 }\ntag:t="a"; tag:t="b"');
  assert.equal(blocks(root, 'ID_FIRE').length, 2);
  assert.deepEqual(values(root, 'tag'), ['a', 'b']);
  assert.deepEqual(root.entries.map((e) => e.k), ['ID_FIRE', 'ID_FIRE', 'tag', 'tag']);
});

test('an empty block is present (it means "explicitly unbound")', () => {
  const root = parseBlk('hotkeys{ ID_AIR_BRAKE{} }');
  const hk = block(root, 'hotkeys');
  assert.equal(blocks(hk, 'ID_AIR_BRAKE').length, 1);
  assert.deepEqual(blocks(hk, 'ID_AIR_BRAKE')[0].entries, []);
});

test('one-line blocks and values with separators inside quotes', () => {
  const root = parseBlk('a{ k:i=1; s:t="x; y } z" }');
  assert.equal(value(block(root, 'a'), 'k'), 1);
  assert.equal(value(block(root, 'a'), 's'), 'x; y } z');
});

test('damaged input does not throw or loop', () => {
  for (const text of ['', '{', '}', 'a{', 'a:t="unterminated', 'a:i=', '/* never closed', 'a{ b{ c:i=1']) {
    assert.doesNotThrow(() => parseBlk(text), text);
  }
  assert.ok(Number.isNaN(value(parseBlk('a:i=notanumber'), 'a')));
});

test('serializeBlk writes a file back the way the game lays it out, values untouched', () => {
  // (the layout of machine.blk: CRLF, two-space indent, an empty line after a filled block and between a value and a block)
  const text = [
    'version:i=5',
    '',
    'controls{',
    '  ratio:r=2.1e-05',
    '  path:t="..\\..\\prog\\scripts"',
    '  on:b=yes',
    '',
    '  hotkeys{',
    '    ID_A{',
    '      keyboardKey:i=56',
    '      keyboardKey:i=29',
    '    }',
    '',
    '    ID_A{',
    '      mouseButton:i=4',
    '    }',
    '',
    '    ID_B{}',
    '    ID_C{}',
    '    ID_D{',
    '      joyButton:i=43',
    '    }',
    '  }',
    '}',
    '',
  ].join('\r\n');
  assert.equal(serializeBlk(parseBlk(text)), text);
});

test('serializeBlk formats the entries this app adds itself', () => {
  const node = { entries: [{ k: 'ID_NEW', block: { entries: [{ k: 'keyboardKey', t: 'i', v: 30 }] } }, { k: 'name', t: 't', v: 'a "b" \\ c' }, { k: 'on', t: 'b', v: true }] };
  assert.equal(serializeBlk(node), 'ID_NEW{\r\n  keyboardKey:i=30\r\n}\r\n\r\nname:t="a \\"b\\" \\\\ c"\r\non:b=yes\r\n');
  assert.equal(value(parseBlk(serializeBlk(node)), 'name'), 'a "b" \\ c');
});
