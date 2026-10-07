import { isShallowEqual } from "@excalidraw/common";
import { getSettledBitmapGeneration } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { StaticCanvasRenderConfig } from "../scene/types";
import type { StaticCanvasAppState } from "../types";

export type UnderlayKey = {
  sceneNonce: number;
  settledBitmapGeneration: number;
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
  scale: number;
  width: number;
  height: number;
  elements: readonly ExcalidrawElement[];
  versions: readonly number[];
};

type Underlay =
  | { state: "seen"; key: UnderlayKey; bitmap: HTMLCanvasElement }
  | { state: "kept"; key: UnderlayKey; bitmap: HTMLCanvasElement };

const underlays = new WeakMap<HTMLCanvasElement, Underlay>();

export const underlayKey = (
  canvas: HTMLCanvasElement,
  scale: number,
  sceneNonce: number,
  appState: StaticCanvasAppState,
  renderConfig: StaticCanvasRenderConfig,
  elements: readonly ExcalidrawElement[],
): UnderlayKey => ({
  sceneNonce,
  settledBitmapGeneration: getSettledBitmapGeneration(),
  appState,
  renderConfig,
  scale,
  width: canvas.width,
  height: canvas.height,
  elements,
  versions: elements.map((element) => element.version),
});

const isSameKey = (a: UnderlayKey, b: UnderlayKey) =>
  a.sceneNonce === b.sceneNonce &&
  a.settledBitmapGeneration === b.settledBitmapGeneration &&
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

export const restoreUnderlay = (
  canvas: HTMLCanvasElement,
  key: UnderlayKey,
): boolean => {
  const underlay = underlays.get(canvas);
  const context = canvas.getContext("2d");
  if (underlay?.state !== "kept" || !context || !isSameKey(underlay.key, key)) {
    return false;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "copy";
  context.drawImage(underlay.bitmap, 0, 0);
  context.globalCompositeOperation = "source-over";
  return true;
};

export const rememberUnderlay = (
  canvas: HTMLCanvasElement,
  key: UnderlayKey,
) => {
  const underlay = underlays.get(canvas);
  const bitmap = underlay?.bitmap ?? document.createElement("canvas");
  if (!underlay || !isSameKey(underlay.key, key)) {
    underlays.set(canvas, { state: "seen", key, bitmap });
    return;
  }
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
  underlays.set(canvas, { state: "kept", key, bitmap });
};

export const releaseUnderlay = (canvas: HTMLCanvasElement) => {
  const underlay = underlays.get(canvas);
  if (underlay) {
    underlay.bitmap.width = 0;
    underlay.bitmap.height = 0;
    underlays.delete(canvas);
  }
};
