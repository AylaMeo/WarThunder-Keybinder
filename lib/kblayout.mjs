// Keyboard layouts for the keymap panel. Positions are in key units (1 key = 1 x 1) from the top-left corner.
// `d` is the DirectInput scancode War Thunder uses in its keyboardKey binds (null = a key with no fixed code, e.g. a G-key).
import { dikByName } from './dik.mjs';

const code = (name) => {
  const d = dikByName(name);
  if (d == null) throw new Error(`kblayout: unknown key ${name}`);
  return d;
};
const ROW = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
const HOME = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
const BOTTOM = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function builder(dx = 0) {
  const keys = [];
  return {
    keys,
    k(name, x, y, w = 1, h = 1, label) { keys.push({ d: code(name), x: x + dx, y, w, h, l: label ?? name }); },
    free(label, x, y, w = 1, h = 1, tip) { keys.push({ d: null, x: x + dx, y, w, h, l: label, tip }); },
  };
}

/** The 15-unit main block (letters, numbers, modifiers). ys = row y positions; opts choose the variant. */
function main(b, ys, { fn = false, grouped = true, escOnNum = false, shiftShort = false, inlineArrows = false, vanguard = false } = {}) {
  if (fn) {
    b.k('Esc', 0, ys.fn);
    ['F1', 'F2', 'F3', 'F4'].forEach((n, i) => b.k(n, (grouped ? 2 : 1) + i, ys.fn));
    ['F5', 'F6', 'F7', 'F8'].forEach((n, i) => b.k(n, (grouped ? 6.5 : 5) + i, ys.fn));
    ['F9', 'F10', 'F11', 'F12'].forEach((n, i) => b.k(n, (grouped ? 11 : 9) + i, ys.fn));
  }
  if (escOnNum) b.k('Esc', 0, ys.num); else b.k('`', 0, ys.num);
  DIGITS.forEach((n, i) => b.k(n, 1 + i, ys.num));
  b.k('-', 11, ys.num); b.k('=', 12, ys.num); b.k('Backspace', 13, ys.num, 2);

  b.k('Tab', 0, ys.tab, 1.5);
  ROW.forEach((n, i) => b.k(n, 1.5 + i, ys.tab));
  b.k('[', 11.5, ys.tab); b.k(']', 12.5, ys.tab); b.k('\\', 13.5, ys.tab, 1.5);

  b.k('Caps', 0, ys.caps, 1.75);
  HOME.forEach((n, i) => b.k(n, 1.75 + i, ys.caps));
  b.k(';', 10.75, ys.caps); b.k("'", 11.75, ys.caps); b.k('Enter', 12.75, ys.caps, 2.25);

  b.k('LShift', 0, ys.shift, 2.25);
  BOTTOM.forEach((n, i) => b.k(n, 2.25 + i, ys.shift));
  b.k(',', 9.25, ys.shift); b.k('.', 10.25, ys.shift); b.k('/', 11.25, ys.shift);
  b.k('RShift', 12.25, ys.shift, vanguard || shiftShort ? 1.75 : 2.75);

  b.k('LCtrl', 0, ys.space, 1.25); b.k('LWin', 1.25, ys.space, 1.25); b.k('LAlt', 2.5, ys.space, 1.25);
  b.k('Space', 3.75, ys.space, 6.25);
  if (vanguard) {
    // Corsair Vanguard Pro 96 (from a photo): Alt, Fn, [Elgato key slot], Left, Down. Up sits above Down. The Right arrow is not here:
    // on this board it sits in the numpad's first column on the bottom row (see vanguardPro96).
    // The Elgato / Stream Deck key is left out on purpose; its slot stays empty so the arrows keep their place.
    b.k('RAlt', 10, ys.space, 1);
    b.free('Fn', 11, ys.space, 1, 1, 'Fn is handled inside the keyboard: it sends nothing War Thunder can see');
    b.k('Left', 13, ys.space); b.k('Down', 14, ys.space);
    b.k('Up', 14, ys.shift);
  } else if (inlineArrows) {
    b.k('RAlt', 10, ys.space); b.k('RCtrl', 11, ys.space);
    b.k('Left', 13, ys.space); b.k('Down', 14, ys.space); b.k('Right', 15, ys.space); b.k('Up', 14, ys.shift);
  } else {
    b.k('RAlt', 10, ys.space, 1.25); b.k('RWin', 11.25, ys.space, 1.25); b.k('Menu', 12.5, ys.space, 1.25); b.k('RCtrl', 13.75, ys.space, 1.25);
  }
}

function navCluster(b, x, ys) {
  ['PrtSc', 'ScrLk', 'Pause'].forEach((n, i) => b.k(n, x + i, ys.fn));
  ['Ins', 'Home', 'PgUp'].forEach((n, i) => b.k(n, x + i, ys.num));
  ['Del', 'End', 'PgDn'].forEach((n, i) => b.k(n, x + i, ys.tab));
  b.k('Up', x + 1, ys.shift);
  ['Left', 'Down', 'Right'].forEach((n, i) => b.k(n, x + i, ys.space));
}

function numpad(b, x, ys) {
  b.k('NumLock', x, ys.num); b.k('Num/', x + 1, ys.num); b.k('Num*', x + 2, ys.num); b.k('Num-', x + 3, ys.num);
  b.k('Num7', x, ys.tab); b.k('Num8', x + 1, ys.tab); b.k('Num9', x + 2, ys.tab); b.k('Num+', x + 3, ys.tab, 1, 2);
  b.k('Num4', x, ys.caps); b.k('Num5', x + 1, ys.caps); b.k('Num6', x + 2, ys.caps);
  b.k('Num1', x, ys.shift); b.k('Num2', x + 1, ys.shift); b.k('Num3', x + 2, ys.shift); b.k('NumEnter', x + 3, ys.shift, 1, 2);
  b.k('Num0', x, ys.space, 2); b.k('Num.', x + 2, ys.space);
}

const SPACED = { fn: 0, num: 1.5, tab: 2.5, caps: 3.5, shift: 4.5, space: 5.5 };   // classic row spacing (gap under the function row)
const TIGHT = { fn: 0, num: 1, tab: 2, caps: 3, shift: 4, space: 5 };               // compact boards: no gap

function full() {
  const b = builder();
  main(b, SPACED, { fn: true });
  navCluster(b, 15.5, SPACED);
  numpad(b, 19, SPACED);
  return { w: 23, h: 6.5, ...b };
}

function tkl() {
  const b = builder();
  main(b, SPACED, { fn: true });
  navCluster(b, 15.5, SPACED);
  return { w: 18.5, h: 6.5, ...b };
}

/** Common "96%" / 1800-compact arrangement: arrows tucked under the right shift, a single nav column, then the numpad.
 *  Vendors differ in small details (this is the usual shape). `dx` shifts everything right (room for extra keys on the left). */
function ninetySix(dx = 0) {
  const b = builder(dx);
  main(b, SPACED, { fn: true, shiftShort: true, inlineArrows: true });
  b.k('PrtSc', 16.25, SPACED.fn); b.k('Del', 16.25, SPACED.num); b.k('Home', 16.25, SPACED.tab);
  b.k('End', 16.25, SPACED.caps); b.k('PgUp', 16.25, SPACED.shift); b.k('PgDn', 16.25, SPACED.space);
  numpad(b, 17.5, SPACED);
  return { w: 21.5 + dx, h: 6.5, ...b };
}

/** Corsair Vanguard Pro 96, read from a photo of the board:
 *  - no navigation column: the function row (contiguous Esc..F12, PrtSc, Del) sits directly on the number row (no gap);
 *  - the main block is exactly 15 units wide and the numpad starts right after it (no gap);
 *  - Left / Down are in the main block (Up above Down) and the Right arrow takes the numpad's first column on the bottom row,
 *    so the numpad's 0 key is single width and sits in its second column.
 *  The G-keys, LCD, dial and Elgato key are left out on purpose. Fn and the Windows key are kept (flagged `keep`). */
function vanguardPro96() {
  const ys = TIGHT;   // every row flush against the next, including the function row
  const b = builder();
  main(b, ys, { fn: true, grouped: false, vanguard: true });
  b.k('PrtSc', 13, ys.fn); b.k('Del', 14, ys.fn);
  const x = 15;       // and the numpad flush against the main block
  b.k('NumLock', x, ys.num); b.k('Num/', x + 1, ys.num); b.k('Num*', x + 2, ys.num); b.k('Num-', x + 3, ys.num);
  b.k('Num7', x, ys.tab); b.k('Num8', x + 1, ys.tab); b.k('Num9', x + 2, ys.tab); b.k('Num+', x + 3, ys.tab, 1, 2);
  b.k('Num4', x, ys.caps); b.k('Num5', x + 1, ys.caps); b.k('Num6', x + 2, ys.caps);
  b.k('Num1', x, ys.shift); b.k('Num2', x + 1, ys.shift); b.k('Num3', x + 2, ys.shift); b.k('NumEnter', x + 3, ys.shift, 1, 2);
  b.k('Right', x, ys.space); b.k('Num0', x + 1, ys.space); b.k('Num.', x + 2, ys.space);
  for (const k of b.keys) if (k.l === 'Fn' || k.l === 'LWin') k.keep = true;   // stay visible even in overlay mode
  return { w: 19, h: 6, ...b };
}

function seventyFive() {
  const b = builder();
  main(b, TIGHT, { fn: true, grouped: false, shiftShort: true, inlineArrows: true });
  b.k('PrtSc', 13, TIGHT.fn); b.k('Del', 15, TIGHT.fn);
  b.k('Home', 15, TIGHT.num); b.k('PgUp', 15, TIGHT.tab); b.k('PgDn', 15, TIGHT.caps); b.k('End', 15, TIGHT.shift);
  return { w: 16, h: 6, ...b };
}

function sixtyFive() {
  const ys = { num: 0, tab: 1, caps: 2, shift: 3, space: 4 };
  const b = builder();
  main(b, ys, { escOnNum: true, shiftShort: true, inlineArrows: true });
  b.k('Del', 15, ys.num); b.k('PgUp', 15, ys.tab); b.k('PgDn', 15, ys.caps); b.k('End', 15, ys.shift);
  return { w: 16, h: 5, ...b };
}

function sixty() {
  const ys = { num: 0, tab: 1, caps: 2, shift: 3, space: 4 };
  const b = builder();
  main(b, ys, { escOnNum: true });
  return { w: 15, h: 5, ...b };
}

const LAYOUTS = {
  full: { name: 'Full size (100%)', build: full },
  '96': { name: '96% (1800-compact)', build: () => ninetySix(0) },
  vanguard: { name: 'Corsair Vanguard Pro 96', build: vanguardPro96 },
  tkl: { name: 'Tenkeyless (80%)', build: tkl },
  '75': { name: '75%', build: seventyFive },
  '65': { name: '65%', build: sixtyFive },
  '60': { name: '60%', build: sixty },
};

export const keyboardChoices = Object.entries(LAYOUTS).map(([id, v]) => ({ id, name: v.name }));
export const keyboardLayout = (id) => {
  const known = typeof id === 'string' && Object.hasOwn(LAYOUTS, id);   // (a hand-edited config.json may hold anything)
  const entry = known ? LAYOUTS[id] : LAYOUTS.full;
  const { w, h, keys } = entry.build();
  return { id: known ? id : 'full', name: entry.name, w, h, keys };
};
