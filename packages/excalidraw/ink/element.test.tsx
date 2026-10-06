import { getNormalizedZoom } from "../scene";
import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { act, render } from "../tests/test-utils";

import {
  type Freedraw,
  freedrawThrough,
  indexAfter,
  newFreedrawAt,
} from "./element";

import type { Sample } from "./stroke";

const { h } = window;

const PEN = { pointerType: "pen", pressure: 0.5 };

describe("newFreedrawAt", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  describe("when the keeper starts a stroke a hundredfold zoomed in, in screen units", () => {
    let result: Freedraw;

    beforeEach(async () => {
      await render(
        <Excalidraw authoringUnits="screen" freedrawStrokeWidth={3} />,
      );
      API.setAppState({
        zoom: { value: getNormalizedZoom(100) },
        currentItemStrokeColor: "#e03131",
      });
      result = newFreedrawAt(h.app, { x: 40, y: 60 }, PEN);
    });

    it("should anchor the element where the nib landed", () => {
      expect([result.x, result.y]).toEqual([40, 60]);
    });

    it("should draw as wide on screen as the editor's own strokes", () => {
      expect(result.strokeWidth).toBeCloseTo(0.03, 12);
    });

    it("should carry the authoring scale the fork sizes details by", () => {
      expect(result.authoringScale).toBeCloseTo(0.01, 12);
    });

    it("should take the current stroke colour", () => {
      expect(result.strokeColor).toBe("#e03131");
    });

    it("should trust a pen that lands at exactly half pressure", () => {
      expect(result.simulatePressure).toBe(false);
    });

    it("should keep the pen's first pressure", () => {
      expect(result.pressures).toEqual([0.5]);
    });

    it("should smooth a pen as little as the editor does", () => {
      expect(result.strokeOptions.streamline).toBe(0.2);
    });

    it("should start its lifetime now", () => {
      expect(result.created).toBe(result.updated);
    });

    it("should carry no lastCommittedPoint, which master's format dropped", () => {
      expect(result).not.toHaveProperty("lastCommittedPoint");
    });
  });

  describe("when a mouse starts a stroke inside a frame", () => {
    let result: Freedraw;
    let frameId: string;

    beforeEach(async () => {
      await render(<Excalidraw />);
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 500,
        height: 300,
      });
      frameId = frame.id;
      API.setElements([frame]);
      result = newFreedrawAt(
        h.app,
        { x: 250, y: 150 },
        { pointerType: "mouse", pressure: 0.5 },
      );
    });

    it("should put the stroke in that frame", () => {
      expect(result.frameId).toBe(frameId);
    });

    it("should simulate the mouse's pressure from its speed", () => {
      expect(result.simulatePressure).toBe(true);
    });

    it("should keep no pressures", () => {
      expect(result.pressures).toEqual([]);
    });

    it("should smooth a mouse more", () => {
      expect(result.strokeOptions.streamline).toBe(0.5);
    });
  });
});

describe("freedrawThrough", () => {
  let start: Freedraw;

  afterEach(async () => {
    await act(async () => {});
  });

  beforeEach(async () => {
    await render(<Excalidraw />);
    start = newFreedrawAt(h.app, { x: 100, y: 50 }, PEN);
  });

  describe("when the keeper sketches a wave with a pen", () => {
    let samples: Sample[];
    let result: Freedraw;

    beforeEach(() => {
      samples = [
        { x: 100, y: 50, pressure: 0.4 },
        { x: 130, y: 20, pressure: 0.8 },
        { x: 90, y: 70, pressure: 0.6 },
      ];
      result = freedrawThrough(start, samples, { zoom: getNormalizedZoom(1) });
    });

    it("should keep its points relative to the anchor", () => {
      expect(result.points).toEqual([
        [0, 0],
        [30, -30],
        [-10, 20],
      ]);
    });

    it("should keep the pressures the pen reported", () => {
      expect(result.pressures).toEqual([0.4, 0.8, 0.6]);
    });

    it("should size the element to its points", () => {
      expect([result.width, result.height]).toEqual([40, 50]);
    });

    it("should be a newer version than the one it started as", () => {
      expect(result.version).toBeGreaterThan(start.version);
    });

    it("should keep the id collaborators already have", () => {
      expect(result.id).toBe(start.id);
    });
  });

  describe("when the stroke ends near where it began", () => {
    const loop: Sample[] = [
      { x: 100, y: 50, pressure: 0.5 },
      { x: 160, y: 50, pressure: 0.5 },
      { x: 130, y: 90, pressure: 0.5 },
      { x: 103, y: 52, pressure: 0.5 },
    ];

    describe("when it is committed", () => {
      let result: Freedraw;

      beforeEach(() => {
        result = freedrawThrough(start, loop, { zoom: getNormalizedZoom(1) });
      });

      it("should close the loop, as the editor's finalize does", () => {
        expect(result.points.at(-1)).toEqual([0, 0]);
      });
    });

    describe("when it is only streamed so far", () => {
      let result: Freedraw;

      beforeEach(() => {
        result = freedrawThrough(start, loop);
      });

      it("should leave the end where the pen is", () => {
        expect(result.points.at(-1)).toEqual([3, 2]);
      });
    });
  });

  describe("when a pen only taps", () => {
    let result: Freedraw;

    beforeEach(() => {
      result = freedrawThrough(start, [{ x: 100, y: 50, pressure: 0.7 }], {
        zoom: getNormalizedZoom(1),
      });
    });

    it("should nudge a second point off the first so the dot renders", () => {
      expect(result.points).toEqual([
        [0, 0],
        [0.0001, 0.0001],
      ]);
    });

    it("should give the nudge the tap's pressure", () => {
      expect(result.pressures).toEqual([0.7, 0.7]);
    });
  });
});

describe("indexAfter", () => {
  describe("when the scene is empty", () => {
    let result: string | null;

    beforeEach(() => {
      result = indexAfter([]);
    });

    it("should start the order", () => {
      expect(result).toBe("a0");
    });
  });

  describe("when the topmost element sits at a4", () => {
    let result: string | null;

    beforeEach(() => {
      result = indexAfter([
        { index: "a1" as Freedraw["index"] },
        { index: "a4" as Freedraw["index"] },
      ]);
    });

    it("should stack the stroke above it", () => {
      expect(result).toBe("a5");
    });
  });

  describe("when the topmost element has a broken index", () => {
    let result: string | null;

    beforeEach(() => {
      result = indexAfter([{ index: "a10" as Freedraw["index"] }]);
    });

    it("should leave the index for the editor to repair", () => {
      expect(result).toBeNull();
    });
  });
});
