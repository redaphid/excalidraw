import rough from "roughjs/bin/rough";

import { cancelSettledBitmaps, Scene } from "@excalidraw/element";

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

let canvas: HTMLCanvasElement;
let context: CanvasRenderingContext2D;
let frames: FrameRequestCallback[];
let now: number;
let painted: number;
const renderers: Renderer[] = [];

beforeEach(() => {
  frames = [];
  painted = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("requestIdleCallback", () => 0);
  vi.stubGlobal("cancelIdleCallback", () => {});
  // a clock that moves only while a bitmap is built or a path is filled
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
  canvas = createElement("canvas");
  canvas.width = canvas.height = VIEW;
  context = canvas.getContext("2d")!;
  vi.spyOn(context, "fill").mockImplementation(() => {
    now += 1;
  });
  vi.spyOn(context, "drawImage");
  vi.spyOn(context, "clearRect");
});

afterEach(() => {
  cancelSettledBitmaps(canvas);
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

/** paints the view as a static frame of the editor */
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
    onPainted: () => {
      painted++;
    },
  });
};

/** every animation frame the paint asks for, as the browser would run them */
const runFrames = () => {
  for (let n = 0; frames.length && n < 100; n++) {
    frames.shift()!(now);
  }
};

const laid = () => vi.mocked(context.drawImage).mock.calls.length;

// The first redraw after a zoom-out drew every element without a bitmap
// straight onto the canvas in one task: about half a second on a dense board.
describe("a frame that runs out of time with elements left to paint", () => {
  beforeEach(() => {
    paint(denseView());
  });

  it("draws nothing straight onto the canvas once its time is spent", () => {
    expect(context.fill).not.toHaveBeenCalled();
  });

  it("does not report the scene painted", () => {
    expect(painted).toBe(0);
  });

  describe("when the next frames run", () => {
    beforeEach(() => {
      vi.mocked(context.clearRect).mockClear();
      runFrames();
    });

    it("paints every element", () => {
      expect(laid()).toBe(SHAPES);
    });

    it("paints over what it painted, without clearing it", () => {
      expect(context.clearRect).not.toHaveBeenCalled();
    });

    it("reports the scene painted once", () => {
      expect(painted).toBe(1);
    });
  });
});

describe("a second paint at the same zoom before the rest is painted", () => {
  beforeEach(() => {
    const elements = denseView();
    paint(elements);
    vi.mocked(context.fill).mockClear();
    vi.mocked(context.drawImage).mockClear();
    paint(elements);
  });

  it("draws nothing straight onto the canvas", () => {
    expect(context.fill).not.toHaveBeenCalled();
  });

  it("paints further than the first", () => {
    expect(laid()).toBe(2 * BITMAPS_PER_FRAME);
  });
});

describe("paints that keep coming before the rest is painted", () => {
  beforeEach(() => {
    const elements = denseView();
    paint(elements);
    paint(elements);
    paint(elements);
  });

  it("each paint further than the last, until one paints the whole scene", () => {
    expect(painted).toBe(1);
  });
});
