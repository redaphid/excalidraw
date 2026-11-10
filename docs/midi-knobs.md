# MIDI knobs

A MIDI controller's knobs can turn what the stats panel and the styles panel set by hand: stroke width, opacity, sloppiness, font size, position, size, scale, angle and colour, plus the view's zoom and pan. The default layout is a Midi Fighter Twister's first bank; any knob on any controller can be bound to any target.

```tsx
<Excalidraw midi />
// or, keeping learned knobs:
<Excalidraw midi={{ bindings, onBindingsChange: setBindings }} />
```

draw.hypnodroid.com turns it on. Open the command palette (`Ctrl/Cmd+/`) and run **Connect MIDI controller**, or **MIDI knob settings (midi:config)** to bind knobs.

## midi:config

`/#midi` is a settings page in the spirit of Firefox's about:config: every property a knob can turn, and every MIDI preference, in one searchable list.

- **Turn, type, Enter.** Turn a knob and it lights up on the Twister map (the bank switches to it) and is armed. Type a few letters of a property (`opa`, `bg light`, `undo`, `sw` for stroke width) and press Enter to bind the armed knob to the top match; arrow keys move down the list. Pressing a knob arms it too.
- **Or pick first.** A row's **learn** button binds the next knob turned to that property.
- **Search** is fuzzy over each property's name, label and description. Letters may skip ahead within a word (`bg` finds background) but moving to another word lands on its first letter (`bgl` finds background lightness), so a long description doesn't match by scattering letters.
- **Steps.** Each property's sensitivity (how far one click moves it) is edited in place. A value changed from its default reads bold, about:config style, with ↺ to put it back.
- **Preferences** (`midi.encoding`, `midi.acceleration`, `midi.feedback`, `midi.toasts`, `midi.switchChannelOffset`) are rows too, filtered by the same search. Double-click a true/false row to flip it.
- Bindings and preferences live in `localStorage["excalidraw-midi-bindings"]` and `["excalidraw-midi-settings"]`. Every change reaches open editor tabs at once, so the page can sit in one tab while the drawing answers in another.

### In another host

`<MidiConfig>` is exported from `@excalidraw/excalidraw`. It is a whole page, so mount it on a route of its own, outside `<Excalidraw>`, and give the editor the same stored values:

```tsx
import {
  Excalidraw,
  MidiConfig,
  midiSettingsToOptions,
  useStoredMidi,
} from "@excalidraw/excalidraw";

// the config route
<MidiConfig backHref="/" />;

// the editor
const { bindings, setBindings, settings } = useStoredMidi();
const midi = useMemo(
  () => midiSettingsToOptions(bindings, settings, setBindings),
  [bindings, settings, setBindings],
);
<Excalidraw midi={midi} />;
```

## Properties

| Group | Properties |
| --- | --- |
| `shape` | x, y, width, height, scale, angle |
| `style` | stroke width, opacity, sloppiness, stroke style, fill style, edges |
| `colour` | stroke and background hue, saturation and lightness |
| `text` | font size, text align |
| `view` | zoom, pan ↔, pan ↕, grid size |
| `edit` | select (steps through shapes), layer (forward and back), undo / redo |

Choices (stroke style, fill style, edges, text align) move one option per four clicks by default, so they don't flicker under the hand; layer and undo / redo move one step per two clicks. Each click of undo / redo or layer is its own undo step.

## The Twister layout

Bank 1 at factory settings: sixteen encoders sending CC 0–15 on channel 1, read row by row from the top left. Banks 2–4 (CC 16–63) start free.

|              |         |            |                |
| ------------ | ------- | ---------- | -------------- |
| stroke width | opacity | sloppiness | font size      |
| x            | y       | width      | height         |
| scale        | angle   | stroke hue | background hue |
| zoom         | pan ↔   | pan ↕      | select         |

Pressing a knob resets its target: stroke width to medium, opacity to 100%, sloppiness to artist, font size to 20, angle to 0, zoom to 100%, and select lets go of the selection. The Twister sends its push switches one channel above its encoders; `switchChannelOffset` changes that (`null` turns presses off).

## What a turn does

- **With a selection**, a knob turns the selection. Position, size and font size go through the stats panel's own drag handlers, so groups, frames, bound text, crops and arrow bindings behave as they do when dragging a stats field; angle goes through the rotation handle's transform, and scale resizes the whole selection about its centre. Every turn is measured from where it began, so turning a knob back lands exactly where it started.
- **With nothing selected**, the style knobs set the next shape's style (opacity, sloppiness, font size, pen width, stroke and fill style, edges, text align) and the geometry and colour knobs do nothing.
- **Zoom and pan** work whatever is selected, in view mode too. **Select** steps the selection through the scene in stacking order, a group at a time, and pans to it when it's off screen.
- **Undo**: a turn ends after 450 ms without a click, on a selection change, or when another knob is turned, and what it changed becomes one undo step.

Sizes and positions move in screen pixels, so a knob feels the same at any zoom. Stroke width, scale and zoom grow by a ratio per click (6%, 1%, 2%), so a knob covers a hairline and a marker stroke alike. Quick turns count for more (`acceleration: false` turns that off).

## Encoders and rings

`encoding` says how knob values are read:

- `"absolute"`: 0–127, the Twister's default. Read as the change from the knob's last value, never as a position, so moving between shapes never makes a knob jump.
- `"relative"`: 64 ± n per click, the Twister's "ENC 3FH/41H" mode.
- `"twosComplement"`: 1… clockwise, 127… counter-clockwise.
- `"auto"` (default): absolute until a knob repeats a value, which only a relative encoder does, then whichever relative mode the value belongs to.

The editor answers each device that has spoken on the output port of the same name: after every turn and selection change it sends each bound knob its target's value (`feedback: false` turns this off). A Twister shows it on the LED ring and adopts it as the knob's own value, so the ring always shows the selected shape's opacity, stroke width, sloppiness, font size or angle, or the view's zoom. Knobs with no gauge (position, size, scale, hue, pan, select) are sent back to the middle after each turn, so they work as jog wheels and never run out of travel.

## API

- `props.midi`: `true`, or `MidiOptions` (`bindings`, `onBindingsChange`, `encoding`, `switchChannelOffset`, `feedback`, `acceleration`, `toasts`, `steps`).
- `excalidrawAPI.midi.connect()`: asks for MIDI access; call it from a user gesture. On mount the editor connects by itself only if the browser already allows MIDI, so a page without a controller never prompts.
- `excalidrawAPI.midi.learn(target)`: binds the next knob turned. `cancelLearn()`, `setBindings(bindings)`, `resetBindings()`, `bindings`, `connected`.
- `MIDI_TARGETS`, `MIDI_TARGET_IDS`, `TWISTER_LAYOUT` and the `MidiBinding` / `MidiTargetId` types are exported from `@excalidraw/excalidraw`.

## Where it lives

- `packages/excalidraw/midi.ts`: pure. Message parsing, encoder decoding and detection, acceleration, ring positions, bindings and the Twister layout.
- `packages/excalidraw/components/App.midi.ts`: the editor side. Web MIDI connection, turns, resets, rings, learning.
- `excalidraw-app/midi.ts`: the editor's knobs and command palette entries.
- `packages/excalidraw/components/MidiConfig/`: midi:config (`<MidiConfig>`) and its fuzzy matcher.
- `packages/excalidraw/midiSettings.ts`: the stored bindings and preferences, shared across tabs (`useStoredMidi`, `midiSettingsToOptions`).
