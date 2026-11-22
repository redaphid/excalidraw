/**
 * The size a person gave the radial palette's ring on this device, against
 * its own: dragging its corner scales it as a frame's corner does.
 */

import { MIN_RING_SCALE } from "./radialLayout";

export const MAX_RING_SCALE = 1.6;

/** a corner dropped this far in, as a size, folds the ring into the puck */
export const FOLD_RING_SCALE = 0.4;

export const RING_SCALE_STORAGE_KEY = "excalidraw-radial-ring-scale";

/** a step of the corner from the keyboard */
export const RING_SCALE_STEP = 0.1;

export const clampRingScale = (scale: number) =>
  Math.min(MAX_RING_SCALE, Math.max(MIN_RING_SCALE, scale));

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
