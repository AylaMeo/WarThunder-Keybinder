import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlk, block, blocks, value, values } from '../lib/blk.mjs';

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
