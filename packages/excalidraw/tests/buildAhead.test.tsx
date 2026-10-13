import rough from "roughjs/bin/rough";

import {
  cancelSettledBitmaps,
  elementWithCanvasCache,
  Scene,
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
/** how far past each edge elements are built ahead: half a view */
const AHEAD = VIEW / 2;
const SHAPE_SIZE = 40;
const NEAR_GAP = AHEAD / 2;
const NEAR_X = VIEW + NEAR_GAP;
const FAR_X = VIEW + AHEAD * 4;
const LONG_TASK_MS = 50;
/** the most time an idle slice spends starting builds */
const SLICE_MS = 8;
const MS_PER_BITMAP = 3;
const ZOOM_SETTLE_AND_BUILD_MS = 400;

let lastCanvas: HTMLCanvasElement | null = null;

beforeEach(() => {
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 })),
  );
  vi.stubGlobal("cancelIdleCallback", (id: number) => clearTimeout(id));
});

afterEach(() => {
  if (lastCanvas) {
    cancelSettledBitmaps(lastCanvas);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const board = (elements: NonDeletedExcalidrawElement[]) => {
  const scene = new Scene(elements, { skipValidation: true });
  return { scene, renderer: new Renderer(scene) };
};

/** paints a 500x500 view of the board at 1x scrolled to `scrollX`, and
 * reports the canvases the paint created and the paths it filled */
const paint = ({ scene, renderer }: ReturnType<typeof board>, scrollX = 0) => {
  const appState: AppState = {
    ...getDefaultAppState(),
    width: VIEW,
    height: VIEW,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX,
    scrollY: 0,
  };
  const { elementsMap, visibleElements } = renderer.getRenderableElements({
    ...appState,
    selectedElements: [],
  });
  const canvas = document.createElement("canvas");
  lastCanvas = canvas;
  canvas.width = canvas.height = VIEW;
  const fill = vi.spyOn(canvas.getContext("2d")!, "fill");
  const createElement = vi.spyOn(document, "createElement");
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
  const canvasesCreated = createElement.mock.calls.filter(
    ([tag]) => tag === "canvas",
  ).length;
  createElement.mockRestore();
  return { canvasesCreated, pathsFilled: fill.mock.calls.length };
};

const settle = () =>
  new Promise((resolve) => setTimeout(resolve, ZOOM_SETTLE_AND_BUILD_MS));

const rectangleAt = (x: number, size = SHAPE_SIZE) =>
  API.createElement({
    type: "rectangle",
    x,
    y: 100,
    width: size,
    height: size,
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

const isBuilt = (element: NonDeletedExcalidrawElement) =>
  elementWithCanvasCache.get(element)?.zoomValue === 1;

const hasShape = (element: NonDeletedExcalidrawElement) =>
  ShapeCache.get(element, null) !== undefined;

describe("elements just outside the view, once the view holds still", () => {
  it("get their shapes and bitmaps built", async () => {
    const shape = rectangleAt(NEAR_X);
    const stroke = strokeAt(NEAR_X + 60);
    paint(board([rectangleAt(10), shape, stroke]));
    expect(hasShape(shape)).toBe(false);
    await settle();
    expect([hasShape(shape), hasShape(stroke)]).toEqual([true, true]);
    expect([isBuilt(shape), isBuilt(stroke)]).toEqual([true, true]);
  });

  it("are drawn from those bitmaps on the frame they enter the view", async () => {
    const view = board([
      rectangleAt(10),
      rectangleAt(NEAR_X),
      strokeAt(NEAR_X + 60),
    ]);
    paint(view);
    await settle();
    expect(paint(view, -NEAR_X + 10)).toEqual({
      canvasesCreated: 0,
      pathsFilled: 0,
    });
  });

  it("leave elements far from the view unbuilt", async () => {
    const far = [rectangleAt(FAR_X), strokeAt(FAR_X + 60)];
    paint(board([rectangleAt(10), rectangleAt(NEAR_X), ...far]));
    await settle();
    expect(far.map(hasShape)).toEqual([false, false]);
    expect(far.map((el) => elementWithCanvasCache.get(el))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("get a shape but no bitmap when the bitmap would be bigger than the screen", async () => {
    const big = rectangleAt(NEAR_X, VIEW * 1.2);
    paint(board([rectangleAt(10), big]));
    await settle();
    expect(hasShape(big)).toBe(true);
    expect(elementWithCanvasCache.get(big)).toBeUndefined();
  });

  it("are the ones near the latest view when the view moves first", async () => {
    const nearFirst = rectangleAt(NEAR_X);
    const nearLatest = rectangleAt(-FAR_X);
    const view = board([rectangleAt(10), nearFirst, nearLatest]);
    paint(view);
    // the view moves far left, leaving `nearLatest` as far past its left edge
    // as `nearFirst` was past the first view's right edge
    paint(view, FAR_X - SHAPE_SIZE - NEAR_GAP);
    await settle();
    expect([isBuilt(nearFirst), isBuilt(nearLatest)]).toEqual([false, true]);
  });

  it("still get built after the browser refuses one of their canvases", async () => {
    const near = [rectangleAt(NEAR_X), rectangleAt(NEAR_X + 60)];
    const view = board([rectangleAt(10), ...near]);
    paint(view);
    // the first bitmap built in idle time has its context refused, as WebKit
    // does past its canvas memory cap
    let refuse = true;
    const createElement = document.createElement.bind(document);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        const element = createElement(tag, options);
        if (tag === "canvas" && refuse) {
          refuse = false;
          (element as HTMLCanvasElement).getContext = () => null;
        }
        return element;
      },
    );
    await settle();
    expect(refuse).toBe(false);
    paint(view, -1);
    await settle();
    expect(near.map(isBuilt)).toEqual([true, true]);
  });

  it("are not built where the browser has no idle callbacks", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const near = rectangleAt(NEAR_X);
    const visibleStroke = strokeAt(10);
    paint(board([visibleStroke, near]));
    await settle();
    expect(hasShape(near)).toBe(false);
    expect(isBuilt(visibleStroke)).toBe(true);
  });
});

describe("idle slices building elements near the view", () => {
  let idle: IdleRequestCallback[];
  let now: number;

  beforeEach(() => {
    idle = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idle.push(callback);
      return idle.length;
    });
    vi.stubGlobal("cancelIdleCallback", () => {});
  });

  /** an idle period of `ms` on a clock that moves only as the test says */
  const period = (ms: number, tick = 0): IdleDeadline => {
    const end = now + ms;
    return {
      didTimeout: false,
      timeRemaining: () => {
        now += tick;
        return Math.max(0, end - now);
      },
    };
  };

  const freezeClock = () => {
    now = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  };

  /** a board with 30 elements near the view, past the zoom's settle delay,
   * on a clock that moves only while a bitmap is built */
  const nearBoardBuilding = async () => {
    const near = Array.from({ length: 30 }, (_, i) =>
      rectangleAt(VIEW + 10 + i * 5),
    );
    paint(board([rectangleAt(10), ...near]));
    await settle();
    expect(idle).toHaveLength(1);
    freezeClock();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "canvas") {
          now += MS_PER_BITMAP;
        }
        return createElement(tag, options);
      },
    );
    return near;
  };

  it("stop starting builds after 8 ms of a whole idle period", async () => {
    const near = await nearBoardBuilding();
    const sliceStart = now;
    idle.shift()!(period(LONG_TASK_MS));
    expect(now - sliceStart).toBeLessThan(SLICE_MS + MS_PER_BITMAP);
    expect(near.filter(isBuilt).length).toBeGreaterThan(0);
    expect(near.filter(isBuilt).length).toBeLessThan(near.length);

    while (idle.length) {
      idle.shift()!(period(LONG_TASK_MS));
    }
    expect(near.filter(isBuilt)).toHaveLength(near.length);
  });

  it("end with the idle period when it is shorter than 8 ms", async () => {
    await nearBoardBuilding();
    const betweenFrames = 5;
    const sliceStart = now;
    idle.shift()!(period(betweenFrames));
    expect(now - sliceStart).toBeLessThan(betweenFrames + MS_PER_BITMAP);
  });

  it("reach the end of a big board while a pan re-arms the build every frame", async () => {
    const far = Array.from({ length: 400 }, (_, i) =>
      rectangleAt(FAR_X + (i % 20) * 60),
    );
    const last = rectangleAt(NEAR_X);
    const view = board([rectangleAt(10), ...far, last]);
    paint(view);
    await settle();

    // each check of the clock costs 0.1 ms, so one 10 ms idle period checks
    // a few dozen elements
    freezeClock();
    for (let frame = 0; frame < 30 && !isBuilt(last); frame++) {
      paint(view, -(frame % 2));
      idle.shift()?.(period(10, 0.1));
    }
    expect(isBuilt(last)).toBe(true);
  });
});
