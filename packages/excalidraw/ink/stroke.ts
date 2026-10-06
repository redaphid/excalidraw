import {
  getSimulatedPressure,
  getStrokeRadius,
  getVariableWidthFreedrawStrokeOptions,
  streamStrokePoints,
} from "@excalidraw/element";

// A freedraw line as perfect-freehand smooths it, one sample at a time:
// `streamStrokePoints` is the loop `getStrokePoints` runs over a finished
// stroke, and the options are the ones the committed element is outlined
// with, so the ink lands where the committed stroke will.

export type Sample = { x: number; y: number; pressure: number };
export type Dab = { x: number; y: number; r: number };

/** How the pointer is read: the freedraw element's own options. */
export type Input = {
  simulatePressure: boolean;
  /** perfect-freehand's streamline: how far the line lags behind the pointer. */
  streamline: number;
};

export type Pen = Input & {
  strokeWidth: number;
  /** Raw samples nearer than this to the last one are dropped, in scene units. */
  minStep?: number;
};

/** The outline's floor, as the vendored perfect-freehand clamps it. */
const MIN_RADIUS = 1e-9;

/** A dab's radius at `pressure`, as perfect-freehand sizes the outline there. */
export const radiusFor = (strokeWidth: number, pressure: number) => {
  const { size, thinning, easing } = getVariableWidthFreedrawStrokeOptions({
    strokeWidth,
    simulatePressure: false,
  });
  return Math.max(
    MIN_RADIUS,
    getStrokeRadius(size, thinning, pressure, easing),
  );
};

export type Stroke = {
  /** Records a raw sample and returns the dab it settles into, if any. */
  add(sample: Sample): Dab | null;
  /** A provisional dab at a raw or predicted sample, ahead of the streamlining. */
  tip(sample: Sample): Dab;
  samples(): readonly Sample[];
};

export const createStroke = (pen: Pen): Stroke => {
  const { size, streamline } = getVariableWidthFreedrawStrokeOptions({
    strokeWidth: pen.strokeWidth,
    simulatePressure: pen.simulatePressure,
    strokeOptions: { variability: "variable", streamline: pen.streamline },
  });
  const radius = (pressure: number) => radiusFor(pen.strokeWidth, pressure);
  // A simulated stroke reports no pressure, as the element stores none.
  const input = (s: Sample) =>
    pen.simulatePressure ? [s.x, s.y] : [s.x, s.y, s.pressure];
  const samples: Sample[] = [];
  let points: ReturnType<typeof streamStrokePoints> | null = null;
  let pressure = 0;

  return {
    add(s) {
      const prev = samples.at(-1);
      const step = prev ? Math.hypot(s.x - prev.x, s.y - prev.y) : Infinity;
      if (step < (pen.minStep ?? 0)) {
        return null;
      }
      samples.push(s);
      if (!points) {
        points = streamStrokePoints(input(s), { size, streamline });
        pressure = points.strokePoints[0].pressure;
        return { x: s.x, y: s.y, r: radius(pressure) };
      }
      const point = points.add(input(s));
      if (!point) {
        return null;
      }
      pressure = pen.simulatePressure
        ? getSimulatedPressure(pressure, point.distance, size)
        : point.pressure;
      return { x: point.point[0], y: point.point[1], r: radius(pressure) };
    },
    tip(s) {
      return {
        x: s.x,
        y: s.y,
        r: radius(pen.simulatePressure ? pressure : s.pressure),
      };
    },
    samples: () => samples,
  };
};
