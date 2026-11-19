import {
  accelerate,
  bindingsToMap,
  controlChangeBytes,
  decodeTurn,
  gatherDetents,
  isMidiTargetId,
  midiTargetPath,
  midiTargetStep,
  MIDI_TARGETS,
  MIDI_TARGET_IDS,
  paletteKnob,
  parseMidiMessage,
  resolveCommand,
  ringPosition,
  slicePosition,
  twisterColor,
  twisterSpeaksRgb,
  TWISTER_LAYOUT,
  withBinding,
  withoutBinding,
} from "./midi";

import type { KnobState, MidiBinding } from "./midi";

/** turns a knob through a run of values, as the hand did */
const turnThrough = (
  values: number[],
  encoding: Parameters<typeof decodeTurn>[2],
  start?: KnobState,
) => {
  let state = start;
  const steps: number[] = [];
  for (const value of values) {
    const decoded = decodeTurn(state, value, encoding);
    steps.push(decoded.steps);
    state = decoded.state;
  }
  return { steps, state };
};

describe("parseMidiMessage", () => {
  it("reads a control change's channel, controller and value", () => {
    expect(parseMidiMessage([0xb0, 7, 100])).toEqual({
      channel: 1,
      cc: 7,
      value: 100,
    });
    expect(parseMidiMessage(new Uint8Array([0xb1, 3, 127]))).toEqual({
      channel: 2,
      cc: 3,
      value: 127,
    });
    expect(parseMidiMessage([0xbf, 63, 0])?.channel).toBe(16);
  });

  it("ignores notes, clock and short messages", () => {
    expect(parseMidiMessage([0x90, 60, 100])).toBeNull();
    expect(parseMidiMessage([0xf8])).toBeNull();
    expect(parseMidiMessage([0xb0, 1])).toBeNull();
    expect(parseMidiMessage(null)).toBeNull();
  });

  it("writes back what it reads", () => {
    expect(parseMidiMessage(controlChangeBytes(4, 21, 64))).toEqual({
      channel: 4,
      cc: 21,
      value: 64,
    });
    expect(controlChangeBytes(1, 0, 200)[2]).toBe(127);
    expect(controlChangeBytes(1, 0, -3)[2]).toBe(0);
  });
});

describe("decodeTurn", () => {
  it("reads an absolute knob as the change from its last value", () => {
    expect(turnThrough([40, 41, 43, 42], "absolute").steps).toEqual([
      0, 1, 2, -1,
    ]);
  });

  it("measures an absolute knob from the ring position last sent to it", () => {
    const { steps } = turnThrough([65], "absolute", { last: 64 });
    expect(steps).toEqual([1]);
  });

  it("reads the Twister's relative mode as 64 ± n", () => {
    expect(turnThrough([65, 65, 63, 66], "relative").steps).toEqual([
      1, 1, -1, 2,
    ]);
  });

  it("reads two's complement as 1… clockwise and 127… back", () => {
    expect(turnThrough([1, 3, 127, 125], "twosComplement").steps).toEqual([
      1, 3, -1, -3,
    ]);
  });

  describe("auto", () => {
    it("stays absolute while the knob never repeats itself", () => {
      const { steps, state } = turnThrough([10, 11, 12, 11], "auto");
      expect(steps).toEqual([0, 1, 1, -1]);
      expect(state?.detected).toBeUndefined();
    });

    it("recognises the Twister's relative mode on its first repeat", () => {
      const { steps, state } = turnThrough([65, 65, 65, 63], "auto");
      expect(steps).toEqual([0, 1, 1, -1]);
      expect(state?.detected).toBe("relative");
    });

    it("recognises two's complement on its first repeat", () => {
      const { steps, state } = turnThrough([1, 1, 127], "auto");
      expect(steps).toEqual([0, 1, -1]);
      expect(state?.detected).toBe("twosComplement");
    });

    it("doesn't leap when a relative knob first speaks against a ring", () => {
      // the ring was told 110 (a gauge near full); the knob is relative and
      // says 63 — a turn of one, not of forty-seven
      const { steps } = turnThrough([63], "auto", { last: 110 });
      expect(steps).toEqual([0]);
    });

    it("isn't fooled by a repeat it caused by sending the ring", () => {
      // jog knob recentred to 64 after each turn: never heard twice alike
      let state: KnobState | undefined;
      const steps: number[] = [];
      for (let i = 0; i < 4; i++) {
        const decoded = decodeTurn({ ...state, last: 64 }, 65, "auto");
        steps.push(decoded.steps);
        state = decoded.state;
      }
      // the knob itself said 65 each time, which a relative knob would —
      // and either reading gives the same +1
      expect(steps).toEqual([1, 1, 1, 1]);
    });
  });
});

describe("accelerate", () => {
  it("leaves a slow turn fine", () => {
    expect(accelerate(1, undefined)).toBe(1);
    expect(accelerate(-1, 200)).toBe(-1);
  });

  it("lets a quick hand cover ground", () => {
    expect(accelerate(1, 40)).toBe(2);
    expect(accelerate(-2, 10)).toBe(-8);
  });
});

describe("ringPosition", () => {
  it("places a linear gauge's value along the ring", () => {
    expect(ringPosition(MIDI_TARGETS.opacity, 0)).toBe(0);
    expect(ringPosition(MIDI_TARGETS.opacity, 50)).toBe(64);
    expect(ringPosition(MIDI_TARGETS.opacity, 100)).toBe(127);
    expect(ringPosition(MIDI_TARGETS.opacity, 140)).toBe(127);
  });

  it("places a log gauge's value by ratio, so 100% zoom isn't pinned left", () => {
    const at100 = ringPosition(MIDI_TARGETS.zoom, 1);
    expect(at100).toBeGreaterThan(40);
    expect(at100).toBeLessThan(64);
    expect(ringPosition(MIDI_TARGETS.zoom, 0.1)).toBe(0);
    expect(ringPosition(MIDI_TARGETS.zoom, 30)).toBe(127);
  });

  it("recentres a jog wheel", () => {
    expect(ringPosition(MIDI_TARGETS.x, 900)).toBe(64);
  });
});

describe("bindings", () => {
  const twister = bindingsToMap(TWISTER_LAYOUT);

  it("lays the Twister's first bank out row by row", () => {
    expect(twister.get("1:0")).toBe("strokeWidth");
    expect(twister.get("1:4")).toBe("tools");
    expect(twister.get("1:5")).toBe("pens");
    expect(twister.get("1:6")).toBe("colors");
    expect(twister.get("1:7")).toBe("history");
    expect(twister.get("1:9")).toBe("angle");
    expect(twister.get("1:12")).toBe("zoom");
    expect(twister.get("1:15")).toBe("select");
  });

  it("moves position and size to the first row of the second bank", () => {
    expect(TWISTER_LAYOUT).toHaveLength(20);
    expect(twister.get("1:16")).toBe("x");
    expect(twister.get("1:17")).toBe("y");
    expect(twister.get("1:18")).toBe("width");
    expect(twister.get("1:19")).toBe("height");
    expect(twister.get("1:20")).toBeUndefined();
  });

  it("knows its targets", () => {
    for (const id of MIDI_TARGET_IDS) {
      expect(MIDI_TARGETS[id].id).toBe(id);
      expect(isMidiTargetId(id)).toBe(true);
    }
    expect(isMidiTargetId("tempo")).toBe(false);
  });

  it("rebinds a knob without touching the others", () => {
    const learned = withBinding(TWISTER_LAYOUT, {
      channel: 1,
      cc: 0,
      target: "backgroundHue",
    });
    const map = bindingsToMap(learned);
    expect(map.get("1:0")).toBe("backgroundHue");
    expect(map.get("1:1")).toBe("opacity");
    expect(learned).toHaveLength(TWISTER_LAYOUT.length);
  });

  it("lets several knobs turn one target", () => {
    const encore: MidiBinding[] = withBinding(TWISTER_LAYOUT, {
      channel: 1,
      cc: 32,
      target: "opacity",
    });
    const map = bindingsToMap(encore);
    expect(map.get("1:1")).toBe("opacity");
    expect(map.get("1:32")).toBe("opacity");
  });

  it("forgets a knob", () => {
    expect(
      bindingsToMap(withoutBinding(TWISTER_LAYOUT, 1, 15)).get("1:15"),
    ).toBeUndefined();
  });
});

describe("resolveCommand", () => {
  const twister = bindingsToMap(TWISTER_LAYOUT);

  it("turns the target a knob is bound to", () => {
    expect(
      resolveCommand(twister, { channel: 1, cc: 1, value: 70 }, 1),
    ).toEqual({ target: "opacity", action: "turn", channel: 1, cc: 1 });
  });

  it("presses a knob when its switch goes down", () => {
    expect(
      resolveCommand(twister, { channel: 2, cc: 1, value: 127 }, 1),
    ).toEqual({ target: "opacity", action: "press", channel: 1, cc: 1 });
  });

  it("ignores the switch's release", () => {
    expect(resolveCommand(twister, { channel: 2, cc: 1, value: 0 }, 1)).toBe(
      null,
    );
  });

  it("prefers a binding on the switch's own channel", () => {
    const map = bindingsToMap(
      withBinding(TWISTER_LAYOUT, { channel: 2, cc: 1, target: "zoom" }),
    );
    expect(
      resolveCommand(map, { channel: 2, cc: 1, value: 127 }, 1)?.target,
    ).toBe("zoom");
  });

  it("has no switches with the offset turned off", () => {
    expect(
      resolveCommand(twister, { channel: 2, cc: 1, value: 127 }, null),
    ).toBeNull();
  });

  it("ignores knobs nothing is bound to", () => {
    expect(
      resolveCommand(twister, { channel: 1, cc: 48, value: 65 }, 1),
    ).toBeNull();
  });
});

describe("stepped targets", () => {
  it("gather detents into whole moves, carrying the rest", () => {
    expect(gatherDetents(0, 3, 4)).toEqual({ moves: 0, carry: 3 });
    expect(gatherDetents(3, 3, 4)).toEqual({ moves: 1, carry: 2 });
    expect(gatherDetents(0, -9, 4)).toEqual({ moves: -2, carry: -1 });
  });

  it("spread their options round the ring", () => {
    expect(ringPosition(MIDI_TARGETS.strokeStyle, 0)).toBe(0);
    expect(ringPosition(MIDI_TARGETS.strokeStyle, 1)).toBe(64);
    expect(ringPosition(MIDI_TARGETS.strokeStyle, 2)).toBe(127);
  });
});

describe("config names and steps", () => {
  it("names each target by its group, about:config style", () => {
    expect(midiTargetPath("opacity")).toBe("style.opacity");
    expect(midiTargetPath("backgroundLightness")).toBe(
      "colour.backgroundLightness",
    );
    const paths = MIDI_TARGET_IDS.map(midiTargetPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("takes a host's step over the default, but not a nonsense one", () => {
    expect(midiTargetStep("opacity")).toBe(2);
    expect(midiTargetStep("opacity", { opacity: 10 })).toBe(10);
    expect(midiTargetStep("opacity", { opacity: 0 })).toBe(2);
    expect(midiTargetStep("opacity", { opacity: NaN })).toBe(2);
  });

  it("keeps the Twister's first bank where the hand learned it", () => {
    expect(TWISTER_LAYOUT.map((b) => b.target).slice(0, 4)).toEqual([
      "strokeWidth",
      "opacity",
      "roughness",
      "fontSize",
    ]);
  });
});

describe("palette knobs", () => {
  const closed = { open: false, ring: "tools" } as const;
  const toolsOpen = { open: true, ring: "tools" } as const;
  const colorsOpen = { open: true, ring: "colors" } as const;

  it("open their ring on a press", () => {
    expect(paletteKnob(closed, "colors", { press: true }, false)).toEqual({
      ops: [{ op: "open", ring: "colors" }],
      turned: false,
    });
  });

  it("close the ring on a press with no turn since it opened", () => {
    expect(paletteKnob(toolsOpen, "tools", { press: true }, false)).toEqual({
      ops: [{ op: "close" }],
      turned: false,
    });
  });

  it("choose the highlighted slice on a press after a turn", () => {
    expect(paletteKnob(toolsOpen, "tools", { press: true }, true)).toEqual({
      ops: [{ op: "choose" }],
      turned: false,
    });
  });

  it("step the highlight as they turn", () => {
    expect(paletteKnob(toolsOpen, "tools", { moves: -2 }, false)).toEqual({
      ops: [{ op: "step", by: -2 }],
      turned: true,
    });
  });

  it("open their ring and step when turned while it's closed", () => {
    expect(paletteKnob(closed, "tools", { moves: 1 }, false)).toEqual({
      ops: [
        { op: "open", ring: "tools" },
        { op: "step", by: 1 },
      ],
      turned: true,
    });
  });

  it("switch to their own ring when another ring is open", () => {
    expect(paletteKnob(colorsOpen, "tools", { press: true }, true)).toEqual({
      ops: [{ op: "open", ring: "tools" }],
      turned: false,
    });
  });

  it("switch to their own ring and step when turned over another ring", () => {
    expect(paletteKnob(colorsOpen, "tools", { moves: 1 }, true)).toEqual({
      ops: [
        { op: "open", ring: "tools" },
        { op: "step", by: 1 },
      ],
      turned: true,
    });
  });

  it("forget a turn made before the ring closed", () => {
    expect(paletteKnob(closed, "tools", { press: true }, true)).toEqual({
      ops: [{ op: "open", ring: "tools" }],
      turned: false,
    });
  });

  it("do nothing for a turn too small to move a slice", () => {
    expect(paletteKnob(toolsOpen, "tools", { moves: 0 }, false)).toEqual({
      ops: [],
      turned: false,
    });
  });

  it("are palette targets with no ring gauge and no reset", () => {
    for (const id of ["tools", "pens", "colors"] as const) {
      expect(MIDI_TARGETS[id].group).toBe("palette");
      expect(MIDI_TARGETS[id].ring).toBeUndefined();
      expect(MIDI_TARGETS[id].reset).toBeUndefined();
    }
  });
});

describe("slicePosition", () => {
  it("spreads a ring's slices round the LED ring", () => {
    expect(slicePosition(0, 10)).toBe(0);
    expect(slicePosition(9, 10)).toBe(127);
    expect(slicePosition(3, 7)).toBe(64);
  });

  it("lights the start for a ring of one", () => {
    expect(slicePosition(0, 1)).toBe(0);
  });

  it("recentres when there is nothing to show", () => {
    expect(slicePosition(0, 0)).toBe(64);
  });
});

describe("twisterColor", () => {
  it("finds a colour's place on the Twister's colour wheel", () => {
    expect(twisterColor("#0000ff")).toBe(1);
    expect(twisterColor("#00ffff")).toBe(22);
    expect(twisterColor("#00ff00")).toBe(43);
    expect(twisterColor("#ffff00")).toBe(64);
    expect(twisterColor("#ff0000")).toBe(84);
    expect(twisterColor("#ff00ff")).toBe(107);
  });

  it("reads short and translucent hex", () => {
    expect(twisterColor("#f00")).toBe(84);
    expect(twisterColor("#ff000080")).toBe(84);
  });

  it("stays clear of white and the knob's active colour", () => {
    // a fully saturated colour at every 5° of hue
    const channel = (n: number, hue: number) => {
      const k = (n + hue / 60) % 6;
      const v = 1 - Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(v * 255)
        .toString(16)
        .padStart(2, "0");
    };
    for (let hue = 0; hue < 360; hue += 5) {
      const hex = `#${channel(5, hue)}${channel(3, hue)}${channel(1, hue)}`;
      const index = twisterColor(hex);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(125);
    }
    expect(twisterColor("#4000ff")).toBeLessThanOrEqual(125);
  });

  it("hands greys, black, white and anything unreadable back to the knob", () => {
    expect(twisterColor("#808080")).toBe(0);
    expect(twisterColor("#000000")).toBe(0);
    expect(twisterColor("#ffffff")).toBe(0);
    expect(twisterColor("transparent")).toBe(0);
    expect(twisterColor("rebeccapurple")).toBe(0);
  });
});

describe("twisterSpeaksRgb", () => {
  it("knows a Twister by its port name", () => {
    expect(twisterSpeaksRgb("Midi Fighter Twister")).toBe(true);
    expect(twisterSpeaksRgb("Midi Fighter Twister MIDI 1")).toBe(true);
    expect(twisterSpeaksRgb("2- Midi Fighter Twister")).toBe(true);
  });

  it("sends no colours to other controllers", () => {
    expect(twisterSpeaksRgb("X-TOUCH MINI")).toBe(false);
    expect(twisterSpeaksRgb("Midi Fighter 3D")).toBe(false);
    expect(twisterSpeaksRgb("")).toBe(false);
  });
});
