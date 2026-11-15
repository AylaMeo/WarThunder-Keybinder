# War Thunder Keybinder

> This README was written by an LLM (Claude) and checked against the code on 2026-11-15. The project's own README is
> [../README.md](../README.md).

Local viewer and bind editor for your War Thunder controls on an **Azeron Cyborg 2** and a **Logitech mouse**.
Layers (one per control group in the game): Air, Helicopter, Ground, Naval, Submarine, Infantry, Replay/Spectator,
plus a Common overlay (includes the TrackIR reset shortcut and its two camera axes) and a Drone overlay (Ground and Naval).
There is no gamepad tab: the game's gamepad group has no shortcuts of its own; a pad just uses the normal vehicle actions.
Sidebars show what is bound and what is missing. Editing binds is an option, off by default (see "Editing binds").

```
node server.mjs        # browser version: http://localhost:5177
npm install            # one-time: installs Electron (the desktop window)
npm run app            # desktop window / overlay
npm test               # unit tests (node --test)
```

Needs Node 22.13+ (uses `node:sqlite`, which needed a flag before that). The server listens on 127.0.0.1 only: port 5177 for
`node server.mjs` (set `PORT` to change it), port 5178 inside the desktop app (any free port if that one is taken).
`Keybinder.cmd` starts the desktop window from the project folder (after `npm install`): double-click it instead of typing `npm run app`.

## Devices that are not there

The app looks for the Azeron and for G HUB each time it loads its data, and does nothing for the one it does not find:

| | Counts as there when | When it is not there |
| --- | --- | --- |
| Azeron | the Azeron software has saved settings on this PC (`%APPDATA%/azeron-software-v1/store.db`), or the game's controls file lists the keypad as a joystick | its profile is not read; the Azeron panel, its title-bar button, its settings (profile, panel size, overlay tick box, analog stick) are left out; the live input helper looks for no joystick |
| G HUB | its settings database is there (`%LOCALAPPDATA%/LGHUB/settings.db`) | the database is not copied or read; the G HUB profile setting and "Add from G HUB" are left out |

A device that is not there is not reported as a problem (no warning bar); Settings > Data says which were not found. The check is
only whether those files exist: nothing is started or opened to find out, and it is not a check for whether the keypad is plugged
in right now (the live input helper reports that, see "Live highlight"). Installing the software later is picked up on the next
automatic reload. Your show / hide choices for the Azeron panel are kept for when it is back.

The mouse panel does not depend on G HUB: it stays, with its layout editor and live highlight. If only one half of the Azeron is
there, the app says so: the game lists the keypad but the Azeron software's settings are missing (its keys cannot be shown), or
the software is set up but the game's controls file does not list the keypad (its joystick keys cannot be matched).

## Standalone exe

`powershell -File tools\package.ps1` builds `dist\WT-Keybinder\WT Keybinder.exe` (about 360 MB: it carries its own copy of
Electron; no install needed, copy the folder anywhere). Quit the running exe from the tray menu before rebuilding.
The exe keeps its settings in `%APPDATA%\wt-keybinder`, not in its own folder, so the folder can be read-only and a rebuild
never overwrites them. Your current `config.json`, `ui.json`, `labels.json` and `mouse-layout.json` are copied in as
starting settings and are only used the first time (when `%APPDATA%\wt-keybinder` has none yet).
The exe is unsigned, so Windows SmartScreen may warn the first time.

## Tray app

The desktop app lives in the system tray (a purple key-cap icon). **Left-click the icon (or press the overlay hotkey,
default Ctrl+Alt+O) to switch overlay mode on or off.** Overlay mode = compact view, both side panels hidden, no
background, always on top, small window; switching it off puts everything back exactly as it was. Double-click the icon
to show the window; right-click for a menu (show/hide, overlay, hide background, always on top, click-through, quit).
Closing the window only hides it to the tray; use "Quit" in the tray menu to exit.

Title bar (desktop): `Opacity` (35% to 100%), `Hide background` (makes the window transparent, so only the keys show; the window is
re-created when you change it, and a transparent window can't be resized, so untick it to resize), `Overlay`,
`Pin`, `Click-through`. Then (also in the browser) `Azeron` (only when an Azeron is there), `Keyboard`, `Mouse` and
`Compact`. Each side panel has a `Hide` button in its own header; a small edge tab brings a hidden
panel back. View settings are saved in `ui.json`.

## Settings (the cog in the top bar)

The cog opens the settings page: the War Thunder controls file, the Azeron profile, the G HUB profile (used by "Add from
G HUB" in the mouse layout editor), the view and panel sizes, the keyboard layout, the **mouse layout editor**, the
**hotkeys** and **overlay** settings (desktop app only, see below), the **bind editing** switch (off by default, see "Editing binds"), analog-stick calibration (plus a raw axis readout), and a data section with a "Reload data" button and the folder your settings are kept in. New settings of this kind go here.

**View > Device panels** chooses how the Azeron, keyboard and mouse panels are laid out when they don't fit next to each
other: *Stacked* (the default: a panel that doesn't fit moves down, and the page scrolls up and down) or *Side by side* (the
panels stay in one row with a scroll bar under them; the mouse wheel over the panels scrolls the row sideways, Shift+wheel
too). Overlay mode always stacks. Saved with the other view settings in `ui.json`.

**Hotkeys** (desktop app): overlay on/off (default Ctrl+Alt+O), show/hide the window (Ctrl+Alt+K), click-through (Ctrl+Alt+L)
and compact view (Ctrl+Alt+M). They work while the game has focus, which also means the game never sees those combinations, so
each one can be changed or switched off: click it, then press the new combination (it needs Ctrl, Alt or Win), Esc to cancel,
Backspace to switch it off. If another program already owns the combination you are told so and the previous one stays active.

**Overlay position, size and mouse** (desktop app): in Settings > Overlay, "Set up..." opens the overlay with a solid, resizable
window and a bar at the top. Drag the bar to move the window, drag its edges to resize, tick or untick "Show mouse panel", then
"Save position" (or Cancel). From then on, overlay mode (tray click / hotkey / the Overlay checkbox) opens at that position and
size, with the mouse panel on or off as you chose. "Reset" goes back to the default (880 x 600, wherever it was). If the saved
spot is no longer on a screen, only the size is used. The "Show the mouse panel in overlay mode" checkbox in Settings changes the
mouse choice without re-doing the position. **Overlay opacity** has its own slider (Settings > Overlay, and in the set-up bar, where
it changes live): it applies whenever overlay mode is on and your normal window opacity comes back when you leave it.
The mouse panel is lined up with the bottom of the Azeron panel everywhere in the app.

## Desktop window and overlay

* **Overlay** button: compact, always on top, small window, no taskbar button, with its own opacity (Settings > Overlay,
  100% unless you change it). Click again to restore.
* **Pin** keeps the window above the game (use borderless/windowed-fullscreen; exclusive fullscreen hides overlays).
* **Opacity** slider, **Click-through** (mouse clicks pass through to the game).
* Global hotkeys (work while the game has focus), all changeable in Settings > Hotkeys: **Ctrl+Alt+O** overlay,
  **Ctrl+Alt+K** show/hide, **Ctrl+Alt+L** click-through on/off, **Ctrl+Alt+M** compact on/off.
* **Compact** (also in the browser, or `?mini=1`) hides the sidebars, the details and legend, the cog and Reload buttons, and
  keeps just the device panels.

## Cards, labels, layers

* Every card shows the real input on top (`JOY 9`, `Q`, `LCtrl+C`, `Mouse4`), your custom label in the middle
  and what the game has bound underneath. Azeron software labels are not used.
* **Custom labels are per layer.** Click a key, then type a label for any layer (Air, Helicopter, Ground, Naval,
  Submarine, Infantry, Replay, Ground drone, Naval drone, Common). The view shows the current layer's label, then drone, then common.
  A label from another layer appears only on a key that is showing that layer (shown through, or "always"), never on a
  key that is bound on the layer you are on. Stored in `labels.json`.
* Azeron keyboard keys are decoded (Azeron stores Windows virtual-key codes; modifiers in a separate field) and matched
  to War Thunder keyboard binds. Modifier + key matches only the exact chord.
* Any Azeron key can be given any of the Azeron software's functions, and all of them are read (the type numbers are the
  Azeron software's own):
  * matched to your binds: joystick button, keyboard key, **mouse button** (shown as `LMB`, `Mouse4`...), **mouse wheel
    up / down** (a key set to turn the wheel; where a layer uses the wheel as an axis the card lists what it scrolls), and
    the thumb-pad directions;
  * shown by name on a dashed card, never as "unbound", because the game has nothing to bind to them: macro, input sequence,
    Xbox button / trigger / stick, profile switching, DPI, media keys, analog toggles, the stick's key / mouse modes.
* A key's **long-press** and **double-press** functions are read as well: the card shows `hold: ...` / `2x: ...`, and the
  details list what the game has bound to each.
* A wired key that the drawing does not have (another Azeron model) and that sends something the game can bind gets a card in
  an extra row under the drawing, so nothing bound is ever invisible.

## Editing binds

**Off by default.** Switch it on in Settings > Bind editing (it asks first). Until then the app only shows your binds: no bind
menu, no "Bind order", no edits bar, and the edit and save endpoints refuse. Switching it off again keeps the edits you made
(in `edits.json`) but hides them.

**Whether this is safe to use is not known.** Gaijin has not said if a controls file made by another program is allowed, and
its rules against "unauthorized modifications" do not say what counts. No rule or ban report against it was found, but there
is no official permission either. Use it at your own risk.

The app never changes a file the game owns. You edit binds here, save them as a **new controls file**, and load that file with
the game's own **Import from file** (Controls menu).

**The bind menu.** Click an action in the Bound or Missing list, or one of its binds, and a small box opens next to the list
(drag it by its title if it covers the keys you want). It lists the action's binds in order:

* the arrows move a bind up or down (the binds are saved in this order, and the game loads them in the order they are in the file);
* **Change** sets another key or chord for that bind, **Remove** deletes it, **Add bind** adds one (the game keeps 3 per action);
* **Order by device** sorts this action's binds by the device order (below); **Unbind** removes them all; **Reset to file** drops
  your edit of this action.

Axes are not edited here (an axis row only highlights its keys).

**Setting a bind (Change / Add bind).** Press the keys, mouse buttons or Azeron keys together, anywhere outside the box: hold the
modifier first, then the key (`LCtrl` then `C` gives `LCtrl+C`). Any input can be the held part, as in the game
(`JOY43 + Mouse5`). A bind holds up to 3 inputs. Pressing again after letting go starts over. You can also click keys on the
device panels to add them one at a time (click again to take one out), which is how to enter PrtSc on some systems and the
Azeron's joystick buttons 33 and up (the live input helper sees the first 32). The wheel counts too (wheel up / down as the
game's mouse buttons 6 / 7 is *inferred*, as elsewhere in this app: check such a bind in game). Nothing is typed while a bind is being captured, Esc included, so use the **Cancel** button.
The box warns when the chord is already bound to another action. **Use this** saves it.

**Device order.** "Bind order" in the top bar holds one order for Keyboard, Mouse, Azeron and Other joystick. "Reorder n actions"
sorts the binds of every action in the layers shown (or in every layer) into that order; binds of the same device keep their
order. A bind's device is what its chip shows: an Azeron key that sends a keyboard key counts as the Azeron, and a chord counts
as the device of its last input. Reordering an action that still has the preset's default binds writes those binds into the
file, taken from `data/presets.json`: after a game update, refresh the data first (see "Refreshing after a game update").

**Edits are a preview.** They are kept in `edits.json` and shown everywhere at once: a yellow dot marks an edited action in
the lists and the keys that show it. The game knows nothing about them until you import the file.
**View changes** in the yellow bar lists every edited action with what your controls file says now and what it will be
(reordered, changed, bound or unbound): click a row to go to that action and open its binds, or **Undo** to drop that one edit.

**Getting the edits into the game.**

1. Press **Save file for import** in the yellow bar. This writes `wtkb-<date>-<time>.blk` into
   `Documents/My Games/WarThunder/Saves`. A file is never replaced; saving twice gives two files.
2. In War Thunder open Controls and press the import button at the bottom left, then pick that file.
3. Once the game has saved its own config, the edits it now contains stop being marked here by themselves.

The first time, make an export in game first (Controls, export button, into the same folder): it is your backup, and the app
uses it as the pattern for the settings block (below). After the first import, check in game: one joystick bind, one chord, one
reordered action (is the order in the Controls menu the one you set?) and one sensitivity or invert option.

What is in the saved file: your controls file's `controls{}` block, with only the edited actions replaced. Every other line
is written back exactly as it was read (other binds, axes, the device mapping the joystick numbers belong to; the game uses
that mapping to renumber joystick buttons when your devices have changed). A bind you only moved keeps its own block, so
anything else the game stored in it stays. A file exported by the game also carries a `settings{}` block (sensitivities,
invert options and the like): when the Saves folder holds such a file, the saved file gets the same block with the values
your live config has now, so importing it changes none of them. When your controls file is itself an exported file, its own
`settings{}` and options are kept as they are, so they are as old as that file.

## Also show (layers shown through)

The "Also show" menu in the tab row has two columns per other layer (Air, Helicopter, Ground, ...):

* **Always**: that layer's keys are shown on the layer you're on, in teal. They don't count as missing.
* **When unbound**: the show-through for keys that have nothing bound on the layer you're on. Such a key shows what it does on the
  ticked layers, in the usual dim style with an "other:" prefix (the tooltip and details name the layers). **All layers are ticked by default**, so every unbound key shows
  what it does elsewhere; untick a layer to stop it showing through. A key bound only on unticked layers shows as a dark, empty card.

The choices are remembered (`ui.json`). The count badge shows how many layers you changed from the defaults ("Reset" restores them).
Switching to a layer that's ticked treats it as the current layer again. In overlay mode show-through keys stay visible, and the
dark ones (not assigned, set up but nothing bound, or bound only on layers not shown through) are hidden.

## Keyboard keymap

A normal keyboard panel sits between the Azeron and the mouse and shows what War Thunder does with each key on the current layer
(same card colours, "Also show" / show-through, per-layer custom labels, click a key for details). Pick the physical size in
Settings > Keyboard: Full size (100%), 96% (1800-compact), Corsair Vanguard Pro 96, Tenkeyless (80%), 75%, 65% or 60%.

**Key size**: by default a keyboard key is drawn exactly as big as an Azeron key, with the same text on it. A whole
keyboard at that size is wider than the window, so it scrolls sideways: with the panels stacked the keyboard panel has its
own scroll bar (the mouse wheel over it scrolls sideways once the page has nowhere further to go; Shift+wheel always does),
and with the panels side by side the row's scroll bar covers it. Its size is set with the other panels' (next paragraph),
where "Fit the window" shrinks the keys to small squares so the whole keyboard fits the window width, as it used to.

**Panel sizes** (Settings > View): the Azeron, keyboard and mouse panels each have their own size, 50% to 200%. A panel is
scaled as a whole: keys, spacing and text together. At 100% a key is the same size on all three. An enlarged panel that is
wider than the window scrolls sideways the same way the keyboard does. Overlay mode ignores these sizes and fits everything
to its own window.

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

Settings > Mouse layout: add or remove buttons, choose "Mouse button 1-8" or "Keyboard key"
(for buttons that G HUB turns into a key), and set grid col/row. Pick a G HUB profile (Settings > Controls and devices) to
offer its buttons under "Add from G HUB". Nothing changes until you press **Save layout**; **Revert** drops your edits, and
closing Settings with unsaved edits asks whether to save them. Stored in `mouse-layout.json`.
Default layout: left, right, wheel click, forward above back on the left side, wheel up / down, and three "Side" placeholders
with no input yet (set what they send in Settings > Mouse layout, or remove them). When a layer uses the wheel as an axis and nothing is
bound to wheel up / down, the two wheel cards merge into one **Scroll wheel** card that lists which game functions use the
wheel on the current layer (the game's mouse axes 2 and up are its per-vehicle wheel slots; *inferred*).

G HUB details (optional, hand-edited in `config.json`): the buttons offered come from the device with the most button slots in
the chosen profile; `"ghubModel": "g502x-lightspeed"` picks another one. G HUB's built-in keystroke cards carry no key, only an
id, so the key is inferred from it (see Mapping notes); where that is wrong on your set-up,
`"ghubKeyOverrides": { "010c": 43 }` maps a card code (the 4 hex digits shown as "G HUB xxxx") to a DirectInput scancode.

## Live highlight (press a key, its card lights up)

`tools/input-helper.ps1` (started by the server, stops when nobody is watching) reads the Azeron's joystick buttons with
Windows' legacy joystick API (`winmm`, first 32 buttons; button n = bit n-1, *inferred*) and polls the state of only the keys
and mouse buttons your cards use (`GetAsyncKeyState` on a short whitelist the page sends). No hooks, nothing is logged, and
no other keys are ever reported. It works while the game has focus. Windows only. The header shows "live input on" when the
Azeron was found. When there is no Azeron joystick to read (none in the game's controls file, or its profile could not be read)
the helper looks for no joystick and only watches the cards' keys and mouse buttons ("live: keys only"); with nothing to watch at
all it is not started. The API only accepts requests from this app's own page (Host/Origin check).

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
| G HUB buttons | `%LOCALAPPDATA%/LGHUB/settings.db`, copied to a temp dir before reading (the copy is deleted straight after, and only re-made when G HUB's files change) |

`machine.blk` only stores changes from the default preset, so the app resolves default chain + your overrides.
An empty block such as `ID_AIR_BRAKE{}` means "explicitly unbound".

What the app writes: its four settings files, `config.json`, `ui.json` (view settings), `labels.json` and `mouse-layout.json`,
and your bind edits, `edits.json` (all in this folder when run from source, in `%APPDATA%\wt-keybinder` for the exe, or wherever
`WTKB_DATA_DIR` points); the desktop window's position and hotkeys in `%APPDATA%\wt-keybinder\window.json`; the short-lived
G HUB temp copy; and, only when you press "Save file for import", a new `wtkb-....blk` in the game's Saves folder. It never
changes or replaces a file the game or a device wrote. Nothing else.

## Mapping notes

* Azeron joystick: `joyButton = buttonsOffset + button - 1` (offset from `deviceMapping`; 28 for you). Verified against your binds.
* Chords (`JOY43 + Mouse5`): the last input is the trigger, earlier ones are modifiers (`modifier x16`).
* *Inferred*: G HUB `01xx` keystroke cards are USB HID keys (G10 = `0134` = `'`, G11 = `0133` = `;` matched your binds).
  One card is treated as an exception: by that rule `010c` (G5) would be `I`, but the app has been showing that button as `\`
  (noted from a G HUB screenshot), which is now the `ghubKeyOverrides` entry in `config.json` instead of a rule in the code.
  Remove that entry if `I` is what the button really sends. Mouse back/forward = WT mouse buttons 4/5. Drone layer = the "Human Uav" section plus ground "Scout UAV".
* Infantry = the game's "Human ..." sections.

## Refreshing after a game update

1. Close War Thunder. Copy `aces`, `gui`, `lang` `.vromfs.bin` files to a scratch folder.
2. Unpack the **copies** with [wt_ext_cli](https://github.com/Warthunder-Open-Source-Foundation/wt_ext_cli):
   `wt_ext_cli unpack_vromf -i <copies> -o <out> --format BlkText --continue Standard`
3. `node tools/build-data.mjs <out>`

The game's shortcut scripts are read by their shape, not parsed. If an update changes that shape so that nothing can be read
from one of them (or the totals collapse), `build-data` stops with a message and leaves `data/` as it was.

`node tools/calibrate.mjs <machine.blk> ["Azeron profile"]` prints the Azeron key -> joyButton -> action table.

## Tests

`npm test` runs the unit tests in `test/` (the BLK parser and writer, preset-chain resolution, the key-code tables, the keyboard
layouts, the Azeron / G HUB readers, what is skipped when a device is not there, the bind edits, the file saved for import and the server's request checks). They run on made-up data and write only to a temp
folder; your binds, Azeron profile and G HUB database are not opened (the server tests do let the app look for control files
in `Saves/`, as it does on every start).

## Known limits

* "Same input, several actions" is only a hint; many are intentional.
* Bind editing covers shortcuts (keys, mouse buttons, joystick buttons). Axes, sensitivities and other options are set in game.
* A bind you change (not just move) is written as a plain bind: an activation type the game had stored in the old one is not carried over.
* Overlays only draw over borderless / windowed games.
