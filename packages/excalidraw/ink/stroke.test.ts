import { beforeEach, describe, expect, it } from "vitest";
import { getStrokePoints } from "@excalidraw/element/perfectFreehand";

import { createStroke, type Dab, radiusFor, type Stroke } from "./stroke";

describe("radiusFor", () => {
  describe("when a thin pen presses as hard as it can", () => {
    let result: number;

    beforeEach(() => {
      result = radiusFor(1, 1);
    });

    it("should match what perfect-freehand draws for Excalidraw", () => {
      expect(result).toBeCloseTo(4.042, 3);
    });
  });

  describe("when a thin pen barely touches the glass", () => {
    let result: number;

    beforeEach(() => {
      result = radiusFor(1, 0);
    });

    it("should thin the line to under a third of its size", () => {
      expect(result).toBeCloseTo(1.313, 3);
    });
  });
});

describe("createStroke", () => {
  describe("when a mouse-smoothed pen draws a thin line", () => {
    let stroke: Stroke;

    beforeEach(() => {
      stroke = createStroke({
        strokeWidth: 1,
        simulatePressure: false,
        streamline: 0.5,
      });
    });

    describe("when the nib lands on the tide chart", () => {
      let result: Dab | null;

      beforeEach(() => {
        result = stroke.add({ x: 100, y: 200, pressure: 1 });
      });

      it("should put the first dab exactly under the nib", () => {
        expect(result).toEqual({ x: 100, y: 200, r: radiusFor(1, 1) });
      });
    });

    describe("when the nib has only just started moving", () => {
      let result: Dab | null;

      beforeEach(() => {
        stroke.add({ x: 100, y: 200, pressure: 1 });
        result = stroke.add({ x: 102, y: 200, pressure: 1 });
      });

      it("should wait for the line to outgrow the nib, as perfect-freehand does", () => {
        expect(result).toBeNull();
      });
    });

    describe("when the nib has only just started moving and is still remembered", () => {
      beforeEach(() => {
        stroke.add({ x: 100, y: 200, pressure: 1 });
        stroke.add({ x: 102, y: 200, pressure: 1 });
      });

      it("should keep the raw sample for the element", () => {
        expect(stroke.samples()).toHaveLength(2);
      });
    });

    describe("when the nib sweeps well past its own size", () => {
      let result: Dab | null;

      beforeEach(() => {
        stroke.add({ x: 100, y: 200, pressure: 1 });
        result = stroke.add({ x: 140, y: 200, pressure: 1 });
      });

      it("should streamline the dab 57.5% of the way there", () => {
        expect(result?.x).toBeCloseTo(123, 6);
      });
    });

    describe("when the nib sweeps on and then keeps going", () => {
      let result: Dab | null;

      beforeEach(() => {
        stroke.add({ x: 100, y: 200, pressure: 1 });
        stroke.add({ x: 140, y: 200, pressure: 1 });
        result = stroke.add({ x: 180, y: 200, pressure: 1 });
      });

      it("should streamline from the last dab, not from the raw sample", () => {
        expect(result?.x).toBeCloseTo(123 + (180 - 123) * 0.575, 6);
      });
    });

    describe("when the pen lifts a little mid-sweep", () => {
      let result: Dab | null;

      beforeEach(() => {
        stroke.add({ x: 100, y: 200, pressure: 1 });
        result = stroke.add({ x: 140, y: 200, pressure: 0.3 });
      });

      it("should take the pressure the pen reported", () => {
        expect(result?.r).toBeCloseTo(radiusFor(1, 0.3), 6);
      });
    });
  });

  describe("when a pen draws with Excalidraw's streamline for pens", () => {
    let result: Dab | null;

    beforeEach(() => {
      const stroke = createStroke({
        strokeWidth: 1,
        simulatePressure: false,
        streamline: 0.2,
      });
      stroke.add({ x: 100, y: 200, pressure: 1 });
      result = stroke.add({ x: 140, y: 200, pressure: 1 });
    });

    it("should streamline the dab 83% of the way there", () => {
      expect(result?.x).toBeCloseTo(133.2, 6);
    });
  });

  describe("when a mouse draws, so pressure is simulated", () => {
    let stroke: Stroke;

    beforeEach(() => {
      stroke = createStroke({
        strokeWidth: 1,
        simulatePressure: true,
        streamline: 0.5,
      });
    });

    describe("when the button goes down", () => {
      let result: Dab | null;

      beforeEach(() => {
        result = stroke.add({ x: 0, y: 0, pressure: 0.5 });
      });

      it("should start as thin as perfect-freehand starts a mouse line", () => {
        expect(result?.r).toBeCloseTo(radiusFor(1, 0.25), 6);
      });
    });

    describe("when the mouse flicks away", () => {
      let result: Dab | null;

      beforeEach(() => {
        stroke.add({ x: 0, y: 0, pressure: 0.5 });
        result = stroke.add({ x: 40, y: 0, pressure: 0.5 });
      });

      it("should thin the line, as a quick stroke of a real pen would", () => {
        expect(result?.r).toBeLessThan(radiusFor(1, 0.25));
      });
    });
  });

  describe("when the stroke keeps samples closer together than a pixel apart", () => {
    let stroke: Stroke;

    beforeEach(() => {
      stroke = createStroke({
        strokeWidth: 1,
        simulatePressure: false,
        streamline: 0.2,
        minStep: 0.5,
      });
      stroke.add({ x: 0, y: 0, pressure: 0.5 });
      stroke.add({ x: 0.2, y: 0.2, pressure: 0.5 });
    });

    it("should drop the jitter", () => {
      expect(stroke.samples()).toHaveLength(1);
    });
  });

  describe("when asked where the tip is", () => {
    let result: Dab;

    beforeEach(() => {
      const stroke = createStroke({
        strokeWidth: 2,
        simulatePressure: false,
        streamline: 0.2,
      });
      stroke.add({ x: 0, y: 0, pressure: 0.7 });
      result = stroke.tip({ x: 3, y: 4, pressure: 0.2 });
    });

    it("should reach the raw sample with the pressure the pen reports", () => {
      expect(result).toEqual({ x: 3, y: 4, r: radiusFor(2, 0.2) });
    });
  });
});

describe("when a pen signs its name and the element is outlined afterwards", () => {
  let dabs: [number, number][];
  let centerline: [number, number][];

  beforeEach(() => {
    const samples = Array.from({ length: 40 }, (_, i) => ({
      x: 10 + i * 2.5,
      y: 40 + Math.sin(i / 4) * 12,
      pressure: 0.4 + (i % 7) / 20,
    }));
    const stroke = createStroke({
      strokeWidth: 1,
      simulatePressure: false,
      streamline: 0.2,
    });
    dabs = samples
      .map((s) => stroke.add(s))
      .filter((d): d is Dab => d !== null)
      .map((d) => [d.x, d.y]);
    centerline = getStrokePoints(
      samples.map((s) => [s.x, s.y, s.pressure]),
      { size: 4.25, streamline: 0.2 },
    ).map((p) => p.point as [number, number]);
  });

  it("should settle every dab on the centerline perfect-freehand outlines", () => {
    expect(dabs).toEqual(centerline.slice(0, dabs.length));
  });
});
