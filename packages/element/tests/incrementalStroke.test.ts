import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { ShapeCache, getFreedrawOutlinePoints } from "../src";
import { IncrementalStroke } from "../src/perfectFreehand";
import { IncrementalSvgPath } from "../src/shape";

import {
  getSvgPathFromStroke,
  getVariableWidthFreedrawOutline,
} from "./fixtures/freedrawReference";
import { getStroke } from "./fixtures/perfectFreehandReference";

import type { StrokeOptions } from "../src/perfectFreehand";
import type { ExcalidrawFreeDrawElement } from "../src/types";

// mulberry32: the same strokes every run.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** a pen wandering with pauses (repeated points) and sharp turns */
const randomStroke = (random: () => number, length: number, scale: number) => {
  let x = random() * 100 * scale;
  let y = random() * 100 * scale;
  let heading = random() * Math.PI * 2;
  const points: number[][] = [];
  const pressures: number[] = [];
  for (let i = 0; i < length; i++) {
    const roll = random();
    if (roll < 0.05) {
      heading += Math.PI * (0.6 + random() * 0.5);
    } else if (roll > 0.1) {
      heading += (random() - 0.5) * 0.8;
      const step = random() * 12 * scale;
      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
    }
    points.push([x, y]);
    pressures.push(random());
  }
  return { points, pressures };
};

// Excalidraw's options for a pressure-sensitive stroke.
const excalidrawOptions = (
  size: number,
  simulatePressure: boolean,
  streamline: number,
  thinning = 0.6,
): StrokeOptions => ({
  simulatePressure,
  size,
  thinning,
  smoothing: 0.5,
  streamline,
  easing: (t) => Math.sin((t * Math.PI) / 2),
  last: true,
});

const withPressures = (points: number[][], pressures: number[]) =>
  points.map(([x, y], i) => [x, y, pressures[i]]);

describe("IncrementalStroke", () => {
  const random = seeded(0x0de1);

  const cases = Array.from({ length: 24 }, (_, i) => ({
    length: [40, 150, 400][i % 3],
    simulatePressure: i % 2 === 0,
    streamline: [0.5, 0.25, 0.7][i % 3],
    // a 1x pen, a thick one, and pens drawn deep in a zoom
    size: [4.25, 17, 4.25e-3, 4.25e-6][i % 4],
    thinning: [0.6, 0, 0.3][(i >> 2) % 3],
  }));

  it.each(cases)(
    "outlines each point of a growing stroke as getStroke does ($length points, simulatePressure $simulatePressure, streamline $streamline, size $size, thinning $thinning)",
    ({ length, simulatePressure, streamline, size, thinning }) => {
      const { points, pressures } = randomStroke(random, length, size / 4.25);
      const options = excalidrawOptions(
        size,
        simulatePressure,
        streamline,
        thinning,
      );
      const stroke = new IncrementalStroke(options);

      for (let n = 1; n <= length; n++) {
        const drawn = points.slice(0, n);
        const outline = simulatePressure
          ? stroke.getOutline(drawn)
          : stroke.getOutline(drawn, pressures.slice(0, n));
        const input = simulatePressure
          ? drawn
          : withPressures(drawn, pressures.slice(0, n));
        expect(outline).toEqual(getStroke(input, options));
      }
    },
  );

  it.each([
    { name: "a stroke in progress", last: false, start: {}, end: {} },
    {
      name: "tapered ends",
      last: true,
      start: { taper: 20 },
      end: { taper: 30 },
    },
    {
      name: "tapers the length of the stroke",
      last: true,
      start: { taper: true },
      end: { taper: true },
    },
    {
      name: "flat caps",
      last: true,
      start: { cap: false },
      end: { cap: false },
    },
  ])("matches getStroke with $name", ({ last, start, end }) => {
    const { points } = randomStroke(random, 200, 1);
    const options: StrokeOptions = { size: 8, last, start, end };
    const stroke = new IncrementalStroke(options);
    for (let n = 1; n <= points.length; n++) {
      expect(stroke.getOutline(points.slice(0, n))).toEqual(
        getStroke(points.slice(0, n), options),
      );
    }
  });

  it("starts over when an earlier point changes", () => {
    const { points } = randomStroke(random, 120, 1);
    const options = excalidrawOptions(4.25, true, 0.5);
    const stroke = new IncrementalStroke(options);
    stroke.getOutline(points);

    const moved = points.map(([x, y]) => [x + 3, y]);
    expect(stroke.getOutline(moved)).toEqual(getStroke(moved, options));

    const shorter = moved.slice(0, 60);
    expect(stroke.getOutline(shorter)).toEqual(getStroke(shorter, options));
  });

  it("starts over when an earlier pressure changes", () => {
    const { points, pressures } = randomStroke(random, 120, 1);
    const options = excalidrawOptions(4.25, false, 0.5);
    const stroke = new IncrementalStroke(options);
    stroke.getOutline(points, pressures);

    const lighter = pressures.map((pressure) => pressure / 2);
    expect(stroke.getOutline(points, lighter)).toEqual(
      getStroke(withPressures(points, lighter), options),
    );
  });
});

describe("a freedraw element drawn point by point", () => {
  const pathOf = (element: ExcalidrawFreeDrawElement) =>
    (ShapeCache.generateElementShape(element, null) as unknown[]).find(
      (shape) => typeof shape === "string",
    );

  it.each([
    { simulatePressure: false, strokeOptions: {} },
    { simulatePressure: true, strokeOptions: { streamline: 0.25 } },
    { simulatePressure: false, strokeOptions: { thinning: 0 } },
    { simulatePressure: true, strokeOptions: { thinning: 0.9 } },
    { simulatePressure: false, strokeOptions: { taper: 2 } },
    { simulatePressure: true, strokeOptions: { taper: 0.5, thinning: 0 } },
  ])(
    "is outlined and pathed as before after every move ($strokeOptions, simulatePressure $simulatePressure)",
    ({ simulatePressure, strokeOptions }) => {
      const random = seeded(0xd4a);
      const { points, pressures } = randomStroke(random, 300, 1);
      const other = randomStroke(random, 80, 1);

      const element = (
        n: number,
        strokeWidth: number,
        stroke = { points, pressures },
      ): ExcalidrawFreeDrawElement => ({
        ...(API.createElement({
          type: "freedraw",
          strokeWidth,
          strokeOptions: {
            variability: "variable",
            streamline: 0.5,
            ...strokeOptions,
          },
          points: stroke.points
            .slice(0, n)
            .map(([x, y]) => pointFrom<LocalPoint>(x, y)),
        }) as ExcalidrawFreeDrawElement),
        // a pen's pressure, which createElement does not take
        simulatePressure,
        pressures: stroke.pressures.slice(0, n),
      });

      for (let n = 1; n <= points.length; n++) {
        // another stroke outlined between two moves, as an export or a hit
        // test would
        if (n % 50 === 0) {
          const between = element(other.points.length, 1, other);
          expect(pathOf(between)).toBe(
            getSvgPathFromStroke(getVariableWidthFreedrawOutline(between)),
          );
        }
        // the pen width changes half way through
        const drawn = element(n, n < 150 ? 1 : 2);
        const outline = getVariableWidthFreedrawOutline(drawn);
        expect(getFreedrawOutlinePoints(drawn)).toEqual(outline);
        expect(pathOf(drawn)).toBe(getSvgPathFromStroke(outline));
      }
    },
  );
});

describe("IncrementalSvgPath", () => {
  it.each([
    { pen: "variable", simulatePressure: true },
    { pen: "variable", simulatePressure: false },
    { pen: "constant", simulatePressure: true },
  ] as const)(
    "paths each outline of a growing $pen stroke as before (simulatePressure $simulatePressure)",
    ({ pen, simulatePressure }) => {
      const random = seeded(0x9a7);
      const { points, pressures } = randomStroke(random, 300, 1);
      const path = new IncrementalSvgPath();
      for (let n = 1; n <= points.length; n++) {
        const element: ExcalidrawFreeDrawElement = {
          ...(API.createElement({
            type: "freedraw",
            strokeOptions: { variability: pen, streamline: 0.5 },
            points: points
              .slice(0, n)
              .map(([x, y]) => pointFrom<LocalPoint>(x, y)),
          }) as ExcalidrawFreeDrawElement),
          simulatePressure,
          pressures: pressures.slice(0, n),
        };
        const outline = getFreedrawOutlinePoints(element);
        expect(path.getPath(outline)).toBe(getSvgPathFromStroke(outline));
      }
    },
  );

  it("paths outlines edited anywhere as before", () => {
    const random = seeded(0xed17);
    let outline = randomStroke(random, 40, 1).points;
    const path = new IncrementalSvgPath();
    for (let edit = 0; edit < 500; edit++) {
      const at = Math.floor(random() * outline.length);
      const point = [random() * 100, random() * 100];
      const roll = random();
      outline =
        roll < 0.3
          ? [...outline.slice(0, at), point, ...outline.slice(at)]
          : roll < 0.6 && outline.length > 1
          ? [...outline.slice(0, at), ...outline.slice(at + 1)]
          : outline.map((old, i) => (i === at ? point : old));
      expect(path.getPath(outline)).toBe(getSvgPathFromStroke(outline));
    }
  });

  it("paths an outline that differs only in its first point", () => {
    const random = seeded(0x52);
    const outline = randomStroke(random, 50, 1).points;
    const path = new IncrementalSvgPath();
    path.getPath(outline);
    const moved = outline.map(([x, y], i) => (i === 0 ? [x + 1, y] : [x, y]));
    expect(path.getPath(moved)).toBe(getSvgPathFromStroke(moved));
  });

  it("paths an outline that differs only in its middle", () => {
    const random = seeded(0x51);
    const outline = randomStroke(random, 50, 1).points;
    const path = new IncrementalSvgPath();
    path.getPath(outline);
    const bent = outline.map(([x, y], i) => (i === 25 ? [x + 1, y] : [x, y]));
    expect(path.getPath(bent)).toBe(getSvgPathFromStroke(bent));
    expect(path.getPath(outline.slice(0, 1))).toBe(
      getSvgPathFromStroke(outline.slice(0, 1)),
    );
  });
});
