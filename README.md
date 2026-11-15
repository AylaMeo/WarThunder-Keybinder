# War Thunder Keybinder

Local viewer for your War Thunder controls on an **Azeron Cyborg 2** and a **Logitech mouse**.
Layers (one per control group in the game): Air, Helicopter, Ground, Naval, Submarine, Infantry, Replay/Spectator,
plus a Common overlay (includes the 3 TrackIR shortcuts) and a Drone overlay (Ground and Naval).
There is no gamepad tab: the game's gamepad group has no shortcuts of its own; a pad just uses the normal vehicle actions.
Sidebars show what is bound and what is missing.

```
node server.mjs        # browser version: http://localhost:5177
npm install            # one-time: installs Electron (the desktop window)
npm run app            # desktop window / overlay
```

Needs Node 22.5+ (uses `node:sqlite`). The server listens on 127.0.0.1 only.

## Standalone exe

`powershell -File tools\package.ps1` builds `dist\WT-Keybinder\WT Keybinder.exe` (about 360 MB: it carries its own copy of
Electron; no install needed, copy the folder anywhere writable). Your current `config.json`, `labels.json` and
`mouse-layout.json` are copied in as starting settings; after that the exe keeps its own copies in `resources\app`.
Rebuild after changing the code. The exe is unsigned, so Windows SmartScreen may warn the first time.

## Tray app

The desktop app lives in the system tray (a purple key-cap icon). **Left-click the icon (or press the overlay hotkey,
default Ctrl+Alt+O) to switch overlay mode on or off.** Overlay mode = compact view, both side panels hidden, no
background, always on top, small window; switching it off puts everything back exactly as it was. Double-click the icon
to show the window; right-click for a menu (show/hide, overlay, hide background, always on top, click-through, quit).
Closing the window only hides it to the tray; use "Quit" in the tray menu to exit.

Title bar (desktop): `Opacity`, `Hide background` (makes the window transparent, so only the keys show; the window is
re-created when you change it, and a transparent window can't be resized, so untick it to resize), `Overlay`,
`Pin`, `Click-through`. Then
`Mouse` and `Compact`. Each side panel has a `Hide` button in its own header; a small edge tab brings a hidden
panel back. View settings are saved in `ui.json`.

## Settings (the cog in the top bar)

The cog opens the settings page: the War Thunder controls file, the Azeron profile, the G HUB profile (used by "Add from
G HUB" in the mouse editor), the **overlay hotkey** (click it, then press the combination; desktop app only), analog-stick
calibration (plus a raw axis readout), and a data section with a "Reload data" button. New settings of this kind go here.

**Overlay position, size and mouse** (desktop app): in Settings > Overlay, "Set up..." opens the overlay with a solid, resizable
window and a bar at the top. Drag the bar to move the window, drag its edges to resize, tick or untick "Show mouse panel", then
"Save position" (or Cancel). From then on, overlay mode (tray click / hotkey / the Overlay checkbox) opens at that position and
size, with the mouse panel on or off as you chose. "Reset" goes back to the default (880 x 600, wherever it was). If the saved
spot is no longer on a screen, only the size is used. The "Show the mouse panel in overlay mode" checkbox in Settings changes the
mouse choice without re-doing the position. **Overlay opacity** has its own slider (Settings > Overlay, and in the set-up bar, where
it changes live): it applies whenever overlay mode is on and your normal window opacity comes back when you leave it.
The mouse panel is lined up with the bottom of the Azeron panel everywhere in the app.

## Desktop window and overlay

* **Overlay** button: compact, always on top, 85% opacity, small window. Click again to restore.
* **Pin** keeps the window above the game (use borderless/windowed-fullscreen; exclusive fullscreen hides overlays).
* **Opacity** slider, **Click-through** (mouse clicks pass through to the game).
* Global hotkeys (work while the game has focus): **Ctrl+Alt+K** show/hide, **Ctrl+Alt+L** click-through on/off,
  **Ctrl+Alt+M** compact on/off.
* **Compact** (also in the browser, or `?mini=1`) hides sidebars and details and keeps just the two devices.

## Cards, labels, layers

* Every card shows the real input on top (`JOY 9`, `Q`, `LCtrl+C`, `Mouse4`), your custom label in the middle
  and what the game has bound underneath. Azeron software labels are not used.
* **Custom labels are per layer.** Click a key, then type a label for Air / Ground / Naval / Infantry /
  Ground drone / Naval drone / Common. The view shows the current layer's label, then drone, then common.
  Stored in `labels.json`.
* Azeron keyboard keys are decoded (Azeron stores Windows virtual-key codes; modifiers in a separate field) and matched
  to War Thunder keyboard binds. Modifier + key matches only the exact chord.

## Also show (layers shown through)

The "Also show" menu in the tab row has two columns per other layer (Air, Helicopter, Ground, ...):

* **Always**: that layer's keys are shown on the layer you're on, in teal. They don't count as missing.
* **When unbound**: the show-through for keys that have nothing bound on the layer you're on. Such a key shows what it does on the
  ticked layers, in the usual dim style with an "other:" prefix (the tooltip and details name the layers). **All layers are ticked by default**, so every unbound key shows
  what it does elsewhere; untick a layer to stop it showing through. A key bound only on unticked layers shows as a dark, empty card.

The choices are remembered (`ui.json`). The count badge shows how many layers you changed from the defaults ("Reset" restores them).
Switching to a layer that's ticked treats it as the current layer again. In overlay mode show-through keys stay visible, and the
dark empty ones are hidden.

## Keyboard keymap

A normal keyboard panel sits between the Azeron and the mouse and shows what War Thunder does with each key on the current layer
(same card colours, "Also show" / show-through, per-layer custom labels, click a key for details). Pick the physical size in
Settings > Keyboard: Full size (100%), 96% (1800-compact), Corsair Vanguard Pro 96, Tenkeyless (80%), 75%, 65% or 60%.

* The Corsair Vanguard Pro 96 layout was drawn from a photo of the board: no navigation column (the function row ends with PrtSc
  and Del), with no gaps between the rows or before the numpad, a 15-unit main block with the numpad right beside it, Left / Down (and Up) in the main
  block and the Right arrow in the numpad's first column, so its 0 key is single width. Its G-keys, LCD, rotary dial and Elgato key
  are left out on purpose. Fn and the Windows key are kept visible, even in overlay mode (Fn sends nothing War Thunder can see).
* Keys reached only through Fn on a small board (F-row on a 65%, etc.) are not modelled.
* Keyboard keys are not live-highlighted when pressed: that would mean reading every key you type, so the live input helper only
  watches the keys on your Azeron / mouse cards.
* All three panels (Azeron, Keyboard, Mouse) can be shown or hidden with the title-bar buttons, and chosen separately for overlay
  mode (Settings > Overlay, and the checkboxes in the overlay set-up bar). The keyboard is off in overlay mode by default.

## Mouse layout

"Edit layout" next to the mouse: add or remove buttons, choose "Mouse button 1-8" or "Keyboard key"
(for buttons that G HUB turns into a key), and set grid col/row. Pick a G HUB profile to offer its buttons under
"Add from G HUB". The wheel is an axis, not a button, so it is not a card. Stored in `mouse-layout.json`.
Default layout: left, right, wheel click, forward above back on the left side, and a **Scroll wheel** card that lists
which game functions use the wheel on the current layer (the game's mouse axes 2 and up are its per-vehicle wheel slots; *inferred*).

## Live highlight (press a key, its card lights up)

`tools/input-helper.ps1` (started by the server, stops when nobody is watching) reads the Azeron's joystick buttons with
Windows' legacy joystick API (`winmm`, first 32 buttons; button n = bit n-1, *inferred*) and polls the state of only the keys
and mouse buttons your cards use (`GetAsyncKeyState` on a short whitelist the page sends). No hooks, nothing is logged, and
no other keys are ever reported. It works while the game has focus. Windows only. The header shows "live input on" when the
Azeron was found. The API only accepts requests from this app's own page (Host/Origin check).

## Notifications

Rows under "Needs attention" are clickable: unbound device keys, and "same input, several actions" rows, flash the
matching key(s) on the device view and open their details. The highlight fades after a few seconds (click the row again or a tab to clear it sooner).

## Where the data comes from (all read-only)

| What | Source |
| --- | --- |
| Your binds | `Documents/My Games/WarThunder/Saves/<id>/production/machine.blk` (or an exported `.blk` in `Saves/`) |
| Default binds | The preset chain named in your file (e.g. `keyboard_ver2` -> `keyboard_ver1` -> ...), in `data/presets.json` |
| Action list, names, layers | The game's shortcut scripts + `controls.csv`, in `data/catalog.json` |
| Azeron keys | `%APPDATA%/azeron-software-v1/store.db` (profile picked in the header) |
| G HUB buttons | `%LOCALAPPDATA%/LGHUB/settings.db`, copied to a temp dir before reading |

`machine.blk` only stores changes from the default preset, so the app resolves default chain + your overrides.
An empty block such as `ID_AIR_BRAKE{}` means "explicitly unbound".

The app writes only `config.json`, `labels.json` and `mouse-layout.json` in this folder.

## Mapping notes

* Azeron joystick: `joyButton = buttonsOffset + button - 1` (offset from `deviceMapping`; 28 for you). Verified against your binds.
* Chords (`JOY43 + Mouse5`): the last input is the trigger, earlier ones are modifiers (`modifier x16`).
* *Inferred*: G HUB `01xx` keystroke cards are USB HID keys (G5 = `I`, G10 = `'`, G11 = `;` matched your binds).
  Mouse back/forward = WT mouse buttons 4/5. Drone layer = the "Human Uav" section plus ground "Scout UAV".
* Infantry = the game's "Human ..." sections.

## Refreshing after a game update

1. Close War Thunder. Copy `aces`, `gui`, `lang` `.vromfs.bin` files to a scratch folder.
2. Unpack the **copies** with [wt_ext_cli](https://github.com/Warthunder-Open-Source-Foundation/wt_ext_cli):
   `wt_ext_cli unpack_vromf -i <copies> -o <out> --format BlkText --continue Standard`
3. `node tools/build-data.mjs <out>`

`node tools/calibrate.mjs <machine.blk> ["Azeron profile"]` prints the Azeron key -> joyButton -> action table.

## Known limits

* "Same input, several actions" is only a hint; many are intentional.
* Overlays only draw over borderless / windowed games.
