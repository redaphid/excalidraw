import rough from "roughjs/bin/rough";

import { Scene } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState, NormalizedZoomValue } from "../types";

/** the bitmaps an element is laid on screen from, at `zoom` */
const blitsAt = (element: ExcalidrawElement, zoom: number) => {
  const scene = new Scene([element], { skipValidation: true });
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 1000,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
    // updateScene sets any zoom, unclamped
    zoom: { value: zoom as NormalizedZoomValue },
  };
  const { elementsMap, visibleElements } = new Renderer(
    scene,
  ).getRenderableElements({ ...appState, selectedElements: [] });
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const context = canvas.getContext("2d")!;
  const blits: { width: number; height: number }[] = [];
  context.drawImage = ((image: HTMLCanvasElement) => {
    blits.push({ width: image.width, height: image.height });
  }) as typeof context.drawImage;
  renderStaticScene({
    canvas,
    rc: rough.canvas(canvas),
    scale: 1,
    elementsMap,
    allElementsMap: scene.getNonDeletedElementsMap(),
    visibleElements,
    appState,
    renderConfig: {
      imageCache: new Map(),
      renderGrid: false,
      isExporting: false,
      canvasBackgroundColor: "#fff",
      embedsValidationStatus: new Map(),
      elementsPendingErasure: new Set(),
      pendingFlowchartNodes: null,
      theme: "light",
    },
  });
  return blits;
};

describe("a straight line zoomed far out", () => {
  // A straight line's bitmap is only its padding (about 25 units each
  // side) thick: at 0.01, half a pixel, which floored to 0 and drew
  // nothing, though the line is 100 px long on screen
  it.each([
    ["horizontal line", "line", 10_000, 0],
    ["vertical line", "line", 0, 10_000],
    ["horizontal arrow", "arrow", 10_000, 0],
  ] as const)("still draws a %s", (_, type, width, height) => {
    const element = API.createElement({
      type,
      x: 0,
      y: 0,
      width,
      height,
      points: [
        [0, 0],
        [width, height],
      ] as any,
    });
    const blits = blitsAt(element, 0.01);
    expect(blits).toHaveLength(1);
    const [{ width: across, height: down }] = blits;
    // a pixel thick, and as long as the line on screen plus its padding
    expect(width ? down : across).toBe(1);
    expect(width ? across : down).toBeGreaterThanOrEqual(100);
    expect(width ? across : down).toBeLessThan(102);
  });

  it("still draws nothing for a line under a pixel each way", () => {
    const element = API.createElement({
      type: "line",
      x: 0,
      y: 0,
      width: 10,
      height: 0,
      points: [
        [0, 0],
        [10, 0],
      ] as any,
    });
    expect(blitsAt(element, 0.005)).toEqual([]);
  });
});
