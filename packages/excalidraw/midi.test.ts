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
  parseMidiMessage,
  resolveCommand,
  ringPosition,
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
    expect(TWISTER_LAYOUT).toHaveLength(16);
    expect(twister.get("1:0")).toBe("strokeWidth");
    expect(twister.get("1:4")).toBe("x");
    expect(twister.get("1:9")).toBe("angle");
    expect(twister.get("1:12")).toBe("zoom");
    expect(twister.get("1:15")).toBe("select");
    expect(twister.get("1:16")).toBeUndefined();
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
    expect(learned).toHaveLength(16);
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

  it("resets a knob's target when its switch is pressed", () => {
    expect(
      resolveCommand(twister, { channel: 2, cc: 1, value: 127 }, 1),
    ).toEqual({ target: "opacity", action: "reset", channel: 1, cc: 1 });
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
