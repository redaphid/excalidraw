import {
  isMidiTargetId,
  MIDI_TARGET_IDS,
  MIDI_TARGETS,
  TWISTER_LAYOUT,
} from "@excalidraw/excalidraw";
import { useCallback, useMemo, useState } from "react";

import type {
  ExcalidrawImperativeAPI,
  MidiOptions,
} from "@excalidraw/excalidraw/types";
import type { MidiBinding } from "@excalidraw/excalidraw";
import type { CommandPaletteItem } from "@excalidraw/excalidraw/components/CommandPalette/types";

import { STORAGE_KEYS } from "./app_constants";

const CATEGORY = "MIDI";

const isBinding = (value: unknown): value is MidiBinding => {
  const binding = value as MidiBinding;
  return (
    !!binding &&
    Number.isInteger(binding.channel) &&
    binding.channel >= 1 &&
    binding.channel <= 16 &&
    Number.isInteger(binding.cc) &&
    binding.cc >= 0 &&
    binding.cc <= 127 &&
    isMidiTargetId(binding.target)
  );
};

/** the knobs this browser learned, or the Twister layout */
const loadBindings = (): MidiBinding[] => {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_MIDI_BINDINGS) ?? "null",
    );
    if (Array.isArray(saved)) {
      return saved.filter(isBinding);
    }
  } catch {
    // unreadable: start from the layout
  }
  return [...TWISTER_LAYOUT];
};

const saveBindings = (bindings: MidiBinding[]) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_MIDI_BINDINGS,
      JSON.stringify(bindings),
    );
  } catch {
    // storage full or blocked: the knobs still work for this session
  }
};

/**
 * MIDI knobs for the app: bindings kept in this browser, and command palette
 * entries to connect a controller, bind a knob to any target and go back to
 * the Twister layout.
 */
export const useMidiKnobs = (excalidrawAPI: ExcalidrawImperativeAPI | null) => {
  const [bindings, setBindings] = useState(loadBindings);

  const onBindingsChange = useCallback((next: MidiBinding[]) => {
    setBindings(next);
    saveBindings(next);
  }, []);

  const midi: MidiOptions = useMemo(
    () => ({ bindings, onBindingsChange }),
    [bindings, onBindingsChange],
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
      ...MIDI_TARGET_IDS.map(
        (target): CommandPaletteItem => ({
          label: `Bind a MIDI knob to ${MIDI_TARGETS[target].label}`,
          category: CATEGORY,
          keywords: ["midi", "knob", "learn", "map", target],
          predicate: true,
          perform: () => {
            excalidrawAPI?.midi.learn(target);
          },
        }),
      ),
      {
        label: "Reset MIDI knobs to the Twister layout",
        category: CATEGORY,
        keywords: ["midi", "knobs", "twister", "default", "bindings"],
        predicate: true,
        perform: () => {
          excalidrawAPI?.midi.resetBindings();
          excalidrawAPI?.setToast({
            message: "MIDI knobs reset to the Twister layout",
            duration: 2000,
          });
        },
      },
    ],
    [excalidrawAPI],
  );

  return { midi, commands };
};
