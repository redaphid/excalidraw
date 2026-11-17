import { pointFrom } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { LocalPoint } from "@excalidraw/math";

import { updateBoundElements } from "./binding";
import {
  boundsContainBounds,
  getCommonBounds,
  getElementBounds,
} from "./bounds";
import { computeBoundTextPosition, getBoundTextElement } from "./textElement";
import {
  isArrowElement,
  isBoundToContainer,
  isFrameLikeElement,
} from "./typeChecks";

import type { Scene } from "./Scene";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "./types";

export type LayoutAlgorithm =
  | "layered"
  | "mrtree"
  | "radial"
  | "force"
  | "stress"
  | "rectpacking"
  | "box"
  | "random"
  | "sporeOverlap"
  | "sporeCompaction";

export type LayoutDirection = "down" | "right" | "up" | "left";

export type LayoutNode = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
};

export type LayoutEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
};

/** nodes are given in scene order, so arranging what is already arranged changes nothing */
export type LayoutGraph = {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
};

export type LayoutSpacing = { readonly node: number; readonly rank: number };

export type LayoutOptions = {
  readonly algorithm: LayoutAlgorithm;
  readonly direction: LayoutDirection;
  readonly spacing: LayoutSpacing;
  /** raw engine options, merged last; the escape hatch for algorithm-specific tuning */
  readonly elkOptions?: Readonly<Record<string, string>>;
};

/** top-left of each node, relative to the layout's own top-left at 0,0 */
export type LayoutPositions = ReadonlyMap<
  string,
  { readonly x: number; readonly y: number }
>;

export type LayoutEngine = (
  graph: LayoutGraph,
  options: LayoutOptions,
) => Promise<LayoutPositions>;

export type ArrangeRequest = {
  /** omitted or empty: the whole scene */
  readonly elementIds?: readonly string[];
  readonly algorithm?: LayoutAlgorithm;
  readonly direction?: LayoutDirection;
  readonly spacing?: Partial<LayoutSpacing & { frameMargin: number }>;
  readonly elkOptions?: Readonly<Record<string, string>>;
};

export type ArrangePlan = {
  /** every element the plan read, at the version it read, so the apply can refuse a stale plan */
  readonly versions: ReadonlyMap<string, number>;
  /** element id -> translation of every arranged element; bound text is laid out in its container instead */
  readonly translations: ReadonlyMap<
    string,
    { readonly dx: number; readonly dy: number }
  >;
  /** arrows bound at both ends to arranged elements, not arranged themselves; their bends follow their ends */
  readonly arrows: readonly string[];
  /** frame id -> new size (frames grow only; their x,y stay) */
  readonly frames: ReadonlyMap<
    string,
    { readonly width: number; readonly height: number }
  >;
  /** frames that a grown frame overlaps and did not overlap before */
  readonly overlappedFrameIds: readonly string[];
  /** frame id -> the frame it is nested in, for frames whose frameId did not say so */
  readonly frameIds: ReadonlyMap<string, string | null>;
};

export type ArrangeOutcome =
  | {
      readonly status: "arranged";
      readonly movedIds: readonly string[];
      readonly resizedFrameIds: readonly string[];
      readonly overlappedFrameIds: readonly string[];
    }
  | {
      readonly status: "nothing-to-arrange";
      /** element types left out because only shapes are arranged, e.g. "text", "freedraw" */
      readonly skipped: readonly ExcalidrawElement["type"][];
    }
  | { readonly status: "stale" };

export const arrangeSpacing = (gridSize: number) => ({
  node: 2 * gridSize,
  rank: 3 * gridSize,
  frameMargin: 2 * gridSize,
});

/** whole pixels, so a layout of what was already laid out lands on the same pixels */
type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Unit = {
  /** the outermost group arranged whole, the nested frame carried whole, or the element's own id */
  readonly id: string;
  /** everything that moves with the unit; loose elements drawn inside it join it */
  readonly members: NonDeletedExcalidrawElement[];
  /** the partition the unit is laid out in: a frame, or null for the free canvas */
  readonly frameId: string | null;
  readonly box: Box;
};

type Partition = {
  readonly units: Unit[];
  readonly arrows: { arrow: ExcalidrawElement; edge: LayoutEdge }[];
  /** what stays put in the same frame; the layout keeps off it */
  readonly obstacles: Box[];
  /** on the free canvas, the frames, which the layout keeps off at the size this plan grows them to */
  readonly frames: ExcalidrawFrameLikeElement[];
};

/** how often one partition's layout is pushed off an obstacle at most */
const MAX_PUSHES = 500;

const boxOf = (
  elements: readonly ExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
): Box => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements, elementsMap);
  const x = Math.round(minX);
  const y = Math.round(minY);
  return {
    x,
    y,
    width: Math.max(1, Math.round(maxX) - x),
    height: Math.max(1, Math.round(maxY) - y),
  };
};

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

const area = (box: Box) => box.width * box.height;

/** standalone text, lines, arrows and strokes stay put: arranging moves shapes */
const ARRANGEABLE_TYPES: ReadonlySet<ExcalidrawElement["type"]> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "stickynote",
  "image",
  "embeddable",
  "iframe",
]);

const isBoundArrow = (element: ExcalidrawElement) =>
  isArrowElement(element) && !!(element.startBinding || element.endBinding);

/** labels and bound arrows follow what they are bound to; they are never arranged themselves */
const follows = (element: ExcalidrawElement) =>
  isBoundToContainer(element) || isBoundArrow(element);

/** frame id -> the size a plan grows the frame to; frames grow in place */
type FrameSizes = ReadonlyMap<
  string,
  { readonly width: number; readonly height: number }
>;

type Frame = NonDeleted<ExcalidrawFrameLikeElement>;

type FrameTree = {
  /** the frame a frame is nested in directly, or null */
  readonly holderOf: (frame: { id: string }) => Frame | null;
  /** the frames nested directly in a frame */
  readonly nestedIn: (outer: { id: string }) => Frame[];
  /** whether a frame is nested in another, at any depth */
  readonly isWithin: (frameId: string, outerId: string) => boolean;
  /** the frame, not nested in another, that a frame is nested in, or itself */
  readonly topOf: (frameId: string) => string;
  /** whether a frame, or a frame nested in it at any depth, is locked */
  readonly holdsLocked: (frameId: string) => boolean;
  /** whether a frame, or a frame it is nested in at any depth, is locked */
  readonly inLocked: (frameId: string | null | undefined) => boolean;
  /** frame id -> the frame it is nested in, where its frameId does not say so */
  readonly unrecorded: ReadonlyMap<string, string | null>;
};

/**
 * Which frame each frame is nested in. A frame's frameId says so, and arranging
 * keeps a nested frame inside its frame, so every arrange reads the same
 * nesting. The editor does not update a frame's frameId when the frame is
 * dragged, so one naming a frame it does not lie in (or a deleted one, or one
 * that nests frames in a circle) is stale: that frame is nested in the
 * smallest frame drawn wholly around it, the rule a frame drag carries frames
 * by, and the plan writes that down. A locked frame is never read from where
 * it lies: a frame growing around it could not push it off. `sizes` reads the
 * frames as a plan would leave them.
 */
const frameTree = (
  frames: readonly Frame[],
  elementsMap: NonDeletedSceneElementsMap,
  sizes: FrameSizes,
): FrameTree => {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const bounds = new Map(
    frames.map((frame) => {
      const [left, top] = getElementBounds(frame, elementsMap);
      const { width, height } = sizes.get(frame.id) ?? frame;
      return [frame.id, [left, top, left + width, top + height] as Bounds];
    }),
  );
  const frameArea = (frame: Frame) => {
    const [left, top, right, bottom] = bounds.get(frame.id)!;
    return (right - left) * (bottom - top);
  };
  const liesIn = (frame: Frame, holder: { id: string }) => {
    const [left, top, right, bottom] = bounds.get(frame.id)!;
    const [x1, y1, x2, y2] = bounds.get(holder.id)!;
    return contains(
      { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
      { x: left, y: top, width: right - left, height: bottom - top },
    );
  };
  const stored = new Map(
    frames.flatMap((frame) => {
      const holder = frame.frameId ? byId.get(frame.frameId) : undefined;
      return holder && holder !== frame && liesIn(frame, holder)
        ? [[frame.id, holder] as const]
        : [];
    }),
  );
  const holders = new Map<string, Frame | null>();
  const reaches = (from: string | undefined, to: string) => {
    for (let at = from, steps = 0; at && steps <= frames.length; steps++) {
      if (at === to) {
        return true;
      }
      at = (holders.has(at) ? holders.get(at) : stored.get(at))?.id;
    }
    return false;
  };
  // a frame whose stored holder leads back to it is read from where it lies
  for (const frame of frames) {
    if (reaches(stored.get(frame.id)?.id, frame.id)) {
      stored.delete(frame.id);
    }
  }
  for (const frame of frames) {
    holders.set(frame.id, stored.get(frame.id) ?? null);
  }
  for (const frame of frames) {
    if (stored.has(frame.id) || frame.locked) {
      continue;
    }
    // the smallest frame wholly around it, the topmost of equal ones
    let holder: Frame | null = null;
    for (const outer of frames) {
      if (
        outer !== frame &&
        frameArea(frame) < frameArea(outer) &&
        boundsContainBounds(bounds.get(outer.id)!, bounds.get(frame.id)!) &&
        (!holder || frameArea(outer) <= frameArea(holder)) &&
        !reaches(outer.id, frame.id)
      ) {
        holder = outer;
      }
    }
    holders.set(frame.id, holder);
  }

  const children = new Map<string, Frame[]>();
  for (const frame of frames) {
    const holder = holders.get(frame.id);
    if (holder) {
      children.set(holder.id, [...(children.get(holder.id) ?? []), frame]);
    }
  }
  const isWithin = (frameId: string, outerId: string) =>
    frameId !== outerId && reaches(frameId, outerId);
  const topOf = (frameId: string): string => {
    const holder = holders.get(frameId);
    return holder ? topOf(holder.id) : frameId;
  };
  const holdsLocked = (frameId: string): boolean =>
    !!byId.get(frameId)?.locked ||
    (children.get(frameId) ?? []).some((frame) => holdsLocked(frame.id));
  const inLocked = (frameId: string | null | undefined): boolean =>
    !!frameId &&
    (!!byId.get(frameId)?.locked || inLocked(holders.get(frameId)?.id));
  return {
    holderOf: (frame) => holders.get(frame.id) ?? null,
    nestedIn: (outer) => children.get(outer.id) ?? [],
    isWithin,
    topOf,
    holdsLocked,
    inLocked,
    unrecorded: new Map(
      frames.flatMap((frame) => {
        const holderId = holders.get(frame.id)?.id ?? null;
        return (frame.frameId ?? null) === holderId
          ? []
          : [[frame.id, holderId] as const];
      }),
    ),
  };
};

/**
 * element id -> the frame that carries it when its frame moves: the smallest
 * frame drawn wholly around it among its own frame and the frames nested in
 * that (any frame, for an element in none), or else its own frame. Labels
 * follow their containers instead. What a frame carries moves with it, so it
 * still lies where it did when the next arrange reads it.
 */
const carriersOf = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
  frames: readonly Frame[],
  tree: FrameTree,
) => {
  const frameBounds = frames.map(
    (frame) =>
      [
        frame,
        getElementBounds(frame, elementsMap),
        frame.width * frame.height,
      ] as const,
  );
  const carriers = new Map<string, string>();
  for (const element of elements) {
    if (isFrameLikeElement(element) || isBoundToContainer(element)) {
      continue;
    }
    const own = element.frameId && elementsMap.get(element.frameId);
    const ownId = own && isFrameLikeElement(own) ? own.id : null;
    const bounds = getElementBounds(element, elementsMap);
    let carrier: string | null = null;
    let carrierArea = Infinity;
    for (const [frame, around, frameArea] of frameBounds) {
      if (
        frameArea <= carrierArea &&
        (!ownId || frame.id === ownId || tree.isWithin(frame.id, ownId)) &&
        boundsContainBounds(around, bounds)
      ) {
        carrier = frame.id;
        carrierArea = frameArea;
      }
    }
    if (carrier ?? ownId) {
      carriers.set(element.id, (carrier ?? ownId)!);
    }
  }
  return carriers;
};

type Targets = {
  /** the shapes to lay out */
  readonly shapes: ReadonlySet<string>;
  /** nested frame id -> the frame it is laid out in, and the nested frame with what it carries, laid out as one fixed-size unit */
  readonly frameUnits: ReadonlyMap<
    string,
    {
      readonly holderId: string;
      readonly members: readonly NonDeletedExcalidrawElement[];
      readonly box: Box;
    }
  >;
  readonly tree: FrameTree;
  readonly carriers: ReadonlyMap<string, string>;
  /** the frames whose contents are laid out */
  readonly laidOutFrames: readonly Frame[];
};

/** the elements a request names, with frames resolved to what they hold and labels to their containers */
const resolveTargets = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
  elementIds: readonly string[] | undefined,
  sizes: FrameSizes,
): Targets => {
  const frames = elements.filter(
    (element): element is NonDeleted<ExcalidrawFrameLikeElement> =>
      isFrameLikeElement(element),
  );
  const tree = frameTree(frames, elementsMap, sizes);
  const carriers = carriersOf(elements, elementsMap, frames, tree);
  const named = elementIds?.length
    ? elementIds.flatMap((id) => elementsMap.get(id) ?? [])
    : elements;

  // the frames whose contents are laid out: those named, or, for the whole
  // scene, every frame not nested in another; a frame nested in one of them
  // moves whole. A locked frame stays as it is, with all it holds
  const laidOutFrames = (
    elementIds?.length
      ? named.filter(isFrameLikeElement)
      : frames.filter((frame) => !tree.holderOf(frame))
  ).filter((frame) => !tree.inLocked(frame.id));
  const nested = laidOutFrames.flatMap((outer) =>
    tree.nestedIn(outer).map((frame) => ({ holderId: outer.id, frame })),
  );
  const nestedUnits = nested.map(({ holderId, frame }) => {
    const carries = (frameId: string | null | undefined) =>
      !!frameId && (frameId === frame.id || tree.isWithin(frameId, frame.id));
    return {
      holderId,
      nested: frame,
      // a frame that is or holds a locked frame stays, with what it carries
      fixed: tree.holdsLocked(frame.id),
      carried: elements.filter((element) =>
        isFrameLikeElement(element)
          ? element !== frame && tree.isWithin(element.id, frame.id)
          : carries(carriers.get(element.id)) &&
            (!element.locked || carries(element.frameId)),
      ),
    };
  });
  // a group drawn around a nested frame, a box with the frame on it, is
  // carried only in part: what lies in the frame is and the box is not.
  // Laying the two out apart would pull the group off the frame and change
  // what the next arrange finds, so the frame takes the whole group along,
  // or none of it when the group lies around more than one frame
  const groupOf = (groupId: string) =>
    elements.filter(
      (element) =>
        element.groupIds.includes(groupId) &&
        !isBoundToContainer(element) &&
        !isFrameLikeElement(element),
    );
  const around = new Map<string, Set<string>>();
  for (const { nested, carried } of nestedUnits) {
    const ids = new Set(carried.map((element) => element.id));
    for (const groupId of new Set(carried.flatMap((each) => each.groupIds))) {
      if (groupOf(groupId).some((member) => !ids.has(member.id))) {
        around.set(groupId, (around.get(groupId) ?? new Set()).add(nested.id));
      }
    }
  }
  const takesWhole = (groupId: string) =>
    around.get(groupId)!.size === 1 &&
    groupOf(groupId).every((member) => !member.locked);
  const frameUnits = new Map<
    string,
    { holderId: string; members: NonDeletedExcalidrawElement[]; box: Box }
  >();
  const carriedIds = new Set<string>();
  for (const { holderId, nested, fixed, carried } of nestedUnits) {
    const kept = carried.filter((element) =>
      element.groupIds.every(
        (groupId) => !around.has(groupId) || takesWhole(groupId),
      ),
    );
    if (fixed) {
      kept.forEach((element) => carriedIds.add(element.id));
      continue;
    }
    const taken = [
      ...new Set(
        [...around.keys()]
          .filter((groupId) => around.get(groupId)!.has(nested.id))
          .filter(takesWhole)
          .flatMap(groupOf),
      ),
    ].filter((element) => !kept.includes(element));
    const members = [nested, ...kept, ...taken];
    members.forEach((member) => carriedIds.add(member.id));
    frameUnits.set(nested.id, {
      holderId,
      members,
      box: boxOf(
        [
          nested,
          ...taken.flatMap((element) => {
            const label = getBoundTextElement(element, elementsMap);
            return label ? [element, label] : [element];
          }),
        ],
        elementsMap,
      ),
    });
  }

  const shapes = new Set(
    named
      .flatMap((element) =>
        isFrameLikeElement(element)
          ? elements.filter((child) => child.frameId === element.id)
          : [element],
      )
      .flatMap((element) => {
        const target = isBoundToContainer(element)
          ? elementsMap.get(element.containerId)
          : element;
        return target &&
          !target.locked &&
          !isFrameLikeElement(target) &&
          !isBoundArrow(target) &&
          !carriedIds.has(target.id) &&
          !tree.inLocked(target.frameId) &&
          !tree.inLocked(carriers.get(target.id))
          ? [target.id]
          : [];
      }),
  );
  return { shapes, frameUnits, tree, carriers, laidOutFrames };
};

/** each target joins the outermost of its groups whose members are all targets */
const groupUnits = (
  targets: Targets,
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
) => {
  const groups = new Map<string, NonDeletedExcalidrawElement[]>();
  for (const element of elements) {
    if (!follows(element)) {
      for (const groupId of element.groupIds) {
        groups.set(groupId, [...(groups.get(groupId) ?? []), element]);
      }
    }
  }

  /** element id -> the unit it moves with */
  const unitOf = new Map<string, Unit>();
  const add = (unit: Unit) => {
    for (const member of unit.members) {
      unitOf.set(member.id, unit);
    }
  };
  // a nested frame is laid out in the frame it is nested in
  for (const [id, { holderId, members, box }] of targets.frameUnits) {
    add({ id, members: [...members], frameId: holderId, box });
  }
  for (const id of targets.shapes) {
    const element = elementsMap.get(id);
    if (!element || unitOf.has(id)) {
      continue;
    }
    const groupId = [...element.groupIds]
      .reverse()
      .find((groupId) =>
        (groups.get(groupId) ?? []).every((member) =>
          targets.shapes.has(member.id),
        ),
      );
    const members = groupId ? groups.get(groupId) ?? [] : [element];
    const labels = members.flatMap(
      (member) => getBoundTextElement(member, elementsMap) ?? [],
    );
    add({
      id: groupId ?? element.id,
      members: [...members],
      frameId: element.frameId,
      box: boxOf([...members, ...labels], elementsMap),
    });
  }

  return unitOf;
};

/** the units a request arranges, and the types of what it names but leaves out */
const unitsOf = (
  scene: Scene,
  elementIds: readonly string[] | undefined,
  sizes: FrameSizes = new Map(),
) => {
  const elements = scene.getNonDeletedElements();
  const elementsMap = scene.getNonDeletedElementsMap();
  const targets = resolveTargets(elements, elementsMap, elementIds, sizes);
  const unitOf = groupUnits(targets, elements, elementsMap);
  const skipped = new Set<ExcalidrawElement["type"]>();
  for (const [id, unit] of unitOf) {
    const arrangeable = unit.members.some(
      (member) =>
        ARRANGEABLE_TYPES.has(member.type) || isFrameLikeElement(member),
    );
    if (!arrangeable) {
      unitOf.delete(id);
      unit.members.forEach((member) => skipped.add(member.type));
    }
  }
  return { unitOf, targets, skipped: [...skipped].sort() };
};

export const unarrangeableTypes = (
  scene: Scene,
  request: Pick<ArrangeRequest, "elementIds">,
) => unitsOf(scene, request.elementIds).skipped;

/** whether a request lays anything out: two or more units in one frame or on the free canvas */
export const canArrange = (
  scene: Scene,
  request: Pick<ArrangeRequest, "elementIds">,
) => {
  const perPartition = new Map<string | null, Set<Unit>>();
  for (const unit of unitsOf(scene, request.elementIds).unitOf.values()) {
    const units = perPartition.get(unit.frameId) ?? new Set();
    units.add(unit);
    perPartition.set(unit.frameId, units);
  }
  return [...perPartition.values()].some((units) => units.size > 1);
};

/**
 * Sorts a partition's loose elements, whatever stays put in its frame. One
 * drawn wholly inside a unit was drawn on it and travels with it; the rest
 * are obstacles the layout keeps off, a nested frame that stays among them.
 * On the free canvas, frames are obstacles too.
 */
const placeLoose = (
  partition: Partition,
  frameId: string | null,
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
  unitOf: ReadonlyMap<string, Unit>,
  tree: FrameTree,
) => {
  for (const element of elements) {
    const belongs = isFrameLikeElement(element)
      ? frameId === null || tree.holderOf(element)?.id === frameId
      : element.frameId === frameId;
    if (!belongs || unitOf.has(element.id) || follows(element)) {
      continue;
    }
    if (isFrameLikeElement(element) && frameId === null) {
      partition.frames.push(element);
      continue;
    }
    const box = boxOf([element], elementsMap);
    const holder = element.locked
      ? undefined
      : partition.units
          .filter((unit) => contains(unit.box, box))
          .sort((a, b) => area(a.box) - area(b.box))[0];
    if (holder) {
      holder.members.push(element);
    } else {
      partition.obstacles.push(box);
    }
  }
};

type Placed = { unit: Unit; x: number; y: number };

/**
 * Pushes the layout along its direction until no unit sits on an obstacle.
 * Everything from the hit unit onward moves together, so the layout keeps
 * its order and only gets longer. The nearest hit is pushed first: laying the
 * result out again starts where its first unit landed, and so makes the same
 * pushes from there and changes nothing.
 */
const pushOffObstacles = (
  placed: Placed[],
  obstacles: readonly Box[],
  direction: LayoutDirection,
  gap: number,
) => {
  const along = direction === "right" || direction === "left" ? "x" : "y";
  const boxAt = ({ unit, x, y }: Placed): Box => ({ ...unit.box, x, y });
  for (let pushes = 0; pushes < MAX_PUSHES; pushes++) {
    let hit: { placed: Placed; obstacle: Box } | undefined;
    for (const candidate of placed) {
      if (hit && hit.placed[along] <= candidate[along]) {
        continue;
      }
      const box = boxAt(candidate);
      const obstacle = obstacles.find((obstacle) => overlap(box, obstacle));
      if (obstacle) {
        hit = { placed: candidate, obstacle };
      }
    }
    if (!hit) {
      return;
    }
    const { obstacle } = hit;
    const from = hit.placed[along];
    const by =
      along === "x"
        ? obstacle.x + obstacle.width - from + gap
        : obstacle.y + obstacle.height - from + gap;
    for (const candidate of placed) {
      if (candidate[along] >= from) {
        candidate[along] += by;
      }
    }
  }
};

/** how often a plan is made again because the frames it grows nest differently */
const MAX_REPLANS = 4;

/** whether the frames nest the same at two sets of sizes */
const sameNesting = (scene: Scene, a: FrameSizes, b: FrameSizes) => {
  const frames = scene.getNonDeletedElements().filter(isFrameLikeElement);
  const elementsMap = scene.getNonDeletedElementsMap();
  const was = frameTree(frames, elementsMap, a);
  const now = frameTree(frames, elementsMap, b);
  return frames.every((frame) => was.holderOf(frame) === now.holderOf(frame));
};

type FramePush = {
  readonly frame: ExcalidrawFrameLikeElement;
  /** where the frame was */
  readonly was: Box;
  /** where the plan leaves it */
  box: Box;
  /** it is or holds a locked frame, so it stays */
  readonly fixed: boolean;
};

/**
 * The shortest push, right or down, that takes one of two overlapping frames
 * off the other. The frame that lay right of or below the other moves on that
 * way, so frames keep their order; of two that overlapped already, the
 * smaller. When that frame is or holds a locked frame, the other one moves
 * past it instead.
 */
const pushBetween = (a: FramePush, b: FramePush, gap: number) => {
  if (!overlap(a.box, b.box)) {
    return null;
  }
  const right = (mover: FramePush, other: FramePush) => ({
    mover,
    dx: other.box.x + other.box.width + gap - mover.box.x,
    dy: 0,
  });
  const down = (mover: FramePush, other: FramePush) => ({
    mover,
    dx: 0,
    dy: other.box.y + other.box.height + gap - mover.box.y,
  });
  const past = (mover: FramePush, other: FramePush) => [
    right(mover, other),
    down(mover, other),
  ];
  const leftOf = (first: Box, second: Box) => first.x + first.width <= second.x;
  const above = (first: Box, second: Box) => first.y + first.height <= second.y;
  const inner = area(a.was) < area(b.was) ? a : b;
  const outer = inner === a ? b : a;
  const shortest = (pushes: { mover: FramePush; dx: number; dy: number }[]) =>
    pushes
      .filter(({ mover }) => !mover.fixed)
      .sort((p, q) => p.dx + p.dy - (q.dx + q.dy))[0];
  return (
    shortest(
      overlap(a.was, b.was)
        ? past(inner, outer)
        : [
            ...(leftOf(a.was, b.was) ? [right(b, a)] : []),
            ...(leftOf(b.was, a.was) ? [right(a, b)] : []),
            ...(above(a.was, b.was) ? [down(b, a)] : []),
            ...(above(b.was, a.was) ? [down(a, b)] : []),
          ],
    ) ??
    shortest([...past(a, b), ...past(b, a)]) ??
    null
  );
};

/**
 * A frame grows in place, right and down, into whatever frame lies there.
 * Each frame not nested in another is pushed off the frames it overlaps,
 * taking along all it carries, so no frame comes to lie in another that the
 * next arrange would read as nested in it.
 */
const keepFramesApart = (
  frames: readonly ExcalidrawFrameLikeElement[],
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
  { tree, carriers }: Pick<Targets, "tree" | "carriers">,
  {
    frameBox,
    gap,
    placedOnFreeCanvas,
    move,
  }: {
    frameBox: (frame: ExcalidrawFrameLikeElement) => Box;
    gap: number;
    placedOnFreeCanvas: (id: string) => boolean;
    move: (element: ExcalidrawElement, dx: number, dy: number) => void;
  },
) => {
  const tops: FramePush[] = frames
    .filter((frame) => !tree.holderOf(frame))
    .map((frame) => ({
      frame,
      was: boxOf([frame], elementsMap),
      box: frameBox(frame),
      fixed: tree.holdsLocked(frame.id),
    }));
  for (let pushes = 0; pushes < MAX_PUSHES; pushes++) {
    const push = tops
      .flatMap((a, i) => tops.slice(i + 1).map((b) => pushBetween(a, b, gap)))
      .find((each) => each !== null);
    if (!push) {
      break;
    }
    const { mover, dx, dy } = push;
    mover.box = { ...mover.box, x: mover.box.x + dx, y: mover.box.y + dy };
  }

  const offsets = new Map(
    tops.flatMap(({ frame, was, box }) =>
      box.x !== was.x || box.y !== was.y
        ? [[frame.id, { dx: box.x - was.x, dy: box.y - was.y }] as const]
        : [],
    ),
  );
  if (!offsets.size) {
    return;
  }
  for (const element of elements) {
    const carrier = isFrameLikeElement(element)
      ? element.id
      : carriers.get(element.id);
    const offset = carrier && offsets.get(tree.topOf(carrier));
    // an arrow bound at both ends follows them, bends and all; a locked
    // element moves only with its own frame
    const followsBoth =
      isArrowElement(element) && !!element.startBinding && !!element.endBinding;
    const stays =
      element.locked &&
      !isFrameLikeElement(element) &&
      (!element.frameId ||
        !elementsMap.has(element.frameId) ||
        tree.topOf(element.frameId) !== tree.topOf(carrier!));
    if (offset && !followsBoth && !stays && !placedOnFreeCanvas(element.id)) {
      move(element, offset.dx, offset.dy);
    }
  }
};

/**
 * Lays the requested elements out with `engine`, one layout per frame (and one
 * for the free canvas), without touching the scene. Reads the scene before its
 * first await, so a change made while the engine runs makes the plan stale.
 *
 * A plan reads which frame a frame is nested in from its frameId, and writes
 * the frameId of each frame it found nested only by where it lies, so the
 * next arrange reads the same nesting. Arranging the whole scene keeps the
 * frames apart, so no frame comes to lie newly inside another; a selection
 * leaves unselected frames where they are, so a frame grown around one is
 * planned again with it nested.
 */
export const planArrange = async (
  scene: Scene,
  appState: Readonly<Pick<AppState, "gridSize">>,
  request: ArrangeRequest,
  engine: LayoutEngine,
): Promise<ArrangePlan | null> =>
  request.elementIds?.length
    ? planGrown(scene, appState, request, engine)
    : planWith(scene, appState, request, engine, new Map());

/**
 * A frame that grows around another frame nests it, which changes what the
 * next arrange lays out. So the plan is made again with the frames at the
 * sizes it grows them to, until they nest as the plan assumed.
 */
const planGrown = async (
  scene: Scene,
  appState: Readonly<Pick<AppState, "gridSize">>,
  request: ArrangeRequest,
  engine: LayoutEngine,
): Promise<ArrangePlan | null> => {
  let sizes: FrameSizes = new Map();
  for (let replans = 0; ; replans++) {
    const plan = await planWith(scene, appState, request, engine, sizes);
    if (
      !plan ||
      replans === MAX_REPLANS ||
      sameNesting(scene, sizes, plan.frames)
    ) {
      return plan;
    }
    sizes = plan.frames;
  }
};

const planWith = async (
  scene: Scene,
  appState: Readonly<Pick<AppState, "gridSize">>,
  request: ArrangeRequest,
  engine: LayoutEngine,
  sizes: FrameSizes,
): Promise<ArrangePlan | null> => {
  const elements = scene.getNonDeletedElements();
  const elementsMap = scene.getNonDeletedElementsMap();
  const defaults = arrangeSpacing(appState.gridSize);
  const spacing = {
    node: request.spacing?.node ?? defaults.node,
    rank: request.spacing?.rank ?? defaults.rank,
    frameMargin: request.spacing?.frameMargin ?? defaults.frameMargin,
  };
  const options: LayoutOptions = {
    algorithm: request.algorithm ?? "layered",
    direction: request.direction ?? "down",
    spacing: { node: spacing.node, rank: spacing.rank },
    elkOptions: request.elkOptions,
  };

  const { unitOf, targets } = unitsOf(scene, request.elementIds, sizes);

  /** frame id (null: the free canvas) -> its units and the arrows joining two of them */
  const partitions = new Map<string | null, Partition>();
  const partitionOf = (frameId: string | null) => {
    const partition = partitions.get(frameId) ?? {
      units: [],
      arrows: [],
      obstacles: [],
      frames: [],
    };
    partitions.set(frameId, partition);
    return partition;
  };
  for (const unit of new Set(unitOf.values())) {
    partitionOf(unit.frameId).units.push(unit);
  }
  for (const arrow of elements) {
    if (!isArrowElement(arrow)) {
      continue;
    }
    const source = unitOf.get(arrow.startBinding?.elementId ?? "");
    const target = unitOf.get(arrow.endBinding?.elementId ?? "");
    if (
      source &&
      target &&
      source !== target &&
      source.frameId === target.frameId
    ) {
      partitionOf(source.frameId).arrows.push({
        arrow,
        edge: { id: arrow.id, source: source.id, target: target.id },
      });
    }
  }

  const laidOut = [...partitions].filter(([, { units }]) => units.length > 1);
  if (!laidOut.length) {
    return null;
  }
  for (const [frameId, partition] of laidOut) {
    placeLoose(partition, frameId, elements, elementsMap, unitOf, targets.tree);
  }

  const versions = new Map<string, number>();
  const read = (element: ExcalidrawElement) =>
    versions.set(element.id, element.version);

  const jobs = laidOut.map(
    ([frameId, { units, arrows, obstacles, frames }]) => {
      for (const unit of units) {
        for (const member of unit.members) {
          read(member);
          const label = getBoundTextElement(member, elementsMap);
          if (label) {
            read(label);
          }
        }
      }
      arrows.forEach(({ arrow }) => read(arrow));
      const holder = frameId ? elementsMap.get(frameId) : undefined;
      const frame = holder && isFrameLikeElement(holder) ? holder : undefined;
      if (frame) {
        read(frame);
      }
      return {
        units,
        obstacles,
        frames,
        frame,
        positions: engine(
          {
            nodes: units.map(({ id, box }) => ({
              id,
              width: box.width,
              height: box.height,
            })),
            edges: arrows.map(({ edge }) => edge),
          },
          options,
        ),
      };
    },
  );
  const placements = await Promise.all(jobs.map(({ positions }) => positions));

  const translations = new Map<string, { dx: number; dy: number }>();
  const frames = new Map<string, { width: number; height: number }>();
  /** a frame where this plan leaves it, at the size it grows it to */
  const frameBox = (frame: ExcalidrawFrameLikeElement): Box => {
    const box = boxOf([frame], elementsMap);
    const { dx, dy } = translations.get(frame.id) ?? { dx: 0, dy: 0 };
    const grown = frames.get(frame.id);
    return {
      x: box.x + dx,
      y: box.y + dy,
      width: grown ? Math.round(grown.width) : box.width,
      height: grown ? Math.round(grown.height) : box.height,
    };
  };

  const place = ({
    units,
    obstacles,
    frames: framesAround,
    frame,
    positions,
  }: Omit<Partition, "arrows"> & {
    frame: ExcalidrawFrameLikeElement | undefined;
    positions: LayoutPositions;
  }) => {
    const at = (unit: Unit) => {
      const position = positions.get(unit.id);
      if (!position) {
        throw new Error(`The layout engine placed no position for ${unit.id}`);
      }
      return position;
    };
    // a frame's layout starts at its margin and the free canvas's where it
    // was; neither depends on where the layout ends, so a second layout
    // lands on the same pixels
    const origin = frame
      ? { x: frame.x + spacing.frameMargin, y: frame.y + spacing.frameMargin }
      : {
          x: Math.min(...units.map((unit) => unit.box.x)),
          y: Math.min(...units.map((unit) => unit.box.y)),
        };
    const placed: Placed[] = units.map((unit) => ({
      unit,
      x: Math.round(origin.x + at(unit).x),
      y: Math.round(origin.y + at(unit).y),
    }));
    pushOffObstacles(
      placed,
      [...obstacles, ...framesAround.map(frameBox)],
      options.direction,
      spacing.node,
    );
    for (const { unit, x, y } of placed) {
      const dx = x - unit.box.x;
      const dy = y - unit.box.y;
      unit.members.forEach((member) => translations.set(member.id, { dx, dy }));
    }
    if (frame) {
      const right = Math.max(
        ...placed.map(({ unit, x }) => x + unit.box.width),
      );
      const bottom = Math.max(
        ...placed.map(({ unit, y }) => y + unit.box.height),
      );
      const grown = {
        width: Math.max(frame.width, right + spacing.frameMargin - frame.x),
        height: Math.max(frame.height, bottom + spacing.frameMargin - frame.y),
      };
      if (grown.width !== frame.width || grown.height !== frame.height) {
        frames.set(frame.id, grown);
      }
    }
  };

  const done = jobs.map((job, i) => ({ ...job, positions: placements[i] }));
  const allFrames = elements.filter(isFrameLikeElement);
  // frames first, so the free canvas keeps off them where they end up
  done.filter(({ frame }) => frame).forEach(place);
  if (!request.elementIds?.length) {
    const freeCanvas = new Set(partitions.get(null)?.units);
    keepFramesApart(allFrames, elements, elementsMap, targets, {
      frameBox,
      gap: spacing.node,
      // the free canvas's own layout places what is on it
      placedOnFreeCanvas: (id) => freeCanvas.has(unitOf.get(id)!),
      move: (element, dx, dy) => {
        read(element);
        const was = translations.get(element.id) ?? { dx: 0, dy: 0 };
        translations.set(element.id, { dx: was.dx + dx, dy: was.dy + dy });
      },
    });
  }
  done.filter(({ frame }) => !frame).forEach(place);

  const moves = (id: string | undefined) => {
    const translation = translations.get(id ?? "");
    return !!translation && !!(translation.dx || translation.dy);
  };
  const arrows = elements.filter(
    (element) =>
      isArrowElement(element) &&
      !translations.has(element.id) &&
      translations.has(element.startBinding?.elementId ?? "") &&
      translations.has(element.endBinding?.elementId ?? "") &&
      (moves(element.startBinding?.elementId) ||
        moves(element.endBinding?.elementId)),
  );
  arrows.forEach(read);

  const after = new Map(allFrames.map((frame) => [frame.id, frameBox(frame)]));
  const changed = allFrames.filter(
    (frame) => frames.has(frame.id) || translations.has(frame.id),
  );
  const overlappedFrameIds = allFrames
    .filter((other) =>
      changed.some(
        (frame) =>
          frame !== other &&
          !overlap(frame, other) &&
          overlap(after.get(frame.id)!, after.get(other.id)!),
      ),
    )
    .map((frame) => frame.id);

  // the nesting this plan read, written down where the frames did not say
  // so: for the whole scene, every frame; for a selection, the frames it
  // lays out and those nested in them
  const { tree, laidOutFrames } = targets;
  const frameIds = new Map(
    [...tree.unrecorded].filter(
      ([id]) =>
        !request.elementIds?.length ||
        laidOutFrames.some(
          (frame) => frame.id === id || tree.isWithin(id, frame.id),
        ),
    ),
  );
  for (const id of frameIds.keys()) {
    read(elementsMap.get(id)!);
  }

  return {
    versions,
    translations,
    arrows: arrows.map((arrow) => arrow.id),
    frames,
    overlappedFrameIds,
    frameIds,
  };
};

/**
 * Moves what the plan arranged, lays each container's label out again, carries
 * the bends of arrows between arranged elements, follows with bound arrows,
 * grows frames and records which frame each frame is nested in; or does nothing and returns "stale" when anything the plan
 * read has changed since.
 */
export const applyArrangePlan = (
  scene: Scene,
  plan: ArrangePlan,
): readonly ExcalidrawElement[] | "stale" => {
  const everything = scene.getElementsMapIncludingDeleted();
  for (const [id, version] of plan.versions) {
    const element = everything.get(id);
    if (!element || element.isDeleted || element.version !== version) {
      return "stale";
    }
  }

  const elementsMap = scene.getNonDeletedElementsMap();
  // what stays where it is is left alone, arrows bound to it included, so
  // arranging what is arranged changes nothing
  const arranged = [...plan.translations].flatMap(([id, { dx, dy }]) => {
    const element = elementsMap.get(id);
    return element && (dx || dy)
      ? [scene.mutateElement(element, { x: element.x + dx, y: element.y + dy })]
      : [];
  });
  const labels = arranged.flatMap((container) => {
    const label = getBoundTextElement(container, elementsMap);
    return label
      ? [
          scene.mutateElement(
            label,
            computeBoundTextPosition(container, label, elementsMap),
          ),
        ]
      : [];
  });
  const between = plan.arrows.flatMap((id) => {
    const arrow = elementsMap.get(id);
    // mutation is in place, so keep the points as they were
    return arrow && isArrowElement(arrow)
      ? [{ arrow, pointsWere: arrow.points }]
      : [];
  });
  const arrows = between.map(({ arrow }) => {
    const start = plan.translations.get(arrow.startBinding!.elementId)!;
    const end = plan.translations.get(arrow.endBinding!.elementId)!;
    const last = arrow.points.length - 1;
    // the start's move carries the arrow and each bend adds its share of
    // the way to the end's move, so the ends snap back to the outlines from
    // nearby; an elbow arrow is routed again instead
    return scene.mutateElement(arrow, {
      x: arrow.x + start.dx,
      y: arrow.y + start.dy,
      points: arrow.elbowed
        ? arrow.points
        : arrow.points.map((point, i) =>
            pointFrom<LocalPoint>(
              point[0] + ((end.dx - start.dx) * i) / last,
              point[1] + ((end.dy - start.dy) * i) / last,
            ),
          ),
    });
  });
  const frames = [...plan.frames].flatMap(([id, size]) => {
    const frame = elementsMap.get(id);
    return frame ? [scene.mutateElement(frame, size)] : [];
  });
  const nesting = [...plan.frameIds].flatMap(([id, frameId]) => {
    const frame = elementsMap.get(id);
    return frame ? [scene.mutateElement(frame, { frameId })] : [];
  });
  for (const element of arranged) {
    updateBoundElements(element, scene, { simultaneouslyUpdated: arranged });
  }
  // the ends snapped to the outlines on their own, so the bends follow the
  // line between where they landed: turned and stretched with it, each bend
  // keeps its place along that line and its side of it
  for (const { arrow, pointsWere: was } of between) {
    const last = was.length - 1;
    if (arrow.elbowed || last < 2 || arrow.points.length !== was.length) {
      continue;
    }
    const [fromX, fromY] = was[0];
    const lineWas = [was[last][0] - fromX, was[last][1] - fromY];
    const [startX, startY] = arrow.points[0];
    const lineNow = [
      arrow.points[last][0] - startX,
      arrow.points[last][1] - startY,
    ];
    const lengthSquared = lineWas[0] ** 2 + lineWas[1] ** 2;
    if (!lengthSquared) {
      continue;
    }
    // the turn and stretch that takes the old line onto the new one
    const cos =
      (lineWas[0] * lineNow[0] + lineWas[1] * lineNow[1]) / lengthSquared;
    const sin =
      (lineWas[0] * lineNow[1] - lineWas[1] * lineNow[0]) / lengthSquared;
    scene.mutateElement(arrow, {
      points: arrow.points.map((point, j) => {
        if (j === 0 || j === last) {
          return point;
        }
        const x = was[j][0] - fromX;
        const y = was[j][1] - fromY;
        return pointFrom<LocalPoint>(
          startX + x * cos - y * sin,
          startY + x * sin + y * cos,
        );
      }),
    });
  }

  return [
    ...new Set([...arranged, ...labels, ...arrows, ...frames, ...nesting]),
  ];
};
