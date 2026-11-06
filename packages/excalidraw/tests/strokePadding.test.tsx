import rough from "roughjs/bin/rough";

import {
  cancelSettledBitmaps,
  elementWithCanvasCache,
  getElementAbsoluteCoords,
  Scene,
} from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";

import type { AppState } from "../types";

const ZOOM = 0.25;
const pixelRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
let lastCanvas: HTMLCanvasElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });
});

afterEach(() => {
  if (pixelRatio) {
    Object.defineProperty(window, "devicePixelRatio", pixelRatio);
  }
  if (lastCanvas) {
    cancelSettledBitmaps(lastCanvas);
  }
});

/** The bitmap the static scene caches for `element`, zoomed out on a 2x screen. */
const cachedBitmap = (element: NonDeletedExcalidrawElement) => {
  const scene = new Scene([element], { skipValidation: true });
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 1440,
    height: 900,
    offsetLeft: 0,
    offsetTop: 0,
    zoom: { value: getNormalizedZoom(ZOOM) },
  };
  const { elementsMap, visibleElements } = new Renderer(
    scene,
  ).getRenderableElements({ ...appState, selectedElements: [] });
  const canvas = document.createElement("canvas");
  lastCanvas = canvas;
  canvas.width = 1440;
  canvas.height = 900;
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
  const cached = elementWithCanvasCache.get(element);
  expect(cached).toBeDefined();
  return cached!;
};

const points = [
  pointFrom<LocalPoint>(0, 0),
  pointFrom<LocalPoint>(235, 166),
  pointFrom<LocalPoint>(235, 0),
  pointFrom<LocalPoint>(0, 166),
  pointFrom<LocalPoint>(0, 0),
];

describe("a thick line's cached bitmap", () => {
  it("holds the whole stroke, so its outer edge is not cut flat", () => {
    const line = API.createElement({
      type: "line",
      x: 0,
      y: 0,
      strokeWidth: 40,
      roughness: 0,
      roundness: { type: 2 },
      points,
    });
    const { canvas, scale } = cachedBitmap(line);
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(
      line,
      new Map([[line.id, line]]),
    );
    const across = window.devicePixelRatio * scale;
    expect(canvas.width).toBeGreaterThanOrEqual(
      (x2 - x1 + line.strokeWidth) * across,
    );
    expect(canvas.height).toBeGreaterThanOrEqual(
      (y2 - y1 + line.strokeWidth) * across,
    );
  });
});

describe("an image's cached bitmap", () => {
  const image = (strokeWidth: number) =>
    API.createElement({
      type: "image",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      strokeWidth,
    });

  it("is not padded for a stroke, since an image draws none", () => {
    expect(cachedBitmap(image(40)).canvas.width).toBe(
      cachedBitmap(image(1)).canvas.width,
    );
  });
});

describe("an arrow's cached bitmap", () => {
  const arrow = (head: "start" | "end") =>
    API.createElement({
      type: "arrow",
      x: 0,
      y: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      startArrowhead: head === "start" ? "arrow" : null,
      endArrowhead: head === "end" ? "arrow" : null,
    });

  it("has the same room for a head at its start as at its end", () => {
    expect(cachedBitmap(arrow("start")).canvas.width).toBe(
      cachedBitmap(arrow("end")).canvas.width,
    );
  });
});
