// DirectInput scancodes (what War Thunder stores as keyboardKey) -> display names.
const T = {
  1: 'Esc', 12: '-', 13: '=', 14: 'Backspace', 15: 'Tab', 26: '[', 27: ']', 28: 'Enter', 29: 'LCtrl',
  39: ';', 40: "'", 41: '`', 42: 'LShift', 43: '\\', 51: ',', 52: '.', 53: '/', 54: 'RShift', 55: 'Num*',
  56: 'LAlt', 57: 'Space', 58: 'Caps', 69: 'NumLock', 70: 'ScrLk', 74: 'Num-', 78: 'Num+', 83: 'Num.',
  87: 'F11', 88: 'F12', 156: 'NumEnter', 157: 'RCtrl', 181: 'Num/', 183: 'PrtSc', 184: 'RAlt',
  197: 'Pause', 199: 'Home', 200: 'Up', 201: 'PgUp', 203: 'Left', 205: 'Right', 207: 'End', 208: 'Down',
  209: 'PgDn', 210: 'Ins', 211: 'Del', 219: 'LWin', 220: 'RWin', 221: 'Menu',
};
'1234567890'.split('').forEach((c, k) => (T[2 + k] = c));
'QWERTYUIOP'.split('').forEach((c, k) => (T[16 + k] = c));
'ASDFGHJKL'.split('').forEach((c, k) => (T[30 + k] = c));
'ZXCVBNM'.split('').forEach((c, k) => (T[44 + k] = c));
for (let k = 0; k < 10; k++) T[59 + k] = 'F' + (k + 1);
[71, 72, 73].forEach((c, k) => (T[c] = 'Num' + (7 + k)));
[75, 76, 77].forEach((c, k) => (T[c] = 'Num' + (4 + k)));
[79, 80, 81].forEach((c, k) => (T[c] = 'Num' + (1 + k)));
T[82] = 'Num0';

export const keyName = (code) => T[code] ?? `Key${code}`;
/** DirectInput scancode for a key name from this table ("Q", "LShift", "Num7", ...), or undefined. */
export const dikByName = (name) => Object.entries(T).find(([, n]) => n === name)?.[0] * 1 || undefined;
export const keyTable = () => Object.entries(T).map(([c, n]) => [Number(c), n]).sort((a, b) => a[0] - b[0]);

// Windows virtual-key codes (what Azeron software stores for keyboard outputs) -> DirectInput scancode.
// Modifier VKs: Azeron keeps them in metaValues, e.g. 17 = Ctrl, 18 = Alt, 16 = Shift, 161/163 = right Shift/Ctrl.
const VK_FIXED = { 8: 14, 9: 15, 13: 28, 19: 197, 20: 58, 27: 1, 32: 57, 33: 201, 34: 209, 35: 207, 36: 199, 37: 203, 38: 200, 39: 205, 40: 208, 45: 210, 46: 211,
  16: 42, 17: 29, 18: 56, 160: 42, 161: 54, 162: 29, 163: 157, 164: 56, 165: 184, 91: 219, 92: 220, 93: 221, 144: 69, 145: 70,
  106: 55, 107: 78, 109: 74, 110: 83, 111: 181,
  186: 39, 187: 13, 188: 51, 189: 12, 190: 52, 191: 53, 192: 41, 219: 26, 220: 43, 221: 27, 222: 40 };
/** Reverse of vkToDik for plain keys (used to ask Windows whether a key is down). */
export function dikToVk(dik) {
  for (let vk = 1; vk < 255; vk++) if (vkToDik(vk) === dik) return vk;
  return null;
}
/** WT mouseButton (0-based) -> Windows virtual-key for mouse buttons 1-5; wheel/extra buttons have none. */
export const MOUSE_VK = { 0: 1, 1: 2, 2: 4, 3: 5, 4: 6 };
export const VK_MODS = new Set([16, 17, 18, 160, 161, 162, 163, 164, 165]);
export function vkToDik(vk) {
  if (VK_FIXED[vk] != null) return VK_FIXED[vk];
  let name;
  if (vk >= 65 && vk <= 90) name = String.fromCharCode(vk);
  else if (vk >= 48 && vk <= 57) name = String.fromCharCode(vk);
  else if (vk >= 112 && vk <= 123) name = 'F' + (vk - 111);
  else if (vk >= 96 && vk <= 105) name = 'Num' + (vk - 96);
  return name && nameToDik[name] != null ? nameToDik[name] : null;
}

// USB HID keyboard usage (what G HUB stores for a keystroke card: 0x01xx) -> DirectInput scancode.
const nameToDik = Object.fromEntries(Object.entries(T).map(([c, n]) => [n, Number(c)]));
const HID_NAMES = { 0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=', 0x2f: '[', 0x30: ']', 0x31: '\\',
  0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/', 0x39: 'Caps', 0x46: 'PrtSc', 0x47: 'ScrLk', 0x48: 'Pause', 0x49: 'Ins', 0x4a: 'Home', 0x4b: 'PgUp',
  0x4c: 'Del', 0x4d: 'End', 0x4e: 'PgDn', 0x4f: 'Right', 0x50: 'Left', 0x51: 'Down', 0x52: 'Up' };
export function hidToDik(u) {
  let name;
  if (u >= 0x04 && u <= 0x1d) name = String.fromCharCode(65 + u - 4);
  else if (u >= 0x1e && u <= 0x26) name = String(u - 0x1d);
  else if (u === 0x27) name = '0';
  else if (u >= 0x3a && u <= 0x45) name = 'F' + (u - 0x39);
  else name = HID_NAMES[u];
  return name && nameToDik[name] != null ? nameToDik[name] : null;
}

// War Thunder mouseButton (0-based). Assumed Windows order; G HUB can remap physical buttons.
const M = { 0: 'LMB', 1: 'RMB', 2: 'MMB', 3: 'Mouse4', 4: 'Mouse5', 5: 'Mouse6', 6: 'Mouse7', 7: 'Mouse8' };
export const mouseName = (code) => M[code] ?? `Mouse${code + 1}`;
