import rough from "roughjs/bin/rough";

import {
  cancelSettledBitmaps,
  elementWithCanvasCache,
  renderElement,
  Scene,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";

const VIEW = 500;
const SHAPES = 60;
/** the bitmaps a frame builds whatever the clock says, past its 8 ms */
const BITMAPS_PER_FRAME = 24;
const MS_PER_BITMAP = 3;
const ZOOM_SETTLE_MS = 150;

let canvas: HTMLCanvasElement | null = null;
let idle: IdleRequestCallback[];
let now: number;
const renderers: Renderer[] = [];

beforeEach(() => {
  idle = [];
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idle.push(callback);
    return idle.length;
  });
  vi.stubGlobal("cancelIdleCallback", () => {});
  // a clock that moves only while a bitmap is built, or as the test says
  now = 1_000_000;
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
});

afterEach(() => {
  if (canvas) {
    cancelSettledBitmaps(canvas);
  }
  renderers.splice(0).forEach((renderer) => renderer.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** an 8x8 grid, less four, of solid rectangles inside a 500x500 view at 1x */
const denseView = () =>
  Array.from({ length: SHAPES }, (_, i) =>
    API.createElement({
      type: "rectangle",
      x: 10 + (i % 8) * 60,
      y: 10 + Math.floor(i / 8) * 60,
      width: 40,
      height: 40,
      fillStyle: "solid",
      backgroundColor: "#a5d8ff",
    }),
  );

/** paints the view once, and reports the bitmaps laid on the canvas and the
 * paths it filled directly */
const paint = (elements: NonDeletedExcalidrawElement[]) => {
  const scene = new Scene(elements, { skipValidation: true });
  const renderer = new Renderer(scene);
  renderers.push(renderer);
  const appState: AppState = {
    ...getDefaultAppState(),
    width: VIEW,
    height: VIEW,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
  };
  const { elementsMap, visibleElements } = renderer.getRenderableElements({
    ...appState,
    selectedElements: [],
  });
  canvas = document.createElement("canvas");
  canvas.width = canvas.height = VIEW;
  const context = canvas.getContext("2d")!;
  const drawImage = vi.spyOn(context, "drawImage");
  const fill = vi.spyOn(context, "fill");
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
  return {
    bitmapsDrawn: drawImage.mock.calls.length,
    pathsFilled: fill.mock.calls.length,
  };
};

const isBuilt = (element: NonDeletedExcalidrawElement) =>
  elementWithCanvasCache.get(element)?.zoomValue === 1;

/** past the zoom's settle delay, then every idle slice the build asks for */
const idleUntilDone = () => {
  now += ZOOM_SETTLE_MS;
  vi.runOnlyPendingTimers();
  for (let slices = 0; idle.length && slices < 100; slices++) {
    idle.shift()!({ didTimeout: false, timeRemaining: () => 50 });
  }
};

// The first full redraw of a dense view after a load used to build every
// bitmap it needed in one task: about 1,000 on a phone, a quarter second.
describe("a frame that needs more new bitmaps than it has time for", () => {
  let elements: NonDeletedExcalidrawElement[];
  let painted: ReturnType<typeof paint>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    elements = denseView();
    painted = paint(elements);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds no more bitmaps than its share once its time is spent", () => {
    expect(elements.filter(isBuilt)).toHaveLength(BITMAPS_PER_FRAME);
  });

  it("draws the rest straight onto the canvas", () => {
    expect(painted.pathsFilled).toBeGreaterThanOrEqual(
      SHAPES - painted.bitmapsDrawn,
    );
  });

  describe("when the browser is next idle", () => {
    beforeEach(() => {
      idleUntilDone();
    });

    it("builds the bitmaps the frame left out", () => {
      expect(elements.filter(isBuilt)).toHaveLength(SHAPES);
    });
  });
});

describe("an element a host renders outside a static frame", () => {
  let element: NonDeletedExcalidrawElement;

  beforeEach(() => {
    paint(denseView());
    element = denseView()[0];
    const scene = new Scene([element], { skipValidation: true });
    const renderer = new Renderer(scene);
    renderers.push(renderer);
    const appState = { ...getDefaultAppState(), width: VIEW, height: VIEW };
    const { elementsMap } = renderer.getRenderableElements({
      ...appState,
      offsetLeft: 0,
      offsetTop: 0,
      selectedElements: [],
    });
    const target = document.createElement("canvas");
    renderElement(
      element,
      elementsMap,
      scene.getNonDeletedElementsMap(),
      rough.canvas(target),
      target.getContext("2d")!,
      {
        imageCache: new Map(),
        renderGrid: false,
        isExporting: false,
        canvasBackgroundColor: "#fff",
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: "light",
      },
      appState as AppState,
    );
  });

  it("gets its bitmap, whatever the last frame spent", () => {
    expect(isBuilt(element)).toBe(true);
  });
});
