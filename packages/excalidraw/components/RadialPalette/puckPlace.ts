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

export const forgetPuckPlace = (win: Window) => {
  try {
    win.localStorage.removeItem(PUCK_STORAGE_KEY);
  } catch {
    // storage blocked: nothing was kept
  }
};

type Point = Readonly<{ x: number; y: number }>;

/** the editor's box in client terms */
export type PuckArea = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/** half the puck's hit box, in CSS px: 2.75rem across */
export const PUCK_RADIUS = 22;

/** the center a puck at `place` is drawn at, in client terms: the puck's
 * CSS keeps it one radius (a dot's, when collapsed) from the editor's sides */
export const puckCenter = (place: PuckPlace, area: PuckArea): Point => {
  const inset = place.collapsed ? 10 : PUCK_RADIUS;
  const along = (fraction: number, size: number) =>
    Math.min(Math.max(fraction * size, inset), Math.max(inset, size - inset));
  return {
    x: area.left + along(place.x, area.width),
    y: area.top + along(place.y, area.height),
  };
};

/** whether a puck centered at `at` can be pressed: nothing that takes taps
 * covers its center or its rim */
export const puckIsClear = (at: Point, clear: (point: Point) => boolean) => {
  if (!clear(at)) {
    return false;
  }
  for (let step = 0; step < 8; step++) {
    const angle = (step * Math.PI) / 4;
    const rim = PUCK_RADIUS + 1;
    if (
      !clear({
        x: at.x + rim * Math.cos(angle),
        y: at.y + rim * Math.sin(angle),
      })
    ) {
      return false;
    }
  }
  return true;
};

/**
 * The nearest center to `from`, inside the editor, where a puck can be
 * pressed, searched in rings out from it; null when there is none. A puck
 * dropped on or under the host's own controls (a top bar) would otherwise
 * be out of reach for good, since its place is kept.
 */
export const reachablePuckCenter = (
  from: Point,
  area: PuckArea,
  clear: (point: Point) => boolean,
): Point | null => {
  const inside = (at: Point) =>
    at.x >= area.left + PUCK_RADIUS &&
    at.x <= area.left + area.width - PUCK_RADIUS &&
    at.y >= area.top + PUCK_RADIUS &&
    at.y <= area.top + area.height - PUCK_RADIUS;
  const reach = Math.hypot(area.width, area.height);
  for (let ring = 0; ring * PUCK_RADIUS <= reach; ring++) {
    const distance = ring * PUCK_RADIUS;
    const steps = ring === 0 ? 1 : Math.max(8, ring * 6);
    for (let step = 0; step < steps; step++) {
      const angle = (step * 2 * Math.PI) / steps;
      const at = {
        x: Math.round(from.x + distance * Math.cos(angle)),
        y: Math.round(from.y + distance * Math.sin(angle)),
      };
      if (inside(at) && puckIsClear(at, clear)) {
        return at;
      }
    }
  }
  return null;
};
