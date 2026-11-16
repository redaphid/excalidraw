import { MAX_ZOOM, MIN_ZOOM } from "@excalidraw/common";

import { clamp, round } from "@excalidraw/math";

import type { NormalizedZoomValue } from "../types";

/**
 * From 0.1 up, six decimals, as upstream. Under it, where six decimals would
 * round a zoom of a millionth to 0, seven significant figures: a zoom moves
 * by at most 5e-7 of itself there, and by up to 5e-6 at 0.1 as upstream's.
 */
export const getNormalizedZoom = (zoom: number): NormalizedZoomValue => {
  const clamped = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const decimals = clamped >= 0.1 ? 6 : 6 - Math.floor(Math.log10(clamped));
  return round(clamped, decimals) as NormalizedZoomValue;
};

/** a zoom as a percent: whole from 1% up, two significant digits under */
export const formatZoomPercent = (zoom: number) => {
  const percent = zoom * 100;
  return percent >= 1
    ? percent.toFixed(0)
    : String(Number(percent.toPrecision(2)));
};

export const getNormalizedGridSize = (gridStep: number) => {
  return clamp(Math.round(gridStep), 1, 100);
};

export const getNormalizedGridStep = (gridStep: number) => {
  return clamp(Math.round(gridStep), 1, 100);
};
