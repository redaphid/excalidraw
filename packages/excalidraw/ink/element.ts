import { getSizeFromPoints } from "@excalidraw/common";
import { newElementWith, newFreeDrawElement } from "@excalidraw/element";
import { generateKeyBetween } from "@excalidraw/fractional-indexing";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  FractionalIndex,
  NonDeleted,
} from "@excalidraw/element/types";

import { simulatesPressure, streamlineFor } from "./gate";

import type App from "../components/App";
import type { Sample } from "./stroke";

export type Freedraw = NonDeleted<ExcalidrawFreeDrawElement>;

type FreedrawHost = Pick<
  App,
  "state" | "getCurrentItemScale" | "getTopLayerFrameAtSceneCoords"
>;

/**
 * The element a freedraw stroke starts as, where the pointer went down: the
 * editor's own freedraw path makes its strokes here too.
 */
export const newFreedrawAt = (
  host: FreedrawHost,
  origin: { x: number; y: number },
  pointer: { pointerType: string; pressure: number },
): Freedraw => {
  const { state } = host;
  const simulatePressure = simulatesPressure(pointer);
  return newFreeDrawElement({
    type: "freedraw",
    x: origin.x,
    y: origin.y,
    strokeColor: state.currentItemStrokeColor,
    backgroundColor: state.currentItemBackgroundColor,
    fillStyle: state.currentItemFillStyle,
    ...host.getCurrentItemScale("freedraw"),
    strokeStyle: state.currentItemStrokeStyle,
    roughness: state.currentItemRoughness,
    opacity: state.currentItemOpacity,
    roundness: null,
    simulatePressure,
    strokeOptions: {
      variability: state.currentItemStrokeVariability,
      streamline: streamlineFor(pointer.pointerType),
    },
    locked: false,
    frameId: host.getTopLayerFrameAtSceneCoords(origin)?.id ?? null,
    points: [pointFrom<LocalPoint>(0, 0)],
    // pressures are only consumed when rendering a real-pressure stroke, so
    // skip persisting them while pressure is being simulated
    pressures: simulatePressure ? [] : [pointer.pressure],
  });
};

/** What the editor adds on pointerup when the pen never left its first point. */
const NUDGE = 0.0001;

/**
 * `element` drawn through every sample so far. Unlike the editor's finalize,
 * it never snaps an end near the start onto it: a stroke shorter than the
 * snapping distance would jump at the hand-off, a tick collapsing to a dot.
 */
export const freedrawThrough = (
  element: Freedraw,
  samples: readonly Sample[],
): Freedraw => {
  const points = samples.map((s) =>
    pointFrom<LocalPoint>(s.x - element.x, s.y - element.y),
  );
  const pressures = samples.map((s) => s.pressure);
  const last = samples.at(-1);
  if (points.length === 1 && last) {
    points.push(pointFrom<LocalPoint>(NUDGE, NUDGE));
    pressures.push(last.pressure);
  }
  return newElementWith(element, {
    points,
    pressures: element.simulatePressure ? [] : pressures,
    ...getSizeFromPoints(points),
  });
};

/**
 * A fractional index above everything in the scene. A stroke streamed to
 * collaborators before it is committed needs one, or each of them would
 * assign their own, bump the version, and push it back mid-stroke.
 */
export const indexAfter = (
  elements: readonly Pick<ExcalidrawElement, "index">[],
): FractionalIndex | null => {
  const top = elements.at(-1);
  if (top && top.index === null) {
    return null;
  }
  try {
    return generateKeyBetween(top?.index ?? null, null) as FractionalIndex;
  } catch {
    return null;
  }
};
