import { pointFrom } from "@excalidraw/math";

import type { AppState } from "@excalidraw/excalidraw/types";
import type { LocalPoint } from "@excalidraw/math";

import { updateBoundElements } from "./binding";
import {
  boundsContainBounds,
  getCommonBounds,
  getElementBounds,
} from "./bounds";
import { getFrameContents } from "./frame";
import { computeBoundTextPosition, getBoundTextElement } from "./textElement";
import {
  isArrowElement,
  isBoundToContainer,
  isFrameLikeElement,
} from "./typeChecks";

import { Scene } from "./Scene";

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

/**
 * A frame cannot hold a frame, so a smaller frame drawn wholly inside a larger
 * one is nested in it, the rule `getFrameContents` moves frames by. `sizes`
 * reads the frames as a plan would leave them.
 */
const nestedFrames = <Frame extends ExcalidrawFrameLikeElement>(
  frames: readonly Frame[],
  elementsMap: NonDeletedSceneElementsMap,
  sizes: FrameSizes,
) => {
  const sizeOf = (frame: ExcalidrawFrameLikeElement) =>
    sizes.get(frame.id) ?? frame;
  const bounds = new Map(
    frames.map((frame) => {
      const [left, top] = getElementBounds(frame, elementsMap);
      const { width, height } = sizeOf(frame);
      return [frame.id, [left, top, left + width, top + height] as const];
    }),
  );
  const frameArea = (frame: ExcalidrawFrameLikeElement) =>
    sizeOf(frame).width * sizeOf(frame).height;
  /** frame id -> the frames it is nested in, the innermost first */
  const holders = new Map(
    frames.map((inner) => [
      inner.id,
      frames
        .filter(
          (outer) =>
            frameArea(inner) < frameArea(outer) &&
            boundsContainBounds(bounds.get(outer.id)!, bounds.get(inner.id)!),
        )
        .sort((a, b) => frameArea(a) - frameArea(b)),
    ]),
  );
  return {
    /** the frame a frame is nested directly in, or null */
    holderOf: (frame: ExcalidrawFrameLikeElement) =>
      holders.get(frame.id)?.[0] ?? null,
    /** the frames nested directly in a frame */
    nestedIn: (outer: ExcalidrawFrameLikeElement) =>
      frames.filter((frame) => holders.get(frame.id)?.[0] === outer),
  };
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
  const nesting = nestedFrames(frames, elementsMap, sizes);
  const named = elementIds?.length
    ? elementIds.flatMap((id) => elementsMap.get(id) ?? [])
    : elements;

  // the frames whose contents are laid out: those named, or, for the whole
  // scene, every frame not nested in another; a frame nested in one of them
  // moves whole
  const laidOutFrames = elementIds?.length
    ? named.filter(isFrameLikeElement)
    : frames.filter((frame) => !nesting.holderOf(frame));
  const nestedUnits = laidOutFrames.flatMap((outer) =>
    nesting.nestedIn(outer).map((nested) => {
      const contents = getFrameContents(elements, [nested.id]);
      return {
        holderId: outer.id,
        nested,
        carried: elements.filter((element) => contents.has(element.id)),
      };
    }),
  );
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
  for (const { holderId, nested, carried } of nestedUnits) {
    const kept = carried.filter((element) =>
      element.groupIds.every(
        (groupId) => !around.has(groupId) || takesWhole(groupId),
      ),
    );
    const taken = [
      ...new Set(
        [...around.keys()]
          .filter((groupId) => around.get(groupId)!.has(nested.id))
          .filter(takesWhole)
          .flatMap(groupOf),
      ),
    ].filter((element) => !kept.includes(element));
    frameUnits.set(nested.id, {
      holderId,
      members: [nested, ...kept, ...taken],
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
  const carriedIds = new Set(
    [...frameUnits.values()].flatMap(({ members }) =>
      members.map((member) => member.id),
    ),
  );

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
          !carriedIds.has(target.id)
          ? [target.id]
          : [];
      }),
  );
  return { shapes, frameUnits };
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
  // a frame's own frameId is always null, so the nested frame is laid out
  // in the frame it was found nested in
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
  const unitOf = groupUnits(
    resolveTargets(elements, elementsMap, elementIds, sizes),
    elements,
    elementsMap,
  );
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
  return { unitOf, skipped: [...skipped].sort() };
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
 * are obstacles the layout keeps off. On the free canvas, frames are
 * obstacles too.
 */
const placeLoose = (
  partition: Partition,
  frameId: string | null,
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
  unitOf: ReadonlyMap<string, Unit>,
) => {
  for (const element of elements) {
    const belongs = isFrameLikeElement(element)
      ? frameId === null
      : element.frameId === frameId;
    if (!belongs || unitOf.has(element.id) || follows(element)) {
      continue;
    }
    if (isFrameLikeElement(element)) {
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
 * its order and only gets longer, and laying it out again changes nothing.
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
      const box = boxAt(candidate);
      const obstacle = obstacles.find((obstacle) => overlap(box, obstacle));
      if (obstacle) {
        hit = { placed: candidate, obstacle };
        break;
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
  const was = nestedFrames(frames, elementsMap, a);
  const now = nestedFrames(frames, elementsMap, b);
  return frames.every((frame) => was.holderOf(frame) === now.holderOf(frame));
};

/** how often a plan is made again on the board it leaves, at most */
const MAX_SETTLES = 4;

/** a copy of the scene to try plans on */
const copyOf = (scene: Scene) =>
  new Scene(
    scene.getElementsIncludingDeleted().map((element) => ({ ...element })),
    { skipValidation: true },
  );

const movesAnything = (plan: ArrangePlan) =>
  plan.frames.size > 0 ||
  [...plan.translations.values()].some(({ dx, dy }) => dx || dy);

/** one plan that does what `plans` do one after the other */
const composed = (
  plans: readonly ArrangePlan[],
  versions: ReadonlyMap<string, number>,
): ArrangePlan => {
  const translations = new Map<string, { dx: number; dy: number }>();
  for (const plan of plans) {
    for (const [id, { dx, dy }] of plan.translations) {
      const was = translations.get(id) ?? { dx: 0, dy: 0 };
      translations.set(id, { dx: was.dx + dx, dy: was.dy + dy });
    }
  }
  const read = new Set(plans.flatMap((plan) => [...plan.versions.keys()]));
  return {
    versions: new Map(
      [...read].flatMap((id) => {
        const version = versions.get(id);
        return version === undefined ? [] : [[id, version] as const];
      }),
    ),
    translations,
    arrows: [...new Set(plans.flatMap((plan) => plan.arrows))],
    frames: new Map(plans.flatMap((plan) => [...plan.frames])),
    overlappedFrameIds: [
      ...new Set(plans.flatMap((plan) => plan.overlappedFrameIds)),
    ],
  };
};

/**
 * Lays the requested elements out with `engine`, one layout per frame (and one
 * for the free canvas), without touching the scene. Reads the scene before its
 * first await, so a change made while the engine runs makes the plan stale.
 *
 * A plan reads which frame holds what from where things lie, and its moves
 * can change that: a frame grown into the frame below it holds what landed
 * there. So the plan is tried on a copy of the scene and made again on the
 * board it leaves, until that board arranges to itself, and arranging the
 * result again moves nothing.
 */
export const planArrange = async (
  scene: Scene,
  appState: Readonly<Pick<AppState, "gridSize">>,
  request: ArrangeRequest,
  engine: LayoutEngine,
): Promise<ArrangePlan | null> => {
  const versions = new Map(
    scene
      .getNonDeletedElements()
      .map((element) => [element.id, element.version]),
  );
  const board = copyOf(scene);
  const first = await planGrown(scene, appState, request, engine);
  if (!first) {
    return null;
  }
  const plans = [first];
  for (let settles = 0; settles < MAX_SETTLES; settles++) {
    const last = plans.at(-1)!;
    if (!movesAnything(last) || applyArrangePlan(board, last) === "stale") {
      break;
    }
    const next = await planGrown(board, appState, request, engine);
    if (!next || !movesAnything(next)) {
      break;
    }
    plans.push(next);
  }
  return composed(plans, versions);
};

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

  const { unitOf } = unitsOf(scene, request.elementIds, sizes);

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
    placeLoose(partition, frameId, elements, elementsMap, unitOf);
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
  /** a frame as an obstacle, at the size this plan grows it to */
  const frameBox = (frame: ExcalidrawFrameLikeElement): Box => {
    const box = boxOf([frame], elementsMap);
    const grown = frames.get(frame.id);
    return grown
      ? {
          ...box,
          width: Math.round(grown.width),
          height: Math.round(grown.height),
        }
      : box;
  };

  // frames first, so the free canvas keeps off them at their grown size
  const inOrder = jobs
    .map((job, i) => ({ ...job, positions: placements[i] }))
    .sort((a, b) => Number(!a.frame) - Number(!b.frame));
  inOrder.forEach(
    ({ units, obstacles, frames: framesAround, frame, positions }) => {
      const at = (unit: Unit) => {
        const position = positions.get(unit.id);
        if (!position) {
          throw new Error(
            `The layout engine placed no position for ${unit.id}`,
          );
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
        unit.members.forEach((member) =>
          translations.set(member.id, { dx, dy }),
        );
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
          height: Math.max(
            frame.height,
            bottom + spacing.frameMargin - frame.y,
          ),
        };
        if (grown.width !== frame.width || grown.height !== frame.height) {
          frames.set(frame.id, grown);
        }
      }
    },
  );

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

  const allFrames = elements.filter(isFrameLikeElement);
  const grownFrames = allFrames.filter((frame) => frames.has(frame.id));
  const boxAfter = (frame: ExcalidrawFrameLikeElement): Box => ({
    ...frame,
    ...frames.get(frame.id),
  });
  const overlappedFrameIds = allFrames
    .filter((other) =>
      grownFrames.some(
        (grown) =>
          grown !== other &&
          !overlap(grown, other) &&
          overlap(boxAfter(grown), boxAfter(other)),
      ),
    )
    .map((frame) => frame.id);

  return {
    versions,
    translations,
    arrows: arrows.map((arrow) => arrow.id),
    frames,
    overlappedFrameIds,
  };
};

/**
 * Moves what the plan arranged, lays each container's label out again, carries
 * the bends of arrows between arranged elements, follows with bound arrows and
 * grows frames; or does nothing and returns "stale" when anything the plan
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
  for (const element of arranged) {
    updateBoundElements(element, scene, { simultaneouslyUpdated: arranged });
  }
  // the ends snapped to the outlines on their own, so each bend keeps its
  // offset from the line between the ends where they actually landed
  for (const { arrow, pointsWere: was } of between) {
    const last = was.length - 1;
    if (arrow.elbowed || last < 2 || arrow.points.length !== was.length) {
      continue;
    }
    const along = (points: readonly LocalPoint[], t: number) =>
      pointFrom<LocalPoint>(
        points[0][0] + (points[last][0] - points[0][0]) * t,
        points[0][1] + (points[last][1] - points[0][1]) * t,
      );
    scene.mutateElement(arrow, {
      points: arrow.points.map((point, j) => {
        if (j === 0 || j === last) {
          return point;
        }
        const chordWas = along(was, j / last);
        const chordNow = along(arrow.points, j / last);
        return pointFrom<LocalPoint>(
          chordNow[0] + was[j][0] - chordWas[0],
          chordNow[1] + was[j][1] - chordWas[1],
        );
      }),
    });
  }

  return [...arranged, ...labels, ...arrows, ...frames];
};
