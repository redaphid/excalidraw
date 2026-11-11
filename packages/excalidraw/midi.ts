/**
 * Hardware knobs for the editor: what a MIDI controller's messages say, which
 * knob turns which property, and the layout a Midi Fighter Twister starts
 * with. Pure: `App.midi.ts` connects to the device and applies the turns.
 *
 * A knob remembers where the hand left it; the editor tells it, through the
 * LED ring, where the drawing is. Absolute knobs are therefore read as the
 * difference from their last value rather than as a position, so that a
 * selection change never makes the next turn jump.
 */

export const MIDI_TARGET_IDS = [
  "strokeWidth",
  "opacity",
  "roughness",
  "fontSize",
  "x",
  "y",
  "width",
  "height",
  "scale",
  "angle",
  "strokeHue",
  "backgroundHue",
  "zoom",
  "panX",
  "panY",
  "select",
  "strokeSaturation",
  "strokeLightness",
  "backgroundSaturation",
  "backgroundLightness",
  "strokeStyle",
  "fillStyle",
  "roundness",
  "textAlign",
  "layer",
  "history",
  "gridStep",
] as const;

export type MidiTargetId = typeof MIDI_TARGET_IDS[number];

export type MidiTargetGroup =
  | "shape"
  | "style"
  | "colour"
  | "text"
  | "view"
  | "edit";

export type MidiTarget = {
  id: MidiTargetId;
  group: MidiTargetGroup;
  label: string;
  /** a line for the config page */
  description: string;
  /** how far one detent moves the target: screen px for position, size and
   * pan; degrees for angle and hue; percent for opacity, saturation and
   * lightness; for the sizes that grow by a ratio (stroke width, scale,
   * zoom) the fraction they grow by; and for a choice (`options`), the
   * detents it takes to move to the next one */
  step: number;
  /** a choice turned through in order rather than a number */
  options?: readonly string[];
  /** the span the LED ring shows; targets without one have their ring
   * recentred after each turn, a jog wheel rather than a gauge */
  ring?: { min: number; max: number; log?: boolean };
  /** where a press of the knob's switch puts the value back to */
  reset?: number;
  /** turns the selection, so nothing happens with nothing selected */
  needsSelection?: boolean;
};

const target = (
  id: MidiTargetId,
  group: MidiTargetGroup,
  label: string,
  description: string,
  rest: Omit<MidiTarget, "id" | "group" | "label" | "description">,
): MidiTarget => ({ id, group, label, description, ...rest });

const PERCENT = { min: 0, max: 100 };

export const MIDI_TARGETS: Readonly<Record<MidiTargetId, MidiTarget>> = {
  strokeWidth: target(
    "strokeWidth",
    "style",
    "Stroke width",
    "Thickens or thins the outline by ratio; the next shape's pen size with nothing selected",
    { step: 0.06, ring: { min: 0.25, max: 32, log: true }, reset: 2 },
  ),
  opacity: target(
    "opacity",
    "style",
    "Opacity",
    "How see-through the selection (or the next shape) is",
    { step: 2, ring: PERCENT, reset: 100 },
  ),
  roughness: target(
    "roughness",
    "style",
    "Sloppiness",
    "From architect-straight (0) through artist (1) to cartoonist (2) and beyond",
    { step: 0.05, ring: { min: 0, max: 4 }, reset: 1 },
  ),
  fontSize: target(
    "fontSize",
    "text",
    "Font size",
    "The size of selected text and labels, or of the next text",
    { step: 1, ring: { min: 4, max: 200, log: true }, reset: 20 },
  ),
  x: target("x", "shape", "X", "Moves the selection left and right", {
    step: 2,
    needsSelection: true,
  }),
  y: target("y", "shape", "Y", "Moves the selection up and down", {
    step: 2,
    needsSelection: true,
  }),
  width: target("width", "shape", "Width", "Stretches the selection across", {
    step: 2,
    needsSelection: true,
  }),
  height: target("height", "shape", "Height", "Stretches the selection down", {
    step: 2,
    needsSelection: true,
  }),
  scale: target(
    "scale",
    "shape",
    "Scale",
    "Grows or shrinks the whole selection about its centre",
    { step: 0.01, needsSelection: true },
  ),
  angle: target(
    "angle",
    "shape",
    "Angle",
    "Rotates the selection about its centre",
    { step: 1, ring: { min: 0, max: 360 }, reset: 0, needsSelection: true },
  ),
  strokeHue: target(
    "strokeHue",
    "colour",
    "Stroke hue",
    "Turns the outline colour round the colour wheel",
    { step: 3, needsSelection: true },
  ),
  backgroundHue: target(
    "backgroundHue",
    "colour",
    "Background hue",
    "Turns the fill colour round the colour wheel",
    { step: 3, needsSelection: true },
  ),
  zoom: target("zoom", "view", "Zoom", "Zooms about the middle of the view", {
    step: 0.02,
    ring: { min: 0.1, max: 30, log: true },
    reset: 1,
  }),
  panX: target("panX", "view", "Pan ↔", "Scrolls the view sideways", {
    step: 12,
  }),
  panY: target("panY", "view", "Pan ↕", "Scrolls the view up and down", {
    step: 12,
  }),
  select: target(
    "select",
    "edit",
    "Select",
    "Steps the selection through the scene, a group at a time",
    { step: 1 },
  ),
  strokeSaturation: target(
    "strokeSaturation",
    "colour",
    "Stroke saturation",
    "From grey to vivid, for the outline colour",
    { step: 2, ring: PERCENT, needsSelection: true },
  ),
  strokeLightness: target(
    "strokeLightness",
    "colour",
    "Stroke lightness",
    "From black to white, for the outline colour",
    { step: 2, ring: PERCENT, needsSelection: true },
  ),
  backgroundSaturation: target(
    "backgroundSaturation",
    "colour",
    "Background saturation",
    "From grey to vivid, for the fill colour",
    { step: 2, ring: PERCENT, needsSelection: true },
  ),
  backgroundLightness: target(
    "backgroundLightness",
    "colour",
    "Background lightness",
    "From black to white, for the fill colour",
    { step: 2, ring: PERCENT, needsSelection: true },
  ),
  strokeStyle: target(
    "strokeStyle",
    "style",
    "Stroke style",
    "Solid, dashed or dotted outline",
    { step: 4, options: ["solid", "dashed", "dotted"], reset: 0 },
  ),
  fillStyle: target(
    "fillStyle",
    "style",
    "Fill style",
    "Hachure, cross-hatch, solid or zigzag fill",
    {
      step: 4,
      options: ["hachure", "cross-hatch", "solid", "zigzag"],
      reset: 0,
    },
  ),
  roundness: target("roundness", "style", "Edges", "Sharp or round corners", {
    step: 4,
    options: ["sharp", "round"],
    reset: 1,
  }),
  textAlign: target(
    "textAlign",
    "text",
    "Text align",
    "Left, centre or right aligned text",
    { step: 4, options: ["left", "center", "right"], reset: 0 },
  ),
  layer: target(
    "layer",
    "edit",
    "Layer",
    "Brings the selection forward or sends it back, one layer a click",
    { step: 2, needsSelection: true },
  ),
  history: target(
    "history",
    "edit",
    "Undo / redo",
    "Scrubs through history: back to undo, forward to redo",
    { step: 2 },
  ),
  gridStep: target("gridStep", "view", "Grid size", "The spacing of the grid", {
    step: 1,
    ring: { min: 1, max: 100 },
    reset: 5,
  }),
};

export const isMidiTargetId = (id: unknown): id is MidiTargetId =>
  typeof id === "string" && (MIDI_TARGET_IDS as readonly string[]).includes(id);

/** the target's name in config: `style.opacity`, `colour.strokeHue`… */
export const midiTargetPath = (id: MidiTargetId) =>
  `${MIDI_TARGETS[id].group}.${id}`;

/** how far a detent moves `id`, with a host's override */
export const midiTargetStep = (
  id: MidiTargetId,
  steps?: Partial<Record<MidiTargetId, number>>,
) => {
  const step = steps?.[id];
  return typeof step === "number" && Number.isFinite(step) && step > 0
    ? step
    : MIDI_TARGETS[id].step;
};

// -----------------------------------------------------------------------------
// messages
// -----------------------------------------------------------------------------

/** a control change: channel 1–16, controller and value 0–127 */
export type MidiControlChange = { channel: number; cc: number; value: number };

/** the control change a raw message carries, or null for anything else
 * (notes, clock, sysex) */
export const parseMidiMessage = (
  data: ArrayLike<number> | null | undefined,
): MidiControlChange | null => {
  if (!data || data.length < 3) {
    return null;
  }
  const status = data[0];
  if ((status & 0xf0) !== 0xb0) {
    return null;
  }
  return { channel: (status & 0x0f) + 1, cc: data[1], value: data[2] };
};

/** the bytes of a control change, for the LED ring */
export const controlChangeBytes = (
  channel: number,
  cc: number,
  value: number,
): [number, number, number] => [
  0xb0 | ((channel - 1) & 0x0f),
  cc & 0x7f,
  Math.max(0, Math.min(127, Math.round(value))),
];

// -----------------------------------------------------------------------------
// encoders
// -----------------------------------------------------------------------------

/**
 * How a knob's value is to be read:
 * - `absolute`: 0–127, as the Twister sends by default; read as the change
 *   from the last value
 * - `relative`: 64 ± n per turn (the Twister's "ENC 3FH/41H" mode)
 * - `twosComplement`: 1…63 clockwise, 127…65 counter-clockwise
 * - `auto`: absolute until a knob repeats a value, which only a relative
 *   encoder does, and then whichever relative mode the value belongs to
 */
export type MidiEncoding = "auto" | "absolute" | "relative" | "twosComplement";

export type KnobState = {
  /** the value an absolute turn is measured from: the knob's last, or the
   * ring position last sent to it */
  last?: number;
  /** the value last heard from the knob itself */
  heard?: number;
  /** what `auto` settled on */
  detected?: Exclude<MidiEncoding, "auto">;
  /** when the knob last turned, for acceleration */
  at?: number;
};

const decodeWith = (
  encoding: Exclude<MidiEncoding, "auto">,
  value: number,
  last: number | undefined,
) => {
  switch (encoding) {
    case "relative":
      return value - 64;
    case "twosComplement":
      return value < 64 ? value : value - 128;
    case "absolute":
      return last === undefined ? 0 : value - last;
  }
};

/** an absolute knob reports every value it passes through, so a jump wider
 * than this is a knob out of step with the ring (or a relative knob not yet
 * recognised), not a turn */
const MAX_ABSOLUTE_JUMP = 24;

const detect = (
  value: number,
  heard: number | undefined,
): KnobState["detected"] => {
  if (value !== heard) {
    return undefined;
  }
  if (value >= 56 && value <= 72) {
    return "relative";
  }
  if (value <= 8 || value >= 120) {
    return "twosComplement";
  }
  return undefined;
};

/** the detents a value turns by, and the knob's state after it */
export const decodeTurn = (
  state: KnobState | undefined,
  value: number,
  encoding: MidiEncoding,
): { steps: number; state: KnobState } => {
  const last = state?.last;
  const next = { ...state, last: value, heard: value };
  if (encoding !== "auto") {
    return { steps: decodeWith(encoding, value, last), state: next };
  }
  const detected = state?.detected ?? detect(value, state?.heard);
  const steps = decodeWith(detected ?? "absolute", value, last);
  return {
    steps: !detected && Math.abs(steps) > MAX_ABSOLUTE_JUMP ? 0 : steps,
    state: { ...next, detected },
  };
};

/** a quick hand covers more ground: turns arriving close together count for
 * more, a slow one stays fine */
export const accelerate = (steps: number, sinceLastMs: number | undefined) => {
  if (sinceLastMs === undefined || sinceLastMs > 60) {
    return steps;
  }
  return steps * (sinceLastMs < 20 ? 4 : 2);
};

/** where on its ring (0–127) a value sits */
export const ringPosition = (target: MidiTarget, value: number) => {
  if (target.options) {
    // a choice: its options spread evenly round the ring
    const last = target.options.length - 1;
    return last > 0
      ? Math.round((Math.max(0, Math.min(last, value)) / last) * 127)
      : 0;
  }
  const ring = target.ring;
  if (!ring) {
    return 64;
  }
  const t = ring.log
    ? Math.log(Math.max(value, ring.min) / ring.min) /
      Math.log(ring.max / ring.min)
    : (value - ring.min) / (ring.max - ring.min);
  return Math.round(Math.max(0, Math.min(1, t)) * 127);
};

/**
 * Detents gathered into whole moves for a choice: a knob has to travel
 * `detentsPerMove` clicks before the next option comes up, so a choice
 * doesn't flicker under the hand. The remainder carries to the next turn.
 */
export const gatherDetents = (
  carry: number,
  detents: number,
  detentsPerMove: number,
): { moves: number; carry: number } => {
  const total = carry + detents;
  const per = Math.max(1, detentsPerMove);
  const moves = Math.trunc(total / per);
  return { moves, carry: total - moves * per };
};

// -----------------------------------------------------------------------------
// bindings
// -----------------------------------------------------------------------------

/** a knob (by channel and controller) and the property it turns */
export type MidiBinding = { channel: number; cc: number; target: MidiTargetId };

export const bindingKey = (channel: number, cc: number) => `${channel}:${cc}`;

export const bindingsToMap = (bindings: readonly MidiBinding[]) =>
  new Map(bindings.map((b) => [bindingKey(b.channel, b.cc), b.target]));

/** the bindings with a knob (re)bound; a knob turns one target, a target may
 * be turned by several knobs */
export const withBinding = (
  bindings: readonly MidiBinding[],
  next: MidiBinding,
): MidiBinding[] => [
  ...bindings.filter((b) => b.channel !== next.channel || b.cc !== next.cc),
  next,
];

export const withoutBinding = (
  bindings: readonly MidiBinding[],
  channel: number,
  cc: number,
): MidiBinding[] =>
  bindings.filter((b) => b.channel !== channel || b.cc !== cc);

export type MidiCommand = {
  target: MidiTargetId;
  action: "turn" | "reset";
  /** the knob turned, or the knob whose switch was pressed */
  channel: number;
  cc: number;
};

/**
 * What a control change asks for. A knob bound on its own channel turns its
 * target; failing that, a press arriving `switchChannelOffset` channels
 * above a bound knob (the Twister's push switches sit one channel above its
 * encoders) resets that knob's target. Releases are ignored.
 */
export const resolveCommand = (
  bindings: ReadonlyMap<string, MidiTargetId>,
  { channel, cc, value }: MidiControlChange,
  switchChannelOffset: number | null,
): MidiCommand | null => {
  const target = bindings.get(bindingKey(channel, cc));
  if (target) {
    return { target, action: "turn", channel, cc };
  }
  if (switchChannelOffset && value > 0) {
    const knobChannel = channel - switchChannelOffset;
    const knobTarget = bindings.get(bindingKey(knobChannel, cc));
    if (knobTarget) {
      return { target: knobTarget, action: "reset", channel: knobChannel, cc };
    }
  }
  return null;
};

/**
 * The first bank of a Midi Fighter Twister at its factory settings: sixteen
 * encoders sending CC 0–15 on channel 1, read row by row from the top left.
 * Banks 2–4 (CC 16–63) are left free to learn.
 *
 *   stroke width │ opacity │ sloppiness │ font size
 *   x            │ y       │ width      │ height
 *   scale        │ angle   │ stroke hue │ background hue
 *   zoom         │ pan ↔   │ pan ↕      │ select
 */
export const TWISTER_LAYOUT: readonly MidiBinding[] = (
  [
    "strokeWidth",
    "opacity",
    "roughness",
    "fontSize",
    "x",
    "y",
    "width",
    "height",
    "scale",
    "angle",
    "strokeHue",
    "backgroundHue",
    "zoom",
    "panX",
    "panY",
    "select",
  ] as const
).map((target, cc) => ({ channel: 1, cc, target }));
