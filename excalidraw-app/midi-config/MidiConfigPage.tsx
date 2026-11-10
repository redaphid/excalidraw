import {
  bindingKey,
  MIDI_TARGET_IDS,
  MIDI_TARGETS,
  midiTargetPath,
  midiTargetStep,
  parseMidiMessage,
  TWISTER_LAYOUT,
  withBinding,
  withoutBinding,
} from "@excalidraw/excalidraw";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  MidiBinding,
  MidiControlChange,
  MidiEncoding,
  MidiTargetId,
} from "@excalidraw/excalidraw";

import { fuzzyFilter } from "./fuzzy";
import {
  DEFAULT_MIDI_SETTINGS,
  MIDI_ENCODINGS,
  useStoredMidi,
} from "./storage";

import "./MidiConfigPage.scss";

import type { MidiSettings } from "./storage";

export const MIDI_CONFIG_HASH = "#midi";

const BANKS = [1, 2, 3, 4] as const;
const KNOBS_PER_BANK = 16;

type Knob = { channel: number; cc: number };

/** a knob as the hand finds it: bank and position on a Twister, channel and
 * controller anywhere else */
export const knobName = ({ channel, cc }: Knob) =>
  channel === 1 && cc < BANKS.length * KNOBS_PER_BANK
    ? `B${Math.floor(cc / KNOBS_PER_BANK) + 1}·${(cc % KNOBS_PER_BANK) + 1}`
    : `ch${channel}·CC${cc}`;

type Status = "idle" | "connecting" | "connected" | "unavailable" | "refused";

/** the browser's MIDI inputs, reporting which knob moved */
const useMidiInputs = (onKnob: (change: MidiControlChange) => void) => {
  const [status, setStatus] = useState<Status>("idle");
  const [devices, setDevices] = useState<string[]>([]);
  const access = useRef<MIDIAccess | null>(null);
  const listened = useRef(new Set<MIDIInput>());
  const onKnobRef = useRef(onKnob);
  onKnobRef.current = onKnob;

  const listen = useCallback(() => {
    const names: string[] = [];
    for (const input of access.current?.inputs.values() ?? []) {
      if (input.state === "disconnected") {
        continue;
      }
      names.push(input.name || input.id);
      if (!listened.current.has(input)) {
        listened.current.add(input);
        input.addEventListener("midimessage", (event: MIDIMessageEvent) => {
          const change = parseMidiMessage(event.data);
          if (change) {
            onKnobRef.current(change);
          }
        });
      }
    }
    setDevices(names);
  }, []);

  const connect = useCallback(async () => {
    if (access.current) {
      return;
    }
    if (!("requestMIDIAccess" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("connecting");
    try {
      access.current = await navigator.requestMIDIAccess();
      access.current.onstatechange = listen;
      listen();
      setStatus("connected");
    } catch {
      setStatus("refused");
    }
  }, [listen]);

  useEffect(() => {
    // connect without a prompt when the browser already allows MIDI
    navigator.permissions
      ?.query({ name: "midi" as PermissionName })
      .then((permission) => {
        if (permission.state === "granted") {
          connect();
        }
      })
      .catch(() => {});
    const current = access.current;
    return () => {
      if (current) {
        current.onstatechange = null;
      }
    };
  }, [connect]);

  return { status, devices, connect };
};

const STATUS_TEXT: Record<Status, string> = {
  idle: "not connected",
  connecting: "connecting…",
  connected: "connected",
  unavailable: "this browser has no MIDI",
  refused: "MIDI access was refused",
};

type PrefRow = {
  key: keyof Omit<MidiSettings, "steps">;
  path: string;
  description: string;
};

const PREF_ROWS: readonly PrefRow[] = [
  {
    key: "encoding",
    path: "midi.encoding",
    description:
      "How knob values are read. auto tells absolute and relative knobs apart by themselves",
  },
  {
    key: "acceleration",
    path: "midi.acceleration",
    description: "Quick turns count for more",
  },
  {
    key: "feedback",
    path: "midi.feedback",
    description: "Send each knob its value, for LED rings",
  },
  {
    key: "toasts",
    path: "midi.toasts",
    description: "Name the value in a toast as a knob turns",
  },
  {
    key: "switchChannelOffset",
    path: "midi.switchChannelOffset",
    description:
      "Channels between a knob and its push switch (1 on a Twister); a press resets the knob's property. 0 turns presses off",
  },
];

/** a number edited as text and kept on blur or Enter, so "0." on the way
 * to "0.5" isn't thrown back */
const StepInput = ({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (value: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      onCommit(draft);
      setDraft(null);
    }
  };
  return (
    <input
      type="number"
      min={0}
      step="any"
      value={draft ?? String(value)}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        } else if (event.key === "Escape") {
          setDraft(null);
        }
      }}
    />
  );
};

/**
 * midi:config — every property a knob can turn, found by fuzzy search and
 * bound by turning the knob: turn it, type a few letters, press Enter. The
 * preferences below it edit in place, about:config style, and every change
 * reaches open editor tabs at once.
 */
export const MidiConfigPage = () => {
  const { bindings, setBindings, settings, setSettings } = useStoredMidi();
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState<Knob | null>(null);
  const [learning, setLearning] = useState<MidiTargetId | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [bank, setBank] = useState<number>(1);
  const [flash, setFlash] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const targetsByKnob = useMemo(
    () => new Map(bindings.map((b) => [bindingKey(b.channel, b.cc), b.target])),
    [bindings],
  );
  const knobsByTarget = useMemo(() => {
    const map = new Map<MidiTargetId, MidiBinding[]>();
    for (const binding of bindings) {
      map.set(binding.target, [...(map.get(binding.target) ?? []), binding]);
    }
    return map;
  }, [bindings]);

  const rows = useMemo(
    () =>
      fuzzyFilter(query, MIDI_TARGET_IDS, (id) => {
        const target = MIDI_TARGETS[id];
        return `${target.label} ${midiTargetPath(id)} ${target.description}`;
      }),
    [query],
  );
  const prefRows = useMemo(
    () =>
      fuzzyFilter(query, PREF_ROWS, (row) => `${row.path} ${row.description}`),
    [query],
  );

  useEffect(() => setHighlight(0), [query]);

  const bind = useCallback(
    (knob: Knob, target: MidiTargetId) => {
      setBindings(withBinding(bindings, { ...knob, target }));
      setArmed(null);
      setLearning(null);
      setFlash(bindingKey(knob.channel, knob.cc));
      setNotice(`${knobName(knob)} → ${MIDI_TARGETS[target].label}`);
    },
    [bindings, setBindings],
  );

  const onKnob = useCallback(
    ({ channel, cc, value }: MidiControlChange) => {
      // a push switch speaks for the knob it sits under
      const offset = settings.switchChannelOffset;
      let knob: Knob = { channel, cc };
      if (offset && channel > offset && (value === 127 || value === 0)) {
        if (value === 0) {
          return;
        }
        knob = { channel: channel - offset, cc };
      }
      setFlash(bindingKey(knob.channel, knob.cc));
      if (knob.channel === 1 && knob.cc < BANKS.length * KNOBS_PER_BANK) {
        setBank(Math.floor(knob.cc / KNOBS_PER_BANK) + 1);
      }
      if (learning) {
        bind(knob, learning);
        return;
      }
      setArmed(knob);
      setNotice(null);
      search.current?.focus();
    },
    [bind, learning, settings.switchChannelOffset],
  );

  const midi = useMidiInputs(onKnob);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), 400);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const choose = (id: MidiTargetId) => {
    if (armed) {
      bind(armed, id);
    } else {
      setLearning(id);
      setNotice(null);
      if (midi.status !== "connected") {
        midi.connect();
      }
    }
  };

  const onSearchKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((i) => Math.min(rows.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && rows[highlight]) {
      event.preventDefault();
      choose(rows[highlight]);
    } else if (event.key === "Escape") {
      if (armed || learning) {
        setArmed(null);
        setLearning(null);
      } else {
        setQuery("");
      }
    }
  };

  const setStep = (id: MidiTargetId, value: string) => {
    const step = parseFloat(value);
    const steps = { ...settings.steps };
    if (Number.isFinite(step) && step > 0 && step !== MIDI_TARGETS[id].step) {
      steps[id] = step;
    } else {
      delete steps[id];
    }
    setSettings({ ...settings, steps });
  };

  const setPref = <K extends PrefRow["key"]>(key: K, value: MidiSettings[K]) =>
    setSettings({ ...settings, [key]: value });

  const prompt = learning
    ? `Turn a knob to bind ${MIDI_TARGETS[learning].label}…`
    : armed
    ? `${knobName(armed)} — type to find a property, Enter to bind it`
    : notice ??
      "Turn a knob, then type to find what it should turn. Or pick a property and then turn a knob.";

  return (
    <div className="midi-config">
      <header className="midi-config__header">
        <h1>
          midi<span>:</span>config
        </h1>
        <div
          className={clsx("midi-config__status", {
            "is-connected": midi.status === "connected",
          })}
        >
          <span className="midi-config__dot" />
          {midi.status === "connected" && midi.devices.length
            ? midi.devices.join(", ")
            : STATUS_TEXT[midi.status]}
          {midi.status !== "connected" && (
            <button type="button" onClick={midi.connect}>
              Connect
            </button>
          )}
        </div>
        <a className="midi-config__back" href="/">
          ← back to drawing
        </a>
      </header>

      <section className="midi-config__twister" aria-label="Twister knobs">
        <div className="midi-config__banks" role="tablist">
          {BANKS.map((b) => (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={bank === b}
              className={clsx({ "is-active": bank === b })}
              onClick={() => setBank(b)}
            >
              Bank {b}
            </button>
          ))}
        </div>
        <div className="midi-config__grid">
          {Array.from({ length: KNOBS_PER_BANK }, (_, i) => {
            const knob = { channel: 1, cc: (bank - 1) * KNOBS_PER_BANK + i };
            const key = bindingKey(knob.channel, knob.cc);
            const target = targetsByKnob.get(key);
            const isArmed =
              armed?.channel === knob.channel && armed.cc === knob.cc;
            return (
              <button
                key={key}
                type="button"
                data-testid={`knob-${key}`}
                className={clsx("midi-config__knob", {
                  "is-bound": !!target,
                  "is-armed": isArmed,
                  "is-flash": flash === key,
                })}
                onClick={() => {
                  setArmed(isArmed ? null : knob);
                  setLearning(null);
                  search.current?.focus();
                }}
                title={`CC ${knob.cc}, channel ${knob.channel}`}
              >
                <span className="midi-config__knob-ring" />
                <span className="midi-config__knob-name">{knobName(knob)}</span>
                <span className="midi-config__knob-target">
                  {target ? MIDI_TARGETS[target].label : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div
        className={clsx("midi-config__prompt", {
          "is-waiting": !!(armed || learning),
        })}
        role="status"
      >
        {prompt}
      </div>

      <input
        ref={search}
        className="midi-config__search"
        type="search"
        placeholder="Search properties — try “opa”, “bg light”, “undo”"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onSearchKey}
        autoFocus
        aria-label="Search properties"
      />

      <table className="midi-config__table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Knobs</th>
            <th>Step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((id, index) => {
            const target = MIDI_TARGETS[id];
            const step = midiTargetStep(id, settings.steps);
            const modified = settings.steps[id] !== undefined;
            return (
              <tr
                key={id}
                data-testid={`row-${id}`}
                className={clsx({
                  "is-highlight": index === highlight,
                  "is-modified": modified,
                  "is-learning": learning === id,
                })}
                onMouseEnter={() => setHighlight(index)}
              >
                <td>
                  <div className="midi-config__path">{midiTargetPath(id)}</div>
                  <div className="midi-config__description">
                    {target.label} — {target.description}
                  </div>
                </td>
                <td className="midi-config__knobs">
                  {(knobsByTarget.get(id) ?? []).map((binding) => (
                    <span
                      key={bindingKey(binding.channel, binding.cc)}
                      className="midi-config__chip"
                    >
                      {knobName(binding)}
                      <button
                        type="button"
                        aria-label={`Unbind ${knobName(binding)}`}
                        onClick={() =>
                          setBindings(
                            withoutBinding(
                              bindings,
                              binding.channel,
                              binding.cc,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="midi-config__bind"
                    onClick={() => choose(id)}
                  >
                    {armed ? `bind ${knobName(armed)}` : "learn"}
                  </button>
                </td>
                <td className="midi-config__step">
                  <StepInput
                    value={step}
                    label={`${target.label} step`}
                    onCommit={(value) => setStep(id, value)}
                  />
                  {modified && (
                    <button
                      type="button"
                      aria-label={`Reset ${target.label} step`}
                      onClick={() => setStep(id, "")}
                    >
                      ↺
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {prefRows.length > 0 && (
        <table className="midi-config__table midi-config__prefs">
          <thead>
            <tr>
              <th>Preference</th>
              <th colSpan={2}>Value</th>
            </tr>
          </thead>
          <tbody>
            {prefRows.map((row) => {
              const value = settings[row.key];
              const modified = value !== DEFAULT_MIDI_SETTINGS[row.key];
              return (
                <tr
                  key={row.key}
                  data-testid={`pref-${row.key}`}
                  className={clsx({ "is-modified": modified })}
                  onDoubleClick={() => {
                    if (typeof value === "boolean") {
                      setPref(row.key, !value as never);
                    }
                  }}
                >
                  <td>
                    <div className="midi-config__path">{row.path}</div>
                    <div className="midi-config__description">
                      {row.description}
                    </div>
                  </td>
                  <td>
                    {typeof value === "boolean" ? (
                      <button
                        type="button"
                        className="midi-config__toggle"
                        aria-pressed={value}
                        onClick={() => setPref(row.key, !value as never)}
                      >
                        {String(value)}
                      </button>
                    ) : row.key === "encoding" ? (
                      <select
                        value={value as MidiEncoding}
                        aria-label={row.path}
                        onChange={(event) =>
                          setPref(
                            "encoding",
                            event.target.value as MidiEncoding,
                          )
                        }
                      >
                        {MIDI_ENCODINGS.map((encoding) => (
                          <option key={encoding}>{encoding}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={15}
                        value={value as number}
                        aria-label={row.path}
                        onChange={(event) => {
                          const next = parseInt(event.target.value, 10);
                          if (
                            Number.isInteger(next) &&
                            next >= 0 &&
                            next <= 15
                          ) {
                            setPref("switchChannelOffset", next);
                          }
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {modified && (
                      <button
                        type="button"
                        aria-label={`Reset ${row.path}`}
                        onClick={() =>
                          setPref(
                            row.key,
                            DEFAULT_MIDI_SETTINGS[row.key] as never,
                          )
                        }
                      >
                        ↺
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <footer className="midi-config__footer">
        <button type="button" onClick={() => setBindings([...TWISTER_LAYOUT])}>
          Reset knobs to the Twister layout
        </button>
        <button
          type="button"
          onClick={() => setSettings({ ...DEFAULT_MIDI_SETTINGS, steps: {} })}
        >
          Reset preferences
        </button>
      </footer>
    </div>
  );
};
