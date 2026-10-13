import rough from "roughjs/bin/rough";

import { elementWithCanvasCache, Scene } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";

import type { AppState } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
});

const SIZE = 500;

/** a 10 by 10 grid of small rectangles, all on screen at 1x and 1.5x */
const grid = () =>
  Array.from({ length: 100 }, (_, i) =>
    API.createElement({
      type: "rectangle",
      x: (i % 10) * 30 + 10,
      y: Math.floor(i / 10) * 30 + 10,
      width: 20,
      height: 20,
    }),
  );

const board = (elements: NonDeletedExcalidrawElement[]) => {
  const scene = new Scene(elements, { skipValidation: true });
  const renderer = new Renderer(scene);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const created = vi.spyOn(document, "createElement");

  /** paints the scene once; returns how many bitmaps that built */
  const paint = (zoom: number, state: Partial<AppState> = {}) => {
    const appState: AppState = {
      ...getDefaultAppState(),
      width: SIZE,
      height: SIZE,
      offsetLeft: 0,
      offsetTop: 0,
      zoom: { value: getNormalizedZoom(zoom) },
      ...state,
    };
    const { elementsMap, visibleElements } = renderer.getRenderableElements({
      ...appState,
      selectedElements: [],
    });
    created.mockClear();
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
    return created.mock.calls.filter(([tag]) => tag === "canvas").length;
  };

  const sharpAt = (zoom: number) =>
    elements.filter(
      (element) => elementWithCanvasCache.get(element)?.zoomValue === zoom,
    );

  return { paint, sharpAt };
};

describe("element bitmaps are built a few per frame", () => {
  it("builds some of a new board's bitmaps per paint, then the rest on later frames", async () => {
    const elements = grid();
    const { paint, sharpAt } = board(elements);

    const built = paint(1);
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(elements.length);

    await vi.waitFor(() => expect(sharpAt(1)).toHaveLength(elements.length));
  });

  it("redraws a few blown-up bitmaps per paint while the zoom animates", () => {
    const elements = grid();
    const { paint, sharpAt } = board(elements);
    paint(0.2);
    for (
      let i = 0;
      i < elements.length && sharpAt(0.2).length < elements.length;
      i++
    ) {
      paint(0.2);
    }
    expect(sharpAt(0.2)).toHaveLength(elements.length);

    const built = paint(1, { shouldCacheIgnoreZoom: true });
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(elements.length);
  });

  it("redraws a few stale bitmaps per paint once a zoom settles, the middle of the view first", async () => {
    const elements = grid();
    const { paint, sharpAt } = board(elements);
    paint(1);
    await vi.waitFor(() => expect(sharpAt(1)).toHaveLength(elements.length));

    // zoomed about the grid's middle, (155, 155) in the scene
    const zoomed = {
      scrollX: SIZE / 2 / 1.5 - 155,
      scrollY: SIZE / 2 / 1.5 - 155,
    };
    expect(paint(1.5, { ...zoomed, shouldCacheIgnoreZoom: true })).toBe(0);

    const built = paint(1.5, zoomed);
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(elements.length);
    const middle = elements[44];
    expect(sharpAt(1.5)).toContain(middle);
    expect(sharpAt(1.5)).not.toContain(elements[0]);

    await vi.waitFor(() => expect(sharpAt(1.5)).toHaveLength(elements.length));
  });
});
