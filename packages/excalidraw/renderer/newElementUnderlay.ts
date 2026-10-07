import { isShallowEqual } from "@excalidraw/common";
import { getSettledBitmapsBuilt } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { StaticCanvasRenderConfig } from "../scene/types";
import type { StaticCanvasAppState } from "../types";

// A new element drawn inside a frame stays on the static canvas to keep its
// z-order among the frame's children, so that canvas repaints on every pointer
// move. While nothing that paints under the new element changes, the pixels
// under it are copied back instead of repainted.

export type UnderlayKey = {
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
  settledBitmapsBuilt: number;
  scale: number;
  width: number;
  height: number;
  elements: readonly ExcalidrawElement[];
  versions: readonly number[];
};

type Underlay = {
  bitmap: HTMLCanvasElement;
  key: UnderlayKey | null;
  candidate: UnderlayKey | null;
};

const underlays = new WeakMap<HTMLCanvasElement, Underlay>();

export const underlayKey = (
  canvas: HTMLCanvasElement,
  scale: number,
  appState: StaticCanvasAppState,
  renderConfig: StaticCanvasRenderConfig,
  elements: readonly ExcalidrawElement[],
): UnderlayKey => ({
  appState,
  renderConfig,
  settledBitmapsBuilt: getSettledBitmapsBuilt(),
  scale,
  width: canvas.width,
  height: canvas.height,
  elements,
  versions: elements.map((element) => element.version),
});

const isSameKey = (a: UnderlayKey, b: UnderlayKey) =>
  a.settledBitmapsBuilt === b.settledBitmapsBuilt &&
  a.scale === b.scale &&
  a.width === b.width &&
  a.height === b.height &&
  a.elements.length === b.elements.length &&
  a.elements.every(
    (element, index) =>
      element === b.elements[index] && a.versions[index] === b.versions[index],
  ) &&
  isShallowEqual(a.appState, b.appState) &&
  isShallowEqual(a.renderConfig, b.renderConfig);

/** Copies the underlay kept under `key` back onto the canvas and returns the
 * canvas' context set up as `bootstrapCanvas` leaves it, or null when there
 * is none to copy. */
export const restoreUnderlay = (
  canvas: HTMLCanvasElement,
  key: UnderlayKey,
): CanvasRenderingContext2D | null => {
  const underlay = underlays.get(canvas);
  const context = canvas.getContext("2d");
  if (!underlay?.key || !context || !isSameKey(underlay.key, key)) {
    return null;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "copy";
  context.drawImage(underlay.bitmap, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.scale(key.scale, key.scale);
  return context;
};

/** Keeps the canvas as painted so far as the underlay, once the same key has
 * come twice in a row, so a key that changes on every move never pays for
 * the copy. */
export const rememberUnderlay = (
  canvas: HTMLCanvasElement,
  key: UnderlayKey,
) => {
  let underlay = underlays.get(canvas);
  if (!underlay) {
    underlay = {
      bitmap: document.createElement("canvas"),
      key: null,
      candidate: null,
    };
    underlays.set(canvas, underlay);
  }
  if (!underlay.candidate || !isSameKey(underlay.candidate, key)) {
    underlay.candidate = key;
    underlay.key = null;
    return;
  }
  const { bitmap } = underlay;
  if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) {
    bitmap.width = canvas.width;
    bitmap.height = canvas.height;
  }
  const context = bitmap.getContext("2d");
  if (!context || !canvas.width || !canvas.height) {
    return;
  }
  context.globalCompositeOperation = "copy";
  context.drawImage(canvas, 0, 0);
  underlay.key = key;
};

/** Frees the underlay's pixels once no new element needs them. */
export const releaseUnderlay = (canvas: HTMLCanvasElement) => {
  const underlay = underlays.get(canvas);
  if (underlay?.candidate) {
    underlay.bitmap.width = 0;
    underlay.bitmap.height = 0;
    underlay.key = null;
    underlay.candidate = null;
  }
};
