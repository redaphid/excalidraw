import type { AppState } from "@excalidraw/excalidraw/types";

import { updateBoundElements } from "./binding";
import { getCommonBounds } from "./bounds";
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

/** nodes are given in reading order (by current y, then x) so model-order-aware engines keep a stable arrangement */
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

type Box = { x: number; y: number; width: number; height: number };

type Unit = {
  /** the outermost group arranged whole, or the element's own id */
  readonly id: string;
  readonly members: readonly NonDeletedExcalidrawElement[];
  readonly frameId: string | null;
  readonly box: Box;
};

type Partition = {
  units: Set<Unit>;
  arrows: { arrow: ExcalidrawElement; edge: LayoutEdge }[];
};

const boxOf = (
  elements: readonly ExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
): Box => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements, elementsMap);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

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

/** the elements a request names, with frames resolved to what they hold and labels to their containers */
const resolveTargets = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: NonDeletedSceneElementsMap,
  elementIds: readonly string[] | undefined,
) => {
  const named = elementIds?.length
    ? elementIds.flatMap((id) => {
        const element = elementsMap.get(id);
        if (!element) {
          return [];
        }
        return isFrameLikeElement(element)
          ? elements.filter((child) => child.frameId === element.id)
          : [element];
      })
    : elements;

  return new Set(
    named.flatMap((element) => {
      const target = isBoundToContainer(element)
        ? elementsMap.get(element.containerId)
        : element;
      return target &&
        !target.locked &&
        !isFrameLikeElement(target) &&
        !isBoundArrow(target)
        ? [target.id]
        : [];
    }),
  );
};

/** each target joins the outermost of its groups whose members are all targets */
const groupUnits = (
  targets: ReadonlySet<string>,
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
  for (const id of targets) {
    const element = elementsMap.get(id);
    if (!element || unitOf.has(id)) {
      continue;
    }
    const groupId = [...element.groupIds]
      .reverse()
      .find((groupId) =>
        (groups.get(groupId) ?? []).every((member) => targets.has(member.id)),
      );
    const members = groupId ? groups.get(groupId) ?? [] : [element];
    const labels = members.flatMap(
      (member) => getBoundTextElement(member, elementsMap) ?? [],
    );
    const unit: Unit = {
      id: groupId ?? element.id,
      members,
      frameId: element.frameId,
      box: boxOf([...members, ...labels], elementsMap),
    };
    for (const member of members) {
      unitOf.set(member.id, unit);
    }
  }

  return unitOf;
};

/** the units a request arranges, and the types of what it names but leaves out */
const unitsOf = (scene: Scene, elementIds: readonly string[] | undefined) => {
  const elements = scene.getNonDeletedElements();
  const elementsMap = scene.getNonDeletedElementsMap();
  const unitOf = groupUnits(
    resolveTargets(elements, elementsMap, elementIds),
    elements,
    elementsMap,
  );
  const skipped = new Set<ExcalidrawElement["type"]>();
  for (const [id, unit] of unitOf) {
    if (!unit.members.some((member) => ARRANGEABLE_TYPES.has(member.type))) {
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

/**
 * Lays the requested elements out with `engine`, one layout per frame (and one
 * for the free canvas), without touching the scene. Reads the scene before its
 * first await, so a change made while the engine runs makes the plan stale.
 */
export const planArrange = async (
  scene: Scene,
  appState: Readonly<Pick<AppState, "gridSize">>,
  request: ArrangeRequest,
  engine: LayoutEngine,
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

  const { unitOf } = unitsOf(scene, request.elementIds);

  /** frame id (null: the free canvas) -> its units and the arrows joining two of them */
  const partitions = new Map<string | null, Partition>();
  const partitionOf = (frameId: string | null) => {
    const partition = partitions.get(frameId) ?? {
      units: new Set(),
      arrows: [],
    };
    partitions.set(frameId, partition);
    return partition;
  };
  for (const unit of unitOf.values()) {
    partitionOf(unit.frameId).units.add(unit);
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

  const laidOut = [...partitions].filter(([, { units }]) => units.size > 1);
  if (!laidOut.length) {
    return null;
  }

  const versions = new Map<string, number>();
  const read = (element: ExcalidrawElement) =>
    versions.set(element.id, element.version);

  const jobs = laidOut.map(([frameId, { units, arrows }]) => {
    const nodes = [...units].sort(
      (a, b) => a.box.y - b.box.y || a.box.x - b.box.x,
    );
    for (const unit of nodes) {
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
      nodes,
      frame,
      positions: engine(
        {
          nodes: nodes.map(({ id, box }) => ({
            id,
            width: box.width,
            height: box.height,
          })),
          edges: arrows.map(({ edge }) => edge),
        },
        options,
      ),
    };
  });
  const placements = await Promise.all(jobs.map(({ positions }) => positions));

  const translations = new Map<string, { dx: number; dy: number }>();
  const frames = new Map<string, { width: number; height: number }>();

  jobs.forEach(({ nodes, frame }, i) => {
    const placed = placements[i];
    const at = (unit: Unit) => {
      const position = placed.get(unit.id);
      if (!position) {
        throw new Error(`The layout engine placed no position for ${unit.id}`);
      }
      return position;
    };
    const width = Math.max(...nodes.map((unit) => at(unit).x + unit.box.width));
    const height = Math.max(
      ...nodes.map((unit) => at(unit).y + unit.box.height),
    );
    let origin = {
      x: Math.min(...nodes.map((unit) => unit.box.x)),
      y: Math.min(...nodes.map((unit) => unit.box.y)),
    };
    if (frame) {
      const grown = {
        width: Math.max(frame.width, width + 2 * spacing.frameMargin),
        height: Math.max(frame.height, height + 2 * spacing.frameMargin),
      };
      if (grown.width !== frame.width || grown.height !== frame.height) {
        frames.set(frame.id, grown);
      }
      origin = {
        x: frame.x + (grown.width - width) / 2,
        y: frame.y + (grown.height - height) / 2,
      };
    }
    for (const unit of nodes) {
      const dx = origin.x + at(unit).x - unit.box.x;
      const dy = origin.y + at(unit).y - unit.box.y;
      unit.members.forEach((member) => translations.set(member.id, { dx, dy }));
    }
  });

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

  return { versions, translations, frames, overlappedFrameIds };
};

/**
 * Moves what the plan arranged, lays each container's label out again, follows
 * with bound arrows and grows frames; or does nothing and returns "stale" when
 * anything the plan read has changed since.
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
  const arranged = [...plan.translations].flatMap(([id, { dx, dy }]) => {
    const element = elementsMap.get(id);
    if (!element) {
      return [];
    }
    return [
      dx || dy
        ? scene.mutateElement(element, {
            x: element.x + dx,
            y: element.y + dy,
          })
        : element,
    ];
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
  const frames = [...plan.frames].flatMap(([id, size]) => {
    const frame = elementsMap.get(id);
    return frame ? [scene.mutateElement(frame, size)] : [];
  });
  for (const element of arranged) {
    updateBoundElements(element, scene, { simultaneouslyUpdated: arranged });
  }

  return [...arranged, ...labels, ...frames];
};
