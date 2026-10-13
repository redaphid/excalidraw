import rough from "roughjs/bin/rough";

import {
  BUILD_AHEAD_VIEW_FRACTION,
  cancelSettledBitmaps,
  elementWithCanvasCache,
  Scene,
  SETTLED_BUILD_SLICE_MS,
  ShapeCache,
} from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";

const VIEW = 500;
const SHAPE_SIZE = 40;
const MS_PER_BITMAP = 3;

let lastCanvas: HTMLCanvasElement | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (lastCanvas) {
    cancelSettledBitmaps(lastCanvas);
  }
});

const paint = (elements: NonDeletedExcalidrawElement[], scrollX = 0) => {
  const scene = new Scene(elements, { skipValidation: true });
  const appState: AppState = {
    ...getDefaultAppState(),
    width: VIEW,
    height: VIEW,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX,
    scrollY: 0,
  };
  const { elementsMap, visibleElements } = new Renderer(
    scene,
  ).getRenderableElements({ ...appState, selectedElements: [] });
  const canvas = document.createElement("canvas");
  lastCanvas = canvas;
  canvas.width = canvas.height = VIEW;
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
};

const ZOOM_SETTLE_AND_BUILD_MS = 400;
const settle = () =>
  new Promise((resolve) => setTimeout(resolve, ZOOM_SETTLE_AND_BUILD_MS));

const rectangleAt = (x: number) =>
  API.createElement({
    type: "rectangle",
    x,
    y: 100,
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    fillStyle: "hachure",
    backgroundColor: "#a5d8ff",
  });

const strokeAt = (x: number) =>
  API.createElement({
    type: "freedraw",
    x,
    y: 100,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(20, 10),
      pointFrom<LocalPoint>(40, 0),
    ],
  });

const NEAR_GAP = VIEW * BUILD_AHEAD_VIEW_FRACTION * 0.5;
const NEAR_X = VIEW + NEAR_GAP;
const FAR_X = VIEW + VIEW * BUILD_AHEAD_VIEW_FRACTION * 4;
const SCROLL_LEAVING_FAR_LEFT_SHAPE_NEAR = FAR_X - SHAPE_SIZE - NEAR_GAP;

const isBuilt = (element: NonDeletedExcalidrawElement) =>
  elementWithCanvasCache.get(element)?.zoomValue === 1;

describe("elements just outside the view, once the view holds still", () => {
  it("get their shapes and bitmaps built", async () => {
    const shape = rectangleAt(NEAR_X);
    const stroke = strokeAt(NEAR_X + 60);
    paint([rectangleAt(10), shape, stroke]);
    expect(ShapeCache.get(shape, null)).toBeUndefined();
    await settle();
    expect(ShapeCache.get(shape, null)).toBeDefined();
    expect(ShapeCache.get(stroke, null)).toBeDefined();
    expect([isBuilt(shape), isBuilt(stroke)]).toEqual([true, true]);
  });

  it("are drawn from those bitmaps on the frame they enter the view", async () => {
    const shape = rectangleAt(NEAR_X);
    const stroke = strokeAt(NEAR_X + 60);
    const elements = [rectangleAt(10), shape, stroke];
    paint(elements);
    await settle();
    const built = [shape, stroke].map((el) => elementWithCanvasCache.get(el));
    paint(elements, -NEAR_X + 10);
    expect([shape, stroke].map((el) => elementWithCanvasCache.get(el))).toEqual(
      built,
    );
  });

  it("leave elements far from the view unbuilt", async () => {
    const far = [rectangleAt(FAR_X), strokeAt(FAR_X + 60)];
    paint([rectangleAt(10), rectangleAt(NEAR_X), ...far]);
    await settle();
    expect(far.map((el) => ShapeCache.get(el, null))).toEqual([
      undefined,
      undefined,
    ]);
    expect(far.map((el) => elementWithCanvasCache.get(el))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("are the ones near the latest view when the view moves first", async () => {
    const nearFirst = rectangleAt(NEAR_X);
    const nearLatest = rectangleAt(-FAR_X);
    const elements = [rectangleAt(10), nearFirst, nearLatest];
    paint(elements);
    paint(elements, SCROLL_LEAVING_FAR_LEFT_SHAPE_NEAR);
    await settle();
    expect([isBuilt(nearFirst), isBuilt(nearLatest)]).toEqual([false, true]);
  });
});

describe("an idle slice building elements near the view", () => {
  it("stops at its time budget even when the browser offers more", async () => {
    const idle: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idle.push(callback);
      return idle.length;
    });
    vi.stubGlobal("cancelIdleCallback", () => {});

    const near = Array.from({ length: 20 }, (_, i) =>
      rectangleAt(VIEW + 10 + i * 5),
    );
    paint([rectangleAt(10), ...near]);
    await settle();
    expect(idle).toHaveLength(1);

    let now = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "canvas") {
          now += MS_PER_BITMAP;
        }
        return createElement(tag, options);
      },
    );
    const deadline = { didTimeout: false, timeRemaining: () => 50 };

    const sliceStart = now;
    idle.shift()!(deadline);
    expect(now - sliceStart).toBeLessThan(
      SETTLED_BUILD_SLICE_MS + MS_PER_BITMAP,
    );
    expect(near.filter(isBuilt).length).toBeGreaterThan(0);
    expect(near.filter(isBuilt).length).toBeLessThan(near.length);

    while (idle.length) {
      idle.shift()!(deadline);
    }
    expect(near.filter(isBuilt)).toHaveLength(near.length);
  });
});
