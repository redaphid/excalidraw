import rough from "roughjs/bin/rough";

import { Scene } from "@excalidraw/element";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";
import { getNormalizedZoom } from "../scene";

import type { AppState } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
});

/** the grid lines drawn over a 1000 by 600 px screen, as their x or y */
const gridLines = (zoom: number) => {
  const scene = new Scene([], { skipValidation: true });
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 1000,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    gridSize: 20,
    gridStep: 5,
    gridModeEnabled: true,
    scrollX: 0,
    scrollY: 0,
    zoom: { value: getNormalizedZoom(zoom) },
  };
  const { elementsMap, visibleElements } = new Renderer(
    scene,
  ).getRenderableElements({ ...appState, selectedElements: [] });
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const context = canvas.getContext("2d")!;
  const moveTo = vi.spyOn(context, "moveTo");
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
      renderGrid: true,
      isExporting: false,
      canvasBackgroundColor: "#fff",
      embedsValidationStatus: new Map(),
      elementsPendingErasure: new Set(),
      pendingFlowchartNodes: null,
      theme: "light",
    },
  });
  return moveTo.mock.calls.length;
};

describe("the grid zoomed out", () => {
  it("draws upstream's lines at 10%", () => {
    // 2 px cells: only every fifth line, the bold one, 10 px apart, plus
    // the margin lines; the count master draws
    expect(gridLines(0.1)).toBe(162);
  });

  it.each([0.01, 0.000_1, 0.000_001])(
    "draws no more lines at %s than at 10%%",
    (zoom) => {
      expect(gridLines(zoom)).toBeLessThanOrEqual(gridLines(0.1));
      expect(gridLines(zoom)).toBeGreaterThan(0);
    },
  );
});
