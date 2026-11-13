import { arrayToMap, type Bounds } from "@excalidraw/common";
import {
  lineSegment,
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
} from "@excalidraw/math";

import {
  boundsContainBounds,
  doBoundsIntersect,
  elementCenterPoint,
  getElementBounds,
  pointInsideBounds,
} from "../src/bounds";
import { intersectElementWithLineSegment } from "../src/collision";
import { elementOverlapsWithFrame, getContainingFrame } from "../src/frame";
import { LinearElementEditor } from "../src/linearElementEditor";
import { getBoundTextElement } from "../src/textElement";
import {
  isArrowElement,
  isExcalidrawElement,
  isFrameLikeElement,
  isFreeDrawElement,
  isLinearElement,
} from "../src/typeChecks";

import type { ElementsMap, ExcalidrawElement } from "../src/types";

/**
 * `elementsOverlappingBBox` as it was before the R-tree, a scan of every
 * element, kept verbatim as the oracle the indexed version must equal.
 */
export const linearElementsOverlappingBBox = <T extends ExcalidrawElement>({
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
