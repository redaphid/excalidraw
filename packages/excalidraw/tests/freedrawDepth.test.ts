import { pointFrom, type LocalPoint } from "@excalidraw/math";
import * as stock from "perfect-freehand";

import * as vendored from "../renderer/perfectFreehand";
import { getFreeDrawSvgPath } from "../renderer/renderElement";

import { API } from "./helpers/api";

import type { ExcalidrawFreeDrawElement } from "../element/types";

const DEEP_ZOOM = 100_000;

/**
 * An arch drawn at `zoom` with the thinnest pen scaled to it, `span` board
 * units wide and a third as tall.
 */
const arch = (span: number, zoom: number) =>
  API.createElement({
    type: "freedraw",
    strokeWidth: 1 / zoom,
    points: Array.from({ length: 21 }, (_, i) =>
      pointFrom<LocalPoint>(
        (i / 20) * span,
        Math.sin((i / 20) * Math.PI) * (span / 3),
      ),
    ),
  }) as ExcalidrawFreeDrawElement;

const pathCoordinates = (path: string) =>
  path.match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];

const pathPoints = (path: string) => {
  const coordinates = pathCoordinates(path);
  return Array.from({ length: coordinates.length / 2 }, (_, i) => [
    coordinates[2 * i],
    coordinates[2 * i + 1],
  ]);
};

/** Excalidraw's options for a freedraw stroke, as in getFreeDrawSvgPath. */
const excalidrawOptions = (size: number, simulatePressure: boolean) => ({
  simulatePressure,
  size,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  last: false,
});

/** How far the outline's top misses the centerline's, in pens. */
const missAtPeak = (element: ExcalidrawFreeDrawElement) => {
  const size = element.strokeWidth * 4.25;
  const center = vendored.getStrokePoints(
    element.points as unknown as number[][],
    excalidrawOptions(size, true),
  );
  const peak = Math.max(...center.map(({ point: [, y] }) => y));
  const top = Math.max(
    ...pathPoints(getFreeDrawSvgPath(element)).map(([, y]) => y),
  );
  return Math.abs(top - peak) / size;
};

describe("a stroke a thousandth of a unit wide, drawn at 100,000x", () => {
  const path = () => getFreeDrawSvgPath(arch(0.001, DEEP_ZOOM));

  it("has a path", () => {
    expect(pathCoordinates(path()).length).toBeGreaterThan(8);
  });

  it("keeps its coordinates past two decimals", () => {
    const xs = pathCoordinates(path()).filter((_, i) => i % 2 === 0);
    expect(new Set(xs.map((x) => Math.round(x * 100))).size).toBeLessThan(
      new Set(xs).size,
    );
  });
});

describe("the outline of a stroke drawn at 100,000x", () => {
  const element = () => arch(0.001, DEEP_ZOOM);

  it("keeps the stroke's body, reaching its peak", () => {
    expect(missAtPeak(element())).toBeLessThan(1);
  });

  it("spans the stroke's width", () => {
    const xs = pathPoints(getFreeDrawSvgPath(element())).map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.001 * 0.9);
  });

  it("is no thicker than the pen", () => {
    const size = element().strokeWidth * 4.25;
    const extent = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
    const center = vendored
      .getStrokePoints(
        element().points as unknown as number[][],
        excalidrawOptions(size, true),
      )
      .map(({ point: [, y] }) => y);
    const outline = pathPoints(getFreeDrawSvgPath(element())).map(([, y]) => y);
    expect(extent(outline)).toBeLessThanOrEqual(extent(center) + size);
  });
});

describe("a stroke drawn at 1x", () => {
  it("keeps its shape", () => {
    expect(missAtPeak(arch(100, 1))).toBeLessThan(1);
  });

  // mulberry32: the same strokes every run.
  const random = (() => {
    let seed = 0x5eed;
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  const strokes = Array.from({ length: 200 }, (_, i) => {
    const length = 2 + Math.floor(random() * 40);
    let x = random() * 100;
    let y = random() * 100;
    const points = Array.from({ length }, () => {
      x += (random() - 0.5) * 20;
      y += (random() - 0.5) * 20;
      return [x, y, random()];
    });
    return {
      points,
      size: 4.25 * [1, 1, 2, 4][i % 4],
      simulatePressure: i % 2 === 0,
    };
  });

  it("gets exactly perfect-freehand 1.2.0's outline from Excalidraw's thinnest pen up", () => {
    const outlines = (freehand: Pick<typeof vendored, "getStroke">) =>
      strokes.map(({ points, size, simulatePressure }) =>
        freehand.getStroke(points, excalidrawOptions(size, simulatePressure)),
      );
    expect(outlines(vendored)).toEqual(outlines(stock));
  });
});
