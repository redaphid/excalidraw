/**
 * MIDI bindings and preferences kept in the browser, for hosts that want
 * them to persist: midi:config (`<MidiConfig>`) edits them, and an editor
 * reads them through `useStoredMidi` and `midiSettingsToOptions`. Tabs share
 * them through storage events, so a config page in one tab rebinds the
 * knobs of an editor in another.
 */

import { useCallback, useEffect, useState } from "react";

import { isMidiTargetId, MIDI_TARGET_IDS, TWISTER_LAYOUT } from "./midi";

import type { MidiBinding, MidiEncoding, MidiTargetId } from "./midi";
import type { MidiOptions } from "./types";

/** where they are kept, unless a host names its own keys */
export const MIDI_STORAGE_KEYS = {
  bindings: "excalidraw-midi-bindings",
  settings: "excalidraw-midi-settings",
} as const;

export type MidiStorageKeys = { bindings: string; settings: string };

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
export const loadMidiBindings = (
  keys: MidiStorageKeys = MIDI_STORAGE_KEYS,
): MidiBinding[] => {
  const saved = read(keys.bindings);
  return Array.isArray(saved) ? saved.filter(isBinding) : [...TWISTER_LAYOUT];
};

/** this browser's preferences, each one checked, the rest defaults */
export const loadMidiSettings = (
  keys: MidiStorageKeys = MIDI_STORAGE_KEYS,
): MidiSettings => {
  const saved = (read(keys.settings) ?? {}) as Partial<MidiSettings>;
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

/** the editor's `midi` prop for stored bindings and settings */
export const midiSettingsToOptions = (
  bindings: readonly MidiBinding[],
  settings: MidiSettings,
  onBindingsChange?: (bindings: MidiBinding[]) => void,
): MidiOptions => ({
  bindings,
  onBindingsChange,
  encoding: settings.encoding,
  acceleration: settings.acceleration,
  feedback: settings.feedback,
  toasts: settings.toasts,
  switchChannelOffset: settings.switchChannelOffset || null,
  steps: settings.steps,
});

/**
 * The stored bindings and settings, kept in step with every other tab: the
 * config page in one tab rebinds the knobs of an editor in another.
 */
export const useStoredMidi = (keys: MidiStorageKeys = MIDI_STORAGE_KEYS) => {
  const { bindings: bindingsKey, settings: settingsKey } = keys;
  const [bindings, setBindingsState] = useState(() => loadMidiBindings(keys));
  const [settings, setSettingsState] = useState(() => loadMidiSettings(keys));

  useEffect(() => {
    const keys = { bindings: bindingsKey, settings: settingsKey };
    const onStorage = (event: StorageEvent) => {
      if (event.key === bindingsKey) {
        setBindingsState(loadMidiBindings(keys));
      } else if (event.key === settingsKey) {
        setSettingsState(loadMidiSettings(keys));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [bindingsKey, settingsKey]);

  const setBindings = useCallback(
    (next: MidiBinding[]) => {
      setBindingsState(next);
      write(bindingsKey, next);
    },
    [bindingsKey],
  );

  const setSettings = useCallback(
    (next: MidiSettings) => {
      setSettingsState(next);
      write(settingsKey, next);
    },
    [settingsKey],
  );

  return { bindings, setBindings, settings, setSettings };
};
