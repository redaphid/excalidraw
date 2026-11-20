/**
 * Where the radial palette's puck sits on this device. The place is kept as
 * fractions of the editor, so the puck lands in the same spot after a resize
 * or a rotation, and `collapsed` tucks it into a dot on the side it was
 * dropped against.
 */

export type PuckPlace = Readonly<{
  /** the puck's center across the editor, 0 at the left and 1 at the right */
  x: number;
  /** the puck's center down the editor, 0 at the top and 1 at the bottom */
  y: number;
  collapsed: boolean;
}>;

export const PUCK_STORAGE_KEY = "excalidraw-radial-puck";

/** a drop closer than this to the left or right side collapses the puck, in
 * CSS px */
export const PUCK_EDGE = 28;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const isFraction = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 1;

/** the place a puck dropped at `at`, in editor coordinates, takes */
export const dropPuck = (
  at: Readonly<{ x: number; y: number }>,
  bounds: Readonly<{ width: number; height: number }>,
): PuckPlace => {
  const y = clamp01(at.y / bounds.height);
  if (at.x < PUCK_EDGE) {
    return { x: 0, y, collapsed: true };
  }
  if (at.x > bounds.width - PUCK_EDGE) {
    return { x: 1, y, collapsed: true };
  }
  return { x: clamp01(at.x / bounds.width), y, collapsed: false };
};

/** the place kept on this device, or null for the puck's own corner */
export const loadPuckPlace = (win: Window): PuckPlace | null => {
  try {
    const kept = JSON.parse(
      win.localStorage.getItem(PUCK_STORAGE_KEY) ?? "null",
    );
    return kept &&
      isFraction(kept.x) &&
      isFraction(kept.y) &&
      typeof kept.collapsed === "boolean"
      ? { x: kept.x, y: kept.y, collapsed: kept.collapsed }
      : null;
  } catch {
    return null;
  }
};

export const savePuckPlace = (win: Window, place: PuckPlace) => {
  try {
    win.localStorage.setItem(PUCK_STORAGE_KEY, JSON.stringify(place));
  } catch {
    // storage full or blocked: the puck stays put for this session
  }
};
