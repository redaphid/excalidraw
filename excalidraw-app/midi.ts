import { midiSettingsToOptions, useStoredMidi } from "@excalidraw/excalidraw";
import { useMemo } from "react";

import type {
  ExcalidrawImperativeAPI,
  MidiOptions,
} from "@excalidraw/excalidraw/types";
import type { CommandPaletteItem } from "@excalidraw/excalidraw/components/CommandPalette/types";

/** the app's route for midi:config */
export const MIDI_CONFIG_HASH = "#midi";

const CATEGORY = "MIDI";

/**
 * MIDI knobs for the app: the bindings and preferences kept in this browser
 * (and edited on midi:config, live from another tab), and command palette
 * entries to connect a controller and open midi:config.
 */
export const useMidiKnobs = (excalidrawAPI: ExcalidrawImperativeAPI | null) => {
  const { bindings, setBindings, settings } = useStoredMidi();

  const midi: MidiOptions = useMemo(
    () => midiSettingsToOptions(bindings, settings, setBindings),
    [bindings, setBindings, settings],
  );

  const commands: CommandPaletteItem[] = useMemo(
    () => [
      {
        label: "Connect MIDI controller",
        category: CATEGORY,
        keywords: ["midi", "knobs", "twister", "controller", "dial"],
        predicate: true,
        perform: () => {
          excalidrawAPI?.midi.connect();
        },
      },
      {
        label: "MIDI knob settings (midi:config)",
        category: CATEGORY,
        keywords: [
          "midi",
          "knobs",
          "twister",
          "bind",
          "learn",
          "map",
          "config",
          "settings",
        ],
        predicate: true,
        perform: () => {
          window.open(`/${MIDI_CONFIG_HASH}`, "_blank", "noopener");
        },
      },
    ],
    [excalidrawAPI],
  );

  return { midi, commands };
};
