/**
 * The size a person gave the radial palette's ring on this device, against
 * its own: dragging its corner scales it as a frame's corner does.
 */

import { MIN_RING_SCALE, RING_RADIUS } from "./radialLayout";

export const MAX_RING_SCALE = 1.6;

/** a corner dropped this far in, as a size, folds the ring into the puck */
export const FOLD_RING_SCALE = 0.4;

export const RING_SCALE_STORAGE_KEY = "excalidraw-radial-ring-scale";

const clampRingScale = (scale: number) =>
  Math.min(MAX_RING_SCALE, Math.max(MIN_RING_SCALE, scale));

/** the size, unclamped, whose corner sits `distance` from the centre */
export const rawRingScaleAt = (distance: number) =>
  distance / (RING_RADIUS * Math.SQRT2);

/** the size whose corner sits `distance` from the centre */
export const ringScaleAt = (distance: number) =>
  clampRingScale(rawRingScaleAt(distance));

export const loadRingScale = (win: Window): number => {
  try {
    const kept = JSON.parse(
      win.localStorage.getItem(RING_SCALE_STORAGE_KEY) ?? "null",
    );
    return typeof kept === "number" && Number.isFinite(kept)
      ? clampRingScale(kept)
      : 1;
  } catch {
    return 1;
  }
};

export const saveRingScale = (win: Window, scale: number) => {
  try {
    win.localStorage.setItem(RING_SCALE_STORAGE_KEY, JSON.stringify(scale));
  } catch {
    // storage full or blocked: the size lasts this session
  }
};
