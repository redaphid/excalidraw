/**
 * The frames a scene holds, as a navigable structure: a tree of nested
 * frames, the links arrows draw between them, which one the view is in and
 * which one an arrow key leads to. Pure: built from elements, queried with
 * scene bounds, so the drawer, the breadcrumb and the keys share one model.
 */

import {
  getFrameLikeTitle,
  isArrowElement,
  isFrameLikeElement,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

type Bounds = { x: number; y: number; width: number; height: number };

export type Frame = Bounds & { id: string; name: string };
export type FrameNode = { frame: Frame; children: FrameNode[] };
export type Direction = "left" | "right" | "up" | "down";

export type FrameModel = {
  /** live frames, in scene order */
  frames: readonly Frame[];
  byId: ReadonlyMap<string, Frame>;
  /** each frame's smallest enclosing frame */
  parents: ReadonlyMap<string, Frame | null>;
  /** top-level frames, each child list in reading order */
  tree: readonly FrameNode[];
  /** frames an arrow binds together, both ways */
  links: ReadonlyMap<string, ReadonlySet<string>>;
};

type FrameKey =
  | { kind: "step"; direction: Direction }
  | { kind: "bookmark"; index: number };

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const UNIT: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const BOOKMARK_CODE = /^Digit([1-9])$/;

const COVERS_VIEW = 0.15;
const NESTING_SLACK = 0.01;
const ON_SCREEN_SLACK = 0.002;
const CURRENT_MIN_OVERLAP = 0.2;
const NEAREST_MIN_ALIGNMENT = Math.SQRT1_2;

/**
 * What a key press means for frame navigation. Arrows step between frames
 * only while nothing is selected, so they still nudge a selection; ⌥1-9
 * reads the physical digit, since macOS turns ⌥2 into "™". `M`, which
 * toggles the drawer, is `actionToggleFramesMenu`.
 */
export const frameKey = (
  key: {
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  context: { selecting: boolean },
): FrameKey | null => {
  if (key.ctrlKey || key.metaKey || key.shiftKey) {
    return null;
  }
  const digit = BOOKMARK_CODE.exec(key.code)?.[1];
  if (key.altKey) {
    return digit ? { kind: "bookmark", index: Number(digit) - 1 } : null;
  }
  const direction = ARROWS[key.key];
  if (!direction || context.selecting) {
    return null;
  }
  return { kind: "step", direction };
};

const area = (b: Bounds) => b.width * b.height;

const centre = (b: Bounds) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const overlap = (a: Bounds, b: Bounds) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const holds = (b: Bounds, p: { x: number; y: number }) =>
  b.x <= p.x && p.x <= b.x + b.width && b.y <= p.y && p.y <= b.y + b.height;

const within = (outer: Bounds, inner: Bounds, slack: number) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

const contains = (outer: Bounds, inner: Bounds) =>
  area(outer) > area(inner) && within(outer, inner, NESTING_SLACK);

const readingOrder = (a: Frame, b: Frame) => a.y - b.y || a.x - b.x;

const smallest = (frames: readonly Frame[]) =>
  frames.reduce<Frame | null>(
    (p, f) => (p && area(p) <= area(f) ? p : f),
    null,
  );

export const frameModel = (
  elements: readonly NonDeletedExcalidrawElement[],
): FrameModel => {
  const frames = elements.filter(isFrameLikeElement).map(
    (f): Frame => ({
      id: f.id,
      name: getFrameLikeTitle(f),
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
    }),
  );
  const byId = new Map(frames.map((f) => [f.id, f]));

  // largest first, so a frame's containers are placed before it; descend
  // only into frames that hold it rather than testing every pair
  const parents = new Map<string, Frame | null>();
  const children = new Map<Frame | null, Frame[]>([[null, []]]);
  const holders = (level: readonly Frame[], frame: Frame): Frame[] =>
    level
      .filter((f) => contains(f, frame))
      .flatMap((f) => [f, ...holders(children.get(f) ?? [], frame)]);
  for (const frame of [...frames].sort((a, b) => area(b) - area(a))) {
    const parent = smallest(holders(children.get(null)!, frame));
    parents.set(frame.id, parent);
    children.set(parent, [...(children.get(parent) ?? []), frame]);
  }
  const under = (parent: Frame | null): FrameNode[] =>
    [...(children.get(parent) ?? [])]
      .sort(readingOrder)
      .map((frame) => ({ frame, children: under(frame) }));

  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) =>
    links.set(a, (links.get(a) ?? new Set()).add(b));
  for (const e of elements) {
    const from = isArrowElement(e) ? e.startBinding?.elementId : undefined;
    const to = isArrowElement(e) ? e.endBinding?.elementId : undefined;
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) {
      continue;
    }
    link(from, to);
    link(to, from);
  }

  return { frames, byId, parents, tree: under(null), links };
};

export const framePath = (model: FrameModel, id: string): Frame[] => {
  const path: Frame[] = [];
  for (
    let frame = model.byId.get(id) ?? null;
    frame;
    frame = model.parents.get(frame.id) ?? null
  ) {
    path.unshift(frame);
  }
  return path;
};

/** The bookmarked frames still on the board, in bookmark order. */
export const liveBookmarks = (
  model: FrameModel,
  frameIds: readonly string[],
): Frame[] => frameIds.flatMap((id) => model.byId.get(id) ?? []);

/** The scene box the screen shows, less the given screen-px insets. */
export const viewBounds = (
  view: {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    zoom: { value: number };
  },
  {
    top = 0,
    right = 0,
    bottom = 0,
    left = 0,
  }: Partial<Record<"top" | "right" | "bottom" | "left", number>> = {},
): Bounds => ({
  x: -view.scrollX + left / view.zoom.value,
  y: -view.scrollY + top / view.zoom.value,
  width: Math.max(0, view.width - left - right) / view.zoom.value,
  height: Math.max(0, view.height - top - bottom) / view.zoom.value,
});

/**
 * The frame the view is in: the innermost frame under the view's centre
 * that is fitted on screen or covers enough of it, else the frame that
 * best fills the view.
 */
export const currentFrame = (model: FrameModel, view: Bounds) => {
  const middle = centre(view);
  const shown = (f: Frame) => within(view, f, view.width * ON_SCREEN_SLACK);
  const fitted = (f: Frame) =>
    shown(f) && (f.width >= view.width / 2 || f.height >= view.height / 2);
  const qualifies = (f: Frame) =>
    fitted(f) || overlap(f, view) >= area(view) * COVERS_VIEW;
  const covering = model.frames.filter((f) => holds(f, middle) && qualifies(f));
  const innermost = covering
    .filter((f) => !covering.some((g) => shown(g) && contains(g, f)))
    .reduce<Frame | null>((b, f) => (b && area(b) <= area(f) ? b : f), null);
  if (innermost) {
    return innermost;
  }
  const fill = (f: Frame) => {
    const shared = overlap(f, view);
    return shared / (area(f) + area(view) - shared);
  };
  const best = model.frames.reduce<Frame | null>(
    (b, f) => (b && fill(b) >= fill(f) ? b : f),
    null,
  );
  return best && fill(best) >= CURRENT_MIN_OVERLAP ? best : null;
};

const heading = (from: Bounds, to: Bounds, direction: Direction) => {
  const a = centre(from);
  const b = centre(to);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const alignment =
    ((b.x - a.x) * UNIT[direction].x + (b.y - a.y) * UNIT[direction].y) /
    distance;
  return { distance, alignment };
};

const best = (
  from: Bounds,
  candidates: readonly Frame[],
  direction: Direction,
  minAlignment: number,
  cost: (h: { distance: number; alignment: number }) => number,
) =>
  candidates
    .map((frame) => ({ frame, h: heading(from, frame, direction) }))
    .filter(({ h }) => h.distance > 0 && h.alignment > minAlignment)
    .reduce<{ frame: Frame; cost: number } | null>((b, { frame, h }) => {
      const c = cost(h);
      return b && b.cost <= c ? b : { frame, cost: c };
    }, null)?.frame ?? null;

/**
 * Where an arrow key leads: the linked frame that best matches the
 * direction, else the nearest frame that way that neither holds nor sits
 * inside the current one.
 */
export const nextFrame = (
  model: FrameModel,
  {
    current,
    view,
    direction,
  }: { current: Frame | null; view: Bounds; direction: Direction },
) => {
  const from = current ?? view;
  const linked = current
    ? model.frames.filter((f) => model.links.get(current.id)?.has(f.id))
    : [];
  const viaLink = best(from, linked, direction, 0, (h) => -h.alignment);
  if (viaLink) {
    return viaLink;
  }
  const unrelated = model.frames.filter(
    (f) =>
      !current ||
      (f.id !== current.id && !contains(f, current) && !contains(current, f)),
  );
  return best(
    from,
    unrelated,
    direction,
    NEAREST_MIN_ALIGNMENT,
    (h) => h.distance / h.alignment,
  );
};
