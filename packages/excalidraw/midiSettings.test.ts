import { TWISTER_LAYOUT } from "./midi";
import {
  DEFAULT_MIDI_SETTINGS,
  exportMidiConfig,
  importMidiConfig,
  MIDI_CONFIG_VERSION,
} from "./midiSettings";

import type { MidiBinding } from "./midi";
import type { MidiSettings } from "./midiSettings";

const booth: MidiBinding[] = [
  { channel: 1, cc: 0, target: "opacity" },
  { channel: 3, cc: 40, target: "zoom" },
];

const tuned: MidiSettings = {
  ...DEFAULT_MIDI_SETTINGS,
  encoding: "relative",
  acceleration: false,
  steps: { opacity: 5 },
};

describe("exportMidiConfig", () => {
  it("names its format and version", () => {
    expect(JSON.parse(exportMidiConfig(booth, tuned))).toMatchObject({
      format: "excalidraw-midi",
      version: MIDI_CONFIG_VERSION,
    });
  });

  it("round-trips through importMidiConfig", () => {
    expect(importMidiConfig(exportMidiConfig(booth, tuned))).toEqual({
      bindings: booth,
      settings: tuned,
      skipped: 0,
    });
  });
});

describe("importMidiConfig", () => {
  const file = (body: object) =>
    JSON.stringify({ format: "excalidraw-midi", version: 1, ...body });

  it("skips knobs bound to properties this editor doesn't know, and counts them", () => {
    expect(
      importMidiConfig(
        file({
          bindings: [
            { channel: 1, cc: 0, target: "opacity" },
            { channel: 1, cc: 1, target: "tempo" },
            { channel: 17, cc: 2, target: "zoom" },
          ],
        }),
      ),
    ).toEqual({
      bindings: [{ channel: 1, cc: 0, target: "opacity" }],
      settings: DEFAULT_MIDI_SETTINGS,
      skipped: 2,
    });
  });

  it("keeps the readable preferences and defaults the rest", () => {
    const result = importMidiConfig(
      file({
        bindings: [],
        settings: { encoding: "sideways", toasts: false, steps: { zoom: -1 } },
      }),
    );
    expect(result).toEqual({
      bindings: [],
      settings: { ...DEFAULT_MIDI_SETTINGS, toasts: false },
      skipped: 0,
    });
  });

  it("takes the Twister layout when a file has no bindings", () => {
    expect(importMidiConfig(file({}))).toMatchObject({
      bindings: [...TWISTER_LAYOUT],
    });
  });

  it("refuses a file from a newer version", () => {
    expect(importMidiConfig(file({ version: 2, bindings: [] }))).toEqual({
      error: "This file is from a newer version of the MIDI settings",
    });
  });

  it("refuses anything that isn't MIDI settings", () => {
    const notMidi = { error: "This isn't a MIDI settings file" };
    expect(importMidiConfig("{ not json")).toEqual(notMidi);
    expect(importMidiConfig(JSON.stringify({ elements: [] }))).toEqual(notMidi);
    expect(importMidiConfig("null")).toEqual(notMidi);
  });

  it("refuses a file whose bindings are not a list", () => {
    for (const bindings of [null, {}, "knobs", 7]) {
      expect(importMidiConfig(file({ bindings }))).toEqual({
        error: "This isn't a MIDI settings file",
      });
    }
  });

  it("refuses a version that is not a whole number from 1", () => {
    for (const version of [0, -3, 0.5]) {
      expect(importMidiConfig(file({ version, bindings: [] }))).toEqual({
        error: "This isn't a MIDI settings file",
      });
    }
  });

  it("binds a knob listed twice to the last target, as binding it on the page does", () => {
    expect(
      importMidiConfig(
        file({
          bindings: [
            { channel: 1, cc: 0, target: "opacity" },
            { channel: 1, cc: 0, target: "zoom" },
          ],
        }),
      ),
    ).toMatchObject({
      bindings: [{ channel: 1, cc: 0, target: "zoom" }],
      skipped: 0,
    });
  });

  it("keeps only a binding's channel, knob and target", () => {
    expect(
      importMidiConfig(
        file({
          bindings: [
            { channel: 1, cc: 0, target: "opacity", note: "x".repeat(64) },
          ],
        }),
      ),
    ).toEqual({
      bindings: [{ channel: 1, cc: 0, target: "opacity" }],
      settings: DEFAULT_MIDI_SETTINGS,
      skipped: 0,
    });
  });
});
