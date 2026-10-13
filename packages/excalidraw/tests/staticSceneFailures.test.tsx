import rough from "roughjs/bin/rough";

import { Scene } from "@excalidraw/element";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Paints a rectangle that crosses a frame's edge, then one outside any
 * frame, and returns the clipping region at each blit. `blit` runs first at
 * every blit and may throw; `beforePaint` runs once the scene's canvas
 * exists, just before painting.
 */
const paintFramedThenOutside = ({
  blit = () => {},
  beforePaint = () => {},
}: {
  blit?: () => void;
  beforePaint?: () => void;
}) => {
  const frame = API.createElement({
    type: "frame",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
  const failing = API.createElement({
    type: "rectangle",
    x: 150,
    y: 50,
    width: 100,
    height: 50,
    frameId: frame.id,
  });
  const after = API.createElement({
    type: "rectangle",
    x: 300,
    y: 300,
    width: 50,
    height: 50,
  });
  const scene = new Scene([failing, frame, after], { skipValidation: true });
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 500,
    height: 500,
    offsetLeft: 0,
    offsetTop: 0,
  };
  const { elementsMap, visibleElements } = new Renderer(
    scene,
  ).getRenderableElements({ ...appState, selectedElements: [] });

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 500;
  const context = canvas.getContext("2d")!;
  const clipsAtDraw: unknown[][] = [];
  vi.spyOn(context, "drawImage").mockImplementation(() => {
    blit();
    clipsAtDraw.push(
      (
        context as unknown as { __getClippingRegion: () => unknown[] }
      ).__getClippingRegion(),
    );
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  beforePaint();

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

  return clipsAtDraw;
};

it("keeps painting unclipped after an element in a frame fails to draw", () => {
  let refuse = true;
  const clipsAtDraw = paintFramedThenOutside({
    // the first element bitmap's context is refused, as WebKit does past its
    // canvas memory cap
    beforePaint: () => {
      const createElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
        const element = createElement(tag);
        if (tag === "canvas" && refuse) {
          refuse = false;
          (element as HTMLCanvasElement).getContext = () => null;
        }
        return element;
      }) as typeof document.createElement);
    },
  });

  expect(refuse).toBe(false);
  expect(console.error).toHaveBeenCalled();
  expect(clipsAtDraw).toEqual([[]]);
});

it("keeps painting unclipped after an element in a frame throws mid-blit", () => {
  // the first blit throws, as drawImage does for a zero-sized bitmap
  let thrown = false;
  const clipsAtDraw = paintFramedThenOutside({
    blit: () => {
      if (!thrown) {
        thrown = true;
        throw new DOMException("zero-sized bitmap", "InvalidStateError");
      }
    },
  });

  expect(thrown).toBe(true);
  expect(console.error).toHaveBeenCalled();
  expect(clipsAtDraw).toEqual([[]]);
});
