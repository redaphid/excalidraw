import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { getFreedrawOutlinePoints } from "../src";
import { getStroke, IncrementalStroke } from "../src/perfectFreehand";

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
): StrokeOptions => ({
  simulatePressure,
  size,
  thinning: 0.6,
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
  }));

  it.each(cases)(
    "outlines each point of a growing stroke as getStroke does ($length points, simulatePressure $simulatePressure, streamline $streamline, size $size)",
    ({ length, simulatePressure, streamline, size }) => {
      const { points, pressures } = randomStroke(random, length, size / 4.25);
      const options = excalidrawOptions(size, simulatePressure, streamline);
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
  it("is outlined from all its points after every move", () => {
    const random = seeded(0xd4a);
    const { points, pressures } = randomStroke(random, 300, 1);
    const other = randomStroke(random, 80, 1);
    const options = excalidrawOptions(4.25, false, 0.5);

    const element = (
      n: number,
      stroke = { points, pressures },
    ): ExcalidrawFreeDrawElement => ({
      ...(API.createElement({
        type: "freedraw",
        strokeWidth: 1,
        strokeOptions: { variability: "variable", streamline: 0.5 },
        points: stroke.points
          .slice(0, n)
          .map(([x, y]) => pointFrom<LocalPoint>(x, y)),
      }) as ExcalidrawFreeDrawElement),
      // a pen's pressure, which createElement does not take
      simulatePressure: false,
      pressures: stroke.pressures.slice(0, n),
    });

    for (let n = 1; n <= points.length; n++) {
      // another stroke outlined between two moves
      if (n % 50 === 0) {
        getFreedrawOutlinePoints(element(other.points.length, other));
      }
      const drawn = element(n);
      expect(getFreedrawOutlinePoints(drawn)).toEqual(
        getStroke(
          drawn.points.map(([x, y], i) => [x, y, pressures[i]]),
          options,
        ),
      );
    }
  });
});
