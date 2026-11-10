import { useMemo } from "react";

import type {
  ExcalidrawImperativeAPI,
  MidiOptions,
} from "@excalidraw/excalidraw/types";
import type { CommandPaletteItem } from "@excalidraw/excalidraw/components/CommandPalette/types";

import { MIDI_CONFIG_HASH } from "./midi-config/MidiConfigPage";
import { useStoredMidi } from "./midi-config/storage";

const CATEGORY = "MIDI";

/**
 * MIDI knobs for the app: the bindings and preferences kept in this browser
 * (and edited on midi:config, live from another tab), and command palette
 * entries to connect a controller and open midi:config.
 */
export const useMidiKnobs = (excalidrawAPI: ExcalidrawImperativeAPI | null) => {
  const { bindings, setBindings, settings } = useStoredMidi();

  const midi: MidiOptions = useMemo(
    () => ({
      bindings,
      onBindingsChange: setBindings,
      encoding: settings.encoding,
      acceleration: settings.acceleration,
      feedback: settings.feedback,
      toasts: settings.toasts,
      switchChannelOffset: settings.switchChannelOffset || null,
      steps: settings.steps,
    }),
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
