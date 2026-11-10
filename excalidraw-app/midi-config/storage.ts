import {
  isMidiTargetId,
  MIDI_TARGET_IDS,
  TWISTER_LAYOUT,
} from "@excalidraw/excalidraw";
import { useCallback, useEffect, useState } from "react";

import type {
  MidiBinding,
  MidiEncoding,
  MidiTargetId,
} from "@excalidraw/excalidraw";

import { STORAGE_KEYS } from "../app_constants";

/** the preferences the config page edits, besides the bindings */
export type MidiSettings = {
  encoding: MidiEncoding;
  acceleration: boolean;
  feedback: boolean;
  toasts: boolean;
  /** 0 turns knob presses off */
  switchChannelOffset: number;
  steps: Partial<Record<MidiTargetId, number>>;
};

export const DEFAULT_MIDI_SETTINGS: Readonly<MidiSettings> = {
  encoding: "auto",
  acceleration: true,
  feedback: true,
  toasts: true,
  switchChannelOffset: 1,
  steps: {},
};

export const MIDI_ENCODINGS: readonly MidiEncoding[] = [
  "auto",
  "absolute",
  "relative",
  "twosComplement",
];

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

const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the knobs still work for this session
  }
};

/** the knobs this browser learned, or the Twister layout */
export const loadMidiBindings = (): MidiBinding[] => {
  const saved = read(STORAGE_KEYS.LOCAL_STORAGE_MIDI_BINDINGS);
  return Array.isArray(saved) ? saved.filter(isBinding) : [...TWISTER_LAYOUT];
};

/** this browser's preferences, each one checked, the rest defaults */
export const loadMidiSettings = (): MidiSettings => {
  const saved = (read(STORAGE_KEYS.LOCAL_STORAGE_MIDI_SETTINGS) ??
    {}) as Partial<MidiSettings>;
  const steps: MidiSettings["steps"] = {};
  for (const id of MIDI_TARGET_IDS) {
    const step = saved.steps?.[id];
    if (typeof step === "number" && Number.isFinite(step) && step > 0) {
      steps[id] = step;
    }
  }
  const pick = <K extends keyof MidiSettings>(
    key: K,
    valid: (value: unknown) => boolean,
  ): MidiSettings[K] =>
    valid(saved[key])
      ? (saved[key] as MidiSettings[K])
      : DEFAULT_MIDI_SETTINGS[key];
  const isBoolean = (value: unknown) => typeof value === "boolean";
  return {
    encoding: pick("encoding", (v) =>
      MIDI_ENCODINGS.includes(v as MidiEncoding),
    ),
    acceleration: pick("acceleration", isBoolean),
    feedback: pick("feedback", isBoolean),
    toasts: pick("toasts", isBoolean),
    switchChannelOffset: pick(
      "switchChannelOffset",
      (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 15,
    ),
    steps,
  };
};

/**
 * The stored bindings and settings, kept in step with every other tab: the
 * config page in one tab rebinds the knobs of an editor in another.
 */
export const useStoredMidi = () => {
  const [bindings, setBindingsState] = useState(loadMidiBindings);
  const [settings, setSettingsState] = useState(loadMidiSettings);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.LOCAL_STORAGE_MIDI_BINDINGS) {
        setBindingsState(loadMidiBindings());
      } else if (event.key === STORAGE_KEYS.LOCAL_STORAGE_MIDI_SETTINGS) {
        setSettingsState(loadMidiSettings());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setBindings = useCallback((next: MidiBinding[]) => {
    setBindingsState(next);
    write(STORAGE_KEYS.LOCAL_STORAGE_MIDI_BINDINGS, next);
  }, []);

  const setSettings = useCallback((next: MidiSettings) => {
    setSettingsState(next);
    write(STORAGE_KEYS.LOCAL_STORAGE_MIDI_SETTINGS, next);
  }, []);

  return { bindings, setBindings, settings, setSettings };
};
