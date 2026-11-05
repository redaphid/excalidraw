import { arrayToMap, type Bounds } from "@excalidraw/common";
import {
  lineSegment,
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type LocalPoint,
} from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  boundsContainBounds,
  doBoundsIntersect,
  elementCenterPoint,
  elementsOverlappingBBox,
  getElementBounds,
  pointInsideBounds,
} from "../src/bounds";
import { intersectElementWithLineSegment } from "../src/collision";
import { elementOverlapsWithFrame, getContainingFrame } from "../src/frame";
import { LinearElementEditor } from "../src/linearElementEditor";
import { mutateElement } from "../src/mutateElement";
import { getBoundTextElement } from "../src/textElement";
import {
  isArrowElement,
  isExcalidrawElement,
  isFrameLikeElement,
  isFreeDrawElement,
  isLinearElement,
} from "../src/typeChecks";

import type { ElementsMap, ExcalidrawElement } from "../src/types";

/** `elementsOverlappingBBox` as it was before the R-tree: a scan of every
 * element */
const linearElementsOverlappingBBox = <T extends ExcalidrawElement>({
  elements,
  elementsMap,
  bounds,
  type,
  excludeElementsInFrames,
  shouldIgnoreElementFromSelection,
}: {
  elements: readonly T[];
  elementsMap?: ElementsMap;
  bounds: Bounds | ExcalidrawElement;
  /**
   * - overlap: elements overlapping or inside bounds
   * - contain: elements inside bounds
   **/
  type: "contain" | "overlap";
  excludeElementsInFrames?: boolean;
  shouldIgnoreElementFromSelection?: (element: T) => boolean;
}) => {
  if (!elementsMap) {
    elementsMap = arrayToMap(elements) as ElementsMap;
  }
  const selectionBounds = isExcalidrawElement(bounds)
    ? getElementBounds(bounds, elementsMap)
    : bounds;
  const [selectionX1, selectionY1, selectionX2, selectionY2] = selectionBounds;
  const selectionEdges = [
    lineSegment<GlobalPoint>(
      pointFrom(selectionX1, selectionY1),
      pointFrom(selectionX2, selectionY1),
    ),
    lineSegment<GlobalPoint>(
      pointFrom(selectionX2, selectionY1),
      pointFrom(selectionX2, selectionY2),
    ),
    lineSegment<GlobalPoint>(
      pointFrom(selectionX2, selectionY2),
      pointFrom(selectionX1, selectionY2),
    ),
    lineSegment<GlobalPoint>(
      pointFrom(selectionX1, selectionY2),
      pointFrom(selectionX1, selectionY1),
    ),
  ];

  const framesInSelection = excludeElementsInFrames
    ? new Set<ExcalidrawElement["id"]>()
    : null;
  const groups: Record<string, T[]> = {};
  const elementsInSelection: Set<T> = new Set();

  for (const element of elements) {
    if (shouldIgnoreElementFromSelection?.(element)) {
      continue;
    }

    // Track only selectable top-level group members, so ignored elements such
    // as bound text and locked elements don't affect group selection.
    const groupId = element.groupIds.at(-1);
    if (groupId) {
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(element);
    }

    const strokeWidth = element.strokeWidth;
    let labelAABB: Bounds | null = null;
    let elementAABB = getElementBounds(element, elementsMap);

    elementAABB = [
      elementAABB[0] - strokeWidth / 2,
      elementAABB[1] - strokeWidth / 2,
      elementAABB[2] + strokeWidth / 2,
      elementAABB[3] + strokeWidth / 2,
    ] as Bounds;

    // Whether the element bounds should include the bound text element bounds
    const boundTextElement =
      isArrowElement(element) && getBoundTextElement(element, elementsMap);
    if (boundTextElement) {
      const { x, y } = LinearElementEditor.getBoundTextElementPosition(
        element,
        boundTextElement,
        elementsMap,
      );
      labelAABB = [
        x,
        y,
        x + boundTextElement.width,
        y + boundTextElement.height,
      ] as Bounds;
    }

    // Clip element bounds by its containing frame (if any), since only the
    // visible (frame-clipped) portion of the element is relevant for selection.
    const associatedFrame = getContainingFrame(element, elementsMap);
    if (
      associatedFrame &&
      elementOverlapsWithFrame(element, associatedFrame, elementsMap)
    ) {
      const frameAABB = getElementBounds(associatedFrame, elementsMap);
      elementAABB = [
        Math.max(elementAABB[0], frameAABB[0]),
        Math.max(elementAABB[1], frameAABB[1]),
        Math.min(elementAABB[2], frameAABB[2]),
        Math.min(elementAABB[3], frameAABB[3]),
      ] as Bounds;

      labelAABB = labelAABB
        ? ([
            Math.max(labelAABB[0], frameAABB[0]),
            Math.max(labelAABB[1], frameAABB[1]),
            Math.min(labelAABB[2], frameAABB[2]),
            Math.min(labelAABB[3], frameAABB[3]),
          ] as Bounds)
        : null;
    }

    const commonAABB = labelAABB
      ? ([
          Math.min(labelAABB[0], elementAABB[0]),
          Math.min(labelAABB[1], elementAABB[1]),
          Math.max(labelAABB[2], elementAABB[2]),
          Math.max(labelAABB[3], elementAABB[3]),
        ] as Bounds)
      : elementAABB;

    // ============== Evaluation ==============

    // 1. If the selection box WRAPs the element's AABB, then add it to the
    //    selection and move on, regardless of the selection mode.
    //
    //    PERF: This trick only works with axis-aligned box selection and the
    //          current convex element shapes!
    if (boundsContainBounds(selectionBounds, commonAABB)) {
      if (framesInSelection && isFrameLikeElement(element)) {
        framesInSelection.add(element.id);
      }
      elementsInSelection.add(element);
      continue;
    }

    // 2. Handle the case where the label is overlapped by the selection box
    if (
      type === "overlap" &&
      labelAABB &&
      doBoundsIntersect(selectionBounds, labelAABB)
    ) {
      elementsInSelection.add(element);
      continue;
    }

    // 3. Handle the case where the selection is not wrapping the element, but
    //    it does intersect the element's outline (non-AABB).
    if (type === "overlap" && doBoundsIntersect(selectionBounds, elementAABB)) {
      let hasIntersection = false;

      // Preliminary check potential intersection imprecision
      if (isLinearElement(element) || isFreeDrawElement(element)) {
        const center = elementCenterPoint(element, elementsMap);
        hasIntersection = element.points.some((point) => {
          const rotatedPoint = pointRotateRads(
            pointFrom<GlobalPoint>(element.x + point[0], element.y + point[1]),
            center,
            element.angle,
          );

          return pointInsideBounds(rotatedPoint, selectionBounds);
        });
      } else {
        const nonRotatedElementBounds = getElementBounds(
          element,
          elementsMap,
          true,
        );
        const center = elementCenterPoint(element, elementsMap);
        hasIntersection = [
          pointRotateRads(
            pointFrom<GlobalPoint>(
              (nonRotatedElementBounds[0] + nonRotatedElementBounds[2]) / 2,
              nonRotatedElementBounds[1],
            ),
            center,
            element.angle,
          ),
          pointRotateRads(
            pointFrom<GlobalPoint>(
              nonRotatedElementBounds[2],
              (nonRotatedElementBounds[1] + nonRotatedElementBounds[3]) / 2,
            ),
            center,
            element.angle,
          ),
          pointRotateRads(
            pointFrom<GlobalPoint>(
              (nonRotatedElementBounds[0] + nonRotatedElementBounds[2]) / 2,
              nonRotatedElementBounds[3],
            ),
            center,
            element.angle,
          ),
          pointRotateRads(
            pointFrom<GlobalPoint>(
              nonRotatedElementBounds[0],
              (nonRotatedElementBounds[1] + nonRotatedElementBounds[3]) / 2,
            ),
            center,
            element.angle,
          ),
        ].some((point) => {
          return pointInsideBounds(
            pointRotateRads(point, center, element.angle),
            selectionBounds,
          );
        });
      }

      if (!hasIntersection) {
        hasIntersection = selectionEdges.some(
          (selectionEdge) =>
            intersectElementWithLineSegment(
              element,
              elementsMap,
              selectionEdge,
              strokeWidth / 2,
              true, // Stop at first hit for better performance
            ).length > 0,
        );
      }

      if (hasIntersection) {
        if (framesInSelection && isFrameLikeElement(element)) {
          framesInSelection.add(element.id);
        }

        elementsInSelection.add(element);
        continue;
      }
    }

    // 4. We don't need to handle when the selection is inside the element
    //    as it is separately handled in App.
  }

  if (framesInSelection) {
    elementsInSelection.forEach((element) => {
      if (element.frameId && framesInSelection.has(element.frameId)) {
        elementsInSelection.delete(element);
      }
    });
  }

  if (type === "overlap") {
    Array.from(elementsInSelection).forEach((element) => {
      const groupId = element.groupIds.at(-1);
      const group = groupId ? groups[groupId] : null;

      group?.forEach((groupElement) => elementsInSelection.add(groupElement));
    });
  } else if (type === "contain") {
    elementsInSelection.forEach((element) => {
      // note: currently we only support top-level group handling since
      // we don't support box selecting while editing the group/subgroup
      // see https://github.com/excalidraw/excalidraw/pull/11234#issuecomment-4387654451
      const groupId = element.groupIds.at(-1);

      const group = groupId ? groups[groupId] : null;

      if (
        group &&
        !group.every((groupElement) => elementsInSelection.has(groupElement))
      ) {
        elementsInSelection.delete(element);
      }
    });
  }

  // to maintain original order elements (namely for group selection)
  return elements.filter((element) => elementsInSelection.has(element));
};

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = ReturnType<typeof mulberry32>;

const between = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);

/** labelled shapes and arrows, strokes, groups and frames, from a millionth of
 * a unit up to a thousand across */
const randomBoard = (rng: Rng, count: number) => {
  const frame = API.createElement({
    type: "frame",
    x: -1500,
    y: -1500,
    width: 2500,
    height: 2500,
  });
  const groups = ["g1", "g2", "g3", "g4"];
  const elements: ExcalidrawElement[] = [];
  for (let i = 0; i < count; i++) {
    const size = 10 ** between(rng, -6, 3);
    const x =
      rng() < 0.5 ? 500 + between(rng, -2, 2) * size : between(rng, -4e3, 4e3);
    const y =
      rng() < 0.5 ? 500 + between(rng, -2, 2) * size : between(rng, -4e3, 4e3);
    const common = {
      x,
      y,
      width: size,
      height: size * between(rng, 0.2, 2),
      angle: rng() < 0.3 ? between(rng, 0, Math.PI * 2) : 0,
      strokeWidth: size / between(rng, 5, 50),
      groupIds: rng() < 0.2 ? [groups[Math.floor(rng() * groups.length)]] : [],
      frameId:
        x > frame.x &&
        y > frame.y &&
        x < frame.x + frame.width &&
        y < frame.y + frame.height &&
        rng() < 0.7
          ? frame.id
          : null,
    };
    const kind = Math.floor(rng() * 5);
    if (kind === 0) {
      elements.push(
        API.createElement({
          ...common,
          type: "freedraw",
          points: [
            pointFrom<LocalPoint>(0, 0),
            pointFrom<LocalPoint>(size, size / 3),
            pointFrom<LocalPoint>(size / 2, size),
          ],
        }),
      );
    } else if (kind === 1 || kind === 2) {
      const container = API.createElement({
        ...common,
        type: kind === 1 ? "arrow" : "rectangle",
        ...(kind === 1
          ? {
              points: [
                pointFrom<LocalPoint>(0, 0),
                pointFrom<LocalPoint>(size, size),
              ],
            }
          : {}),
      });
      const label = API.createElement({
        type: "text",
        text: "a label",
        x: x + size / 2,
        y: y + size / 2,
        fontSize: Math.max(size / 4, 1e-6) as never,
        containerId: container.id,
        groupIds: common.groupIds,
        frameId: common.frameId,
      });
      elements.push(
        { ...container, boundElements: [{ id: label.id, type: "text" }] },
        label,
      );
    } else {
      elements.push(
        API.createElement({
          ...common,
          type: kind === 3 ? "ellipse" : "diamond",
        }),
      );
    }
  }
  return [...elements, frame];
};

const randomBounds = (
  rng: Rng,
  elements: readonly ExcalidrawElement[],
): Bounds => {
  const anchor = elements[Math.floor(rng() * elements.length)];
  const size = Math.max(anchor.width, 1e-6) * 10 ** between(rng, -1, 2);
  const x = anchor.x + between(rng, -1, 1) * size;
  const y = anchor.y + between(rng, -1, 1) * size;
  return [
    x,
    y,
    x + size * between(rng, 0.2, 2),
    y + size * between(rng, 0.2, 2),
  ];
};

const ids = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => element.id);

describe("elementsOverlappingBBox", () => {
  it("finds what a scan of every element finds, in order, across random boards, boxes and edits", () => {
    const rng = mulberry32(5);
    let found = 0;
    for (let board = 0; board < 10; board++) {
      let elements = randomBoard(rng, 120);
      for (let step = 0; step < 40; step++) {
        const elementsMap: ElementsMap | undefined =
          rng() < 0.5 ? arrayToMap(elements) : undefined;
        const opts = {
          elements,
          elementsMap,
          bounds: randomBounds(rng, elements),
          type: rng() < 0.5 ? ("overlap" as const) : ("contain" as const),
          excludeElementsInFrames: rng() < 0.5,
          shouldIgnoreElementFromSelection:
            rng() < 0.5
              ? (element: ExcalidrawElement) =>
                  element.type === "text" && !!element.containerId
              : undefined,
        };
        const expected = ids(linearElementsOverlappingBBox(opts));
        expect(ids(elementsOverlappingBBox(opts))).toEqual(expected);
        found += expected.length;

        const target = elements[Math.floor(rng() * elements.length)];
        const edit = rng();
        if (edit < 0.3) {
          // in place, as a drag does, so the array stays the same
          mutateElement(target, arrayToMap(elements), {
            x: target.x + between(rng, -500, 500),
            groupIds: rng() < 0.3 ? ["g1"] : target.groupIds,
          });
        } else if (edit < 0.4) {
          elements = [
            ...elements.filter((el) => el !== target),
            ...randomBoard(rng, 1),
          ];
        }
      }
    }
    expect(found).toBeGreaterThan(400);
  });
  it("reads only the elements near a small box once the array has been seen", () => {
    const rng = mulberry32(9);
    const touched = new Set<string>();
    let recording = false;
    const elements = randomBoard(rng, 1000).map(
      (element) =>
        new Proxy(element, {
          get(target, key, receiver) {
            if (recording) {
              touched.add(target.id);
            }
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const near: Bounds = [499.999, 499.999, 500.001, 500.001];
    elementsOverlappingBBox({ elements, bounds: near, type: "overlap" });

    recording = true;
    const found = elementsOverlappingBBox({
      elements,
      bounds: [500, 500, 500.002, 500.002],
      type: "overlap",
    });
    recording = false;

    expect(found.length).toBeGreaterThan(0);
    expect(touched.size).toBeLessThan(elements.length / 10);
  });
});
