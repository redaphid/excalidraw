// Test-only: the variable-width freedraw outline and its SVG path as
// shape.ts built them before the stroke was outlined incrementally
// (5780bd68), kept verbatim as the oracle for the incremental ones.
import { DEFAULT_STROKE_STREAMLINE } from "@excalidraw/common";

import { getStroke } from "./perfectFreehandReference";

import type { ExcalidrawFreeDrawElement } from "../../src/types";

const VARIABLE_WIDTH_FREEDRAW = {
  /** Stroke size relative to `strokeWidth` for pressure-sensitive strokes. */
  SIZE_FACTOR: 4.25,
  THINNING: 0.6,
  SMOOTHING: 0.5,
} as const;

const getFreedrawStreamline = (element: ExcalidrawFreeDrawElement) =>
  element.strokeOptions?.streamline ?? DEFAULT_STROKE_STREAMLINE;

export const getVariableWidthFreedrawOutline = (
  element: ExcalidrawFreeDrawElement,
): [number, number][] => {
  // If input points are empty (should they ever be?) return a dot
  const inputPoints = element.simulatePressure
    ? element.points
    : element.points.length
    ? element.points.map(
        ([x, y], i) => [x, y, element.pressures[i]] as [number, number, number],
      )
    : [[0, 0, 0.5]];

  const size = element.strokeWidth * VARIABLE_WIDTH_FREEDRAW.SIZE_FACTOR;
  const taper = element.strokeOptions?.taper;
  return getStroke(inputPoints as number[][], {
    simulatePressure: element.simulatePressure,
    size,
    thinning:
      element.strokeOptions?.thinning ?? VARIABLE_WIDTH_FREEDRAW.THINNING,
    smoothing: VARIABLE_WIDTH_FREEDRAW.SMOOTHING,
    streamline: getFreedrawStreamline(element),
    easing: (t) => Math.sin((t * Math.PI) / 2), // https://easings.net/#easeOutSine
    ...(taper && {
      start: { taper: taper * size },
      end: { taper: taper * size },
    }),
    last: true,
  }) as [number, number][];
};

const med = (A: number[], B: number[]) => {
  return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
};

export const getSvgPathFromStroke = (points: number[][]): string => {
  if (!points.length) {
    return "";
  }

  const max = points.length - 1;

  // Full precision: cut to two decimals, a stroke drawn deep in a zoom turns
  // into a staircase or collapses to a dot, and the cut costs more than the
  // text it trims.
  return points
    .reduce(
      (acc, point, i, arr) => {
        if (i === max) {
          acc.push(point, med(point, arr[0]), "L", arr[0], "Z");
        } else {
          acc.push(point, med(point, arr[i + 1]));
        }
        return acc;
      },
      ["M", points[0], "Q"],
    )
    .join(" ");
};
