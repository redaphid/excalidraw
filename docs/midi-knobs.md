# MIDI knobs

A MIDI controller's knobs can turn what the stats panel and the styles panel set by hand: stroke width, opacity, sloppiness, font size, position, size, scale, angle and colour, plus the view's zoom and pan. The default layout is a Midi Fighter Twister's first bank; any knob on any controller can be bound to any target.

```tsx
<Excalidraw midi />
// or, keeping learned knobs:
<Excalidraw midi={{ bindings, onBindingsChange: setBindings }} />
```

draw.hypnodroid.com turns it on and keeps the bindings in `localStorage["excalidraw-midi-bindings"]`. Open the command palette (`Ctrl/Cmd+/`) and run **Connect MIDI controller**, or any **Bind a MIDI knob to …** entry.

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
- **With nothing selected**, the style knobs set the next shape's style (opacity, sloppiness, font size, pen width) and the geometry knobs do nothing.
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

- `props.midi`: `true`, or `MidiOptions` (`bindings`, `onBindingsChange`, `encoding`, `switchChannelOffset`, `feedback`, `acceleration`, `toasts`).
- `excalidrawAPI.midi.connect()`: asks for MIDI access; call it from a user gesture. On mount the editor connects by itself only if the browser already allows MIDI, so a page without a controller never prompts.
- `excalidrawAPI.midi.learn(target)`: binds the next knob turned. `cancelLearn()`, `setBindings(bindings)`, `resetBindings()`, `bindings`, `connected`.
- `MIDI_TARGETS`, `MIDI_TARGET_IDS`, `TWISTER_LAYOUT` and the `MidiBinding` / `MidiTargetId` types are exported from `@excalidraw/excalidraw`.

## Where it lives

- `packages/excalidraw/midi.ts`: pure. Message parsing, encoder decoding and detection, acceleration, ring positions, bindings and the Twister layout.
- `packages/excalidraw/components/App.midi.ts`: the editor side. Web MIDI connection, turns, resets, rings, learning.
- `excalidraw-app/midi.ts`: the app's stored bindings and command palette entries.
