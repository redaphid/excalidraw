import { MAX_ZOOM, MIN_ZOOM } from "@excalidraw/common";

import { clamp, round } from "@excalidraw/math";

import type { NormalizedZoomValue } from "../types";

/**
 * Six decimals, as upstream, or six significant figures, whichever keeps
 * more digits: six decimals alone would round a zoom of a millionth to 0.
 * Every zoom from 0.1 up rounds as upstream's does.
 */
export const getNormalizedZoom = (zoom: number): NormalizedZoomValue => {
  const clamped = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const decimals = Math.max(6, 5 - Math.floor(Math.log10(clamped)));
  return round(clamped, decimals) as NormalizedZoomValue;
};

export const getNormalizedGridSize = (gridStep: number) => {
  return clamp(Math.round(gridStep), 1, 100);
};

export const getNormalizedGridStep = (gridStep: number) => {
  return clamp(Math.round(gridStep), 1, 100);
};
