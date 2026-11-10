import { getColorSaturationLightness } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";
import { radiansToDegrees } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { TWISTER_LAYOUT } from "../midi";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { MidiBinding } from "../midi";
import type { MidiOptions } from "../types";

const { h } = window;

/** the booth's controller, as the browser names its ports */
const TWISTER = "Midi Fighter Twister";

const KNOB = {
  strokeWidth: 0,
  opacity: 1,
  roughness: 2,
  fontSize: 3,
  x: 4,
  y: 5,
  width: 6,
  height: 7,
  scale: 8,
  angle: 9,
  strokeHue: 10,
  backgroundHue: 11,
  zoom: 12,
  panX: 13,
  panY: 14,
  select: 15,
} as const;

const send = (bytes: number[], from = TWISTER) =>
  act(() => {
    h.app.midi.receive(bytes, from);
  });

/** turns a knob in the Twister's relative mode: `detents` clicks one way */
const turn = (cc: number, detents: number) => {
  for (let i = 0; i < Math.abs(detents); i++) {
    send([0xb0, cc, detents > 0 ? 65 : 63]);
  }
};

const press = (cc: number) => {
  send([0xb1, cc, 127]);
  send([0xb1, cc, 0]);
};

/** the hand rests: the turn lands as one undo step */
const rest = () =>
  act(() => {
    h.app.midi.endTurn();
  });

/** what the booth's Twister has heard back from the editor */
const sent: number[][] = [];
let listener: ((event: { data: Uint8Array }) => void) | null = null;

/** a Twister on the browser's MIDI ports, one input and one output */
const plugIn = () => {
  sent.length = 0;
  listener = null;
  const input = {
    id: "in-1",
    name: TWISTER,
    state: "connected",
    addEventListener: (_: string, fn: typeof listener) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const output = {
    id: "out-1",
    name: TWISTER,
    state: "connected",
    send: (bytes: number[]) => sent.push([...bytes]),
  };
  const access = {
    inputs: new Map([["in-1", input]]),
    outputs: new Map([["out-1", output]]),
    onstatechange: null,
  };
  Object.defineProperty(window.navigator, "requestMIDIAccess", {
    configurable: true,
    value: () => Promise.resolve(access),
  });
};

const unplug = () => {
  delete (window.navigator as any).requestMIDIAccess;
};

const options: MidiOptions = { encoding: "relative", acceleration: false };

const renderWithKnobs = (midi: MidiOptions | boolean = options) =>
  render(<Excalidraw handleKeyboardGlobally midi={midi} />);

const lantern = () =>
  API.createElement({
    type: "rectangle",
    id: "lantern",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    strokeColor: "#1971c2",
    backgroundColor: "#ffc9c9",
    fillStyle: "solid",
  });

describe("MIDI knobs", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  describe("with a shape selected", () => {
    beforeEach(async () => {
      await renderWithKnobs();
      const rect = lantern();
      // the scene as history knows it, so undo has somewhere to go back to
      API.updateScene({
        elements: [rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      API.setSelectedElements([rect]);
    });

    it("turns its opacity, five percent a couple of clicks", () => {
      turn(KNOB.opacity, -5);
      expect(h.elements[0].opacity).toBe(90);
    });

    it("lands a turn as one undo step", () => {
      turn(KNOB.opacity, -10);
      rest();
      expect(h.elements[0].opacity).toBe(80);

      Keyboard.undo();
      expect(h.elements[0].opacity).toBe(100);
    });

    it("measures a turn from where it began, so it doesn't drift", () => {
      turn(KNOB.width, 10);
      turn(KNOB.width, -10);
      rest();
      expect(h.elements[0].width).toBe(200);
    });

    it("moves it in screen pixels, whatever the zoom", () => {
      turn(KNOB.x, 5);
      expect(h.elements[0].x).toBe(110);
      rest();

      API.setAppState({ zoom: { value: 2 as any } });
      turn(KNOB.y, 5);
      expect(h.elements[0].y).toBe(105);
    });

    it("resizes it", () => {
      turn(KNOB.width, 25);
      turn(KNOB.height, -10);
      expect(h.elements[0].width).toBe(250);
      expect(h.elements[0].height).toBe(80);
    });

    it("scales it about its centre", () => {
      turn(KNOB.scale, 20);
      const [rect] = h.elements;
      const factor = 1.01 ** 20;
      expect(rect.width).toBeCloseTo(200 * factor, 0);
      expect(rect.height).toBeCloseTo(100 * factor, 0);
      expect(rect.x + rect.width / 2).toBeCloseTo(200, 0);
      expect(rect.y + rect.height / 2).toBeCloseTo(150, 0);
    });

    it("rotates it", () => {
      turn(KNOB.angle, 30);
      expect(radiansToDegrees(h.elements[0].angle)).toBeCloseTo(30, 5);
    });

    it("thickens its stroke by ratio", () => {
      turn(KNOB.strokeWidth, 12);
      expect(h.elements[0].strokeWidth).toBeCloseTo(2 * 1.06 ** 12, 5);
    });

    it("turns its stroke and fill round the colour wheel", () => {
      turn(KNOB.strokeHue, 40);
      turn(KNOB.backgroundHue, 60);
      expect(h.elements[0].strokeColor).not.toBe("#1971c2");
      expect(h.elements[0].backgroundColor).not.toBe("#ffc9c9");
    });

    it("roughens it", () => {
      turn(KNOB.roughness, 10);
      expect(h.elements[0].roughness).toBeCloseTo(1.5, 5);
    });

    it("puts a target back when the knob is pressed", () => {
      turn(KNOB.opacity, -20);
      rest();
      press(KNOB.opacity);
      expect(h.elements[0].opacity).toBe(100);

      turn(KNOB.angle, 45);
      rest();
      press(KNOB.angle);
      expect(h.elements[0].angle).toBe(0);
    });

    it("toasts the value as it turns", () => {
      turn(KNOB.opacity, -3);
      expect(h.state.toast?.message).toBe("Opacity 94%");
    });

    it("ends a turn when the selection changes", () => {
      turn(KNOB.opacity, -5);
      API.setSelectedElements([]);
      // a new turn on nothing selected sets the next shape's opacity
      turn(KNOB.opacity, -5);
      expect(h.elements[0].opacity).toBe(90);
      expect(h.state.currentItemOpacity).toBe(90);
    });
  });

  describe("the properties past the first bank", () => {
    const bind = async (extra: Partial<MidiOptions> = {}) => {
      await renderWithKnobs({
        ...options,
        ...extra,
        bindings: [
          { channel: 1, cc: 16, target: "strokeStyle" },
          { channel: 1, cc: 17, target: "fillStyle" },
          { channel: 1, cc: 18, target: "backgroundLightness" },
          { channel: 1, cc: 19, target: "layer" },
          { channel: 1, cc: 20, target: "history" },
          { channel: 1, cc: 21, target: "gridStep" },
          { channel: 1, cc: 22, target: "opacity" },
        ],
      });
    };

    it("turns through a choice four clicks at a time, and a press resets it", async () => {
      await bind();
      const rect = lantern();
      API.updateScene({
        elements: [rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      API.setSelectedElements([rect]);

      turn(16, 3);
      expect(h.elements[0].strokeStyle).toBe("solid");
      turn(16, 1);
      expect(h.elements[0].strokeStyle).toBe("dashed");
      turn(16, 8);
      expect(h.elements[0].strokeStyle).toBe("dotted");
      press(16);
      expect(h.elements[0].strokeStyle).toBe("solid");
    });

    it("sets the next shape's fill with nothing selected", async () => {
      await bind();
      // from the default solid, two choices back
      turn(17, -8);
      expect(h.state.currentItemFillStyle).toBe("hachure");
    });

    it("lightens the fill without touching its hue", async () => {
      await bind();
      const rect = lantern();
      API.updateScene({
        elements: [rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      API.setSelectedElements([rect]);

      const before = getColorSaturationLightness(rect.backgroundColor)!;
      turn(18, -10);
      const after = getColorSaturationLightness(h.elements[0].backgroundColor)!;
      expect(after.lightness).toBeCloseTo(before.lightness - 20, 0);
    });

    it("sends a shape back through the layers", async () => {
      await bind();
      const keel = API.createElement({ type: "rectangle", id: "keel" });
      const mast = API.createElement({ type: "ellipse", id: "mast" });
      API.updateScene({
        elements: [keel, mast],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      API.setSelectedElements([mast]);

      turn(19, -2);
      expect(h.elements.map((e) => e.id)).toEqual(["mast", "keel"]);
    });

    it("scrubs back through history", async () => {
      await bind();
      const rect = lantern();
      API.updateScene({
        elements: [rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      API.setSelectedElements([rect]);

      turn(22, -10);
      rest();
      expect(h.elements[0].opacity).toBe(80);
      turn(20, -2);
      expect(h.elements[0].opacity).toBe(100);
      turn(20, 2);
      expect(h.elements[0].opacity).toBe(80);
    });

    it("sizes the grid", async () => {
      await bind();
      turn(21, 5);
      expect(h.state.gridStep).toBe(10);
      press(21);
      expect(h.state.gridStep).toBe(5);
    });

    it("moves as far a click as the host says", async () => {
      await bind({ steps: { opacity: 10 } });
      const rect = lantern();
      API.updateScene({
        elements: [rect],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      API.setSelectedElements([rect]);
      turn(22, -3);
      expect(h.elements[0].opacity).toBe(70);
    });
  });

  describe("with nothing selected", () => {
    beforeEach(async () => {
      await renderWithKnobs();
    });

    it("sets the next shape's style", () => {
      turn(KNOB.opacity, -10);
      turn(KNOB.roughness, 4);
      turn(KNOB.fontSize, 8);
      expect(h.state.currentItemOpacity).toBe(80);
      expect(h.state.currentItemRoughness).toBeCloseTo(1.2, 5);
      expect(h.state.currentItemFontSize).toBe(28);

      const drawn = UI.createElement("rectangle", { x: 0, y: 0 });
      expect(drawn.opacity).toBe(80);
    });

    it("leaves the geometry knobs idle", () => {
      turn(KNOB.x, 10);
      expect(h.elements).toHaveLength(0);
    });

    it("zooms about the middle of the view, and a press goes back to 100%", () => {
      turn(KNOB.zoom, 10);
      expect(h.state.zoom.value).toBeCloseTo(1.02 ** 10, 4);
      press(KNOB.zoom);
      expect(h.state.zoom.value).toBeCloseTo(1, 4);
    });

    it("pans", () => {
      const { scrollX, scrollY } = h.state;
      turn(KNOB.panX, 2);
      turn(KNOB.panY, -1);
      expect(h.state.scrollX).toBe(scrollX - 24);
      expect(h.state.scrollY).toBe(scrollY + 12);
    });
  });

  describe("selecting by knob", () => {
    beforeEach(async () => {
      await renderWithKnobs();
      API.setElements([
        API.createElement({ type: "rectangle", id: "dusk", x: 0 }),
        API.createElement({ type: "ellipse", id: "lamp", x: 200 }),
        API.createElement({ type: "diamond", id: "tide", x: 400 }),
      ]);
    });

    it("steps through the scene in stacking order and wraps round", () => {
      turn(KNOB.select, 1);
      expect(Object.keys(h.state.selectedElementIds)).toEqual(["dusk"]);
      turn(KNOB.select, 1);
      expect(Object.keys(h.state.selectedElementIds)).toEqual(["lamp"]);
      turn(KNOB.select, -1);
      turn(KNOB.select, -1);
      expect(Object.keys(h.state.selectedElementIds)).toEqual(["tide"]);
    });

    it("lets go of the selection on a press", () => {
      turn(KNOB.select, 1);
      press(KNOB.select);
      expect(Object.keys(h.state.selectedElementIds)).toEqual([]);
    });
  });

  describe("learning", () => {
    beforeEach(plugIn);
    afterEach(unplug);

    it("binds the next knob turned, and tells the host", async () => {
      const learned: MidiBinding[][] = [];
      await renderWithKnobs({
        ...options,
        onBindingsChange: (bindings) => learned.push(bindings),
      });
      const rect = lantern();
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      await act(() => h.app.midi.learn("opacity"));
      expect(h.app.midi.connected).toBe(true);
      expect(h.state.toast?.message).toBe("Turn a knob to bind Opacity");

      // a knob on the Twister's third bank
      send([0xb0, 40, 65]);
      expect(learned).toHaveLength(1);
      expect(learned[0]).toContainEqual({
        channel: 1,
        cc: 40,
        target: "opacity",
      });

      turn(40, -5);
      expect(h.elements[0].opacity).toBe(90);
    });

    it("says so when the browser has no MIDI", async () => {
      unplug();
      await renderWithKnobs();
      await act(() => h.app.midi.learn("opacity"));
      expect(h.state.toast?.message).toBe(
        "MIDI isn't available in this browser",
      );
      send([0xb0, 40, 65]);
      expect(h.app.midi.bindings).toEqual(TWISTER_LAYOUT);
    });

    it("follows bindings the host keeps", async () => {
      await renderWithKnobs({
        ...options,
        bindings: [{ channel: 3, cc: 7, target: "opacity" }],
      });
      const rect = lantern();
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      turn(KNOB.opacity, -5);
      expect(h.elements[0].opacity).toBe(100);

      for (let i = 0; i < 5; i++) {
        send([0xb2, 7, 63]);
      }
      expect(h.elements[0].opacity).toBe(90);
    });
  });

  it("does nothing without the prop", async () => {
    await render(<Excalidraw />);
    const rect = lantern();
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    turn(KNOB.opacity, -5);
    expect(h.elements[0].opacity).toBe(100);
  });

  it("reads the Twister's factory absolute mode without jumps", async () => {
    await renderWithKnobs({ acceleration: false });
    const rect = lantern();
    API.setElements([rect]);
    API.setSelectedElements([rect]);

    // the knob was left near the top by last night's set
    send([0xb0, KNOB.opacity, 120]);
    send([0xb0, KNOB.opacity, 119]);
    send([0xb0, KNOB.opacity, 118]);
    expect(h.elements[0].opacity).toBe(96);
  });

  describe("connected to a controller", () => {
    beforeEach(plugIn);
    afterEach(unplug);

    it("listens to its inputs and lights its rings", async () => {
      await renderWithKnobs();
      const rect = API.createElement({
        type: "rectangle",
        id: "keeper",
        opacity: 50,
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      await act(async () => {
        expect(await h.app.midi.connect()).toBe(true);
      });
      expect(h.app.midi.connected).toBe(true);
      expect(listener).not.toBeNull();

      act(() => listener!({ data: new Uint8Array([0xb0, KNOB.opacity, 63]) }));
      expect(h.elements[0].opacity).toBe(48);

      // the opacity ring shows 48%; the x knob, a jog wheel, sits mid-ring
      expect(sent).toContainEqual([0xb0, KNOB.opacity, Math.round(0.48 * 127)]);
      expect(sent).toContainEqual([0xb0, KNOB.x, 64]);
    });

    it("stops listening on unmount", async () => {
      const { unmount } = await renderWithKnobs();
      await act(async () => {
        await h.app.midi.connect();
      });
      unmount();
      expect(listener).toBeNull();
    });
  });

  it("starts from the Twister layout", async () => {
    await renderWithKnobs(true);
    expect(h.app.midi.bindings).toEqual(TWISTER_LAYOUT);
  });
});
