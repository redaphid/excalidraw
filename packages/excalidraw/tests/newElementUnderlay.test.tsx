import rough from "roughjs/bin/rough";

import {
  elementWithCanvasCache,
  mutateElement,
  Scene,
} from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { StaticCanvasRenderConfig } from "../scene/types";
import type { AppState } from "../types";

const SIZE = 500;

const board = () => {
  const frame = API.createElement({
    type: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 400,
  });
  const below = API.createElement({
    type: "rectangle",
    x: 20,
    y: 20,
    width: 100,
    height: 100,
    frameId: frame.id,
  });
  const stroke = API.createElement({
    type: "freedraw",
    x: 50,
    y: 50,
    frameId: frame.id,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(30, 10)],
  });
  const scene = new Scene([below, stroke, frame], { skipValidation: true });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  const drawImage = vi.spyOn(context, "drawImage");
  const renderer = new Renderer(scene);
  const baseState: AppState = {
    ...getDefaultAppState(),
    width: SIZE,
    height: SIZE,
    offsetLeft: 0,
    offsetTop: 0,
  };
  const baseConfig: StaticCanvasRenderConfig = {
    imageCache: new Map(),
    renderGrid: false,
    isExporting: false,
    canvasBackgroundColor: "#fff",
    embedsValidationStatus: new Map(),
    elementsPendingErasure: new Set(),
    pendingFlowchartNodes: null,
    theme: "light",
    sceneNonce: 1,
  };

  const paint = ({
    newElement = stroke,
    state = {},
    config = {},
  }: {
    newElement?: NonDeletedExcalidrawElement | null;
    state?: Partial<AppState>;
    config?: Partial<StaticCanvasRenderConfig>;
  } = {}) => {
    drawImage.mockClear();
    const appState: AppState = {
      ...baseState,
      newElement: newElement as AppState["newElement"],
      ...state,
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
      renderConfig: { ...baseConfig, ...config },
    });
    const sources = drawImage.mock.calls.map(([source]) => source);
    return {
      copiedUnderlay: sources.some(
        (source) =>
          (source as HTMLCanvasElement).width === SIZE &&
          (source as HTMLCanvasElement).height === SIZE,
      ),
      paintedBelow: sources.includes(elementWithCanvasCache.get(below)!.canvas),
    };
  };

  return { below, stroke, paint };
};

describe("the layer under a new element drawn inside a frame", () => {
  it("is copied back instead of repainted once a move repeats the frame", () => {
    const { paint } = board();
    expect(paint()).toEqual({ copiedUnderlay: false, paintedBelow: true });
    expect(paint()).toEqual({ copiedUnderlay: false, paintedBelow: true });
    expect(paint()).toEqual({ copiedUnderlay: true, paintedBelow: false });
    expect(paint()).toEqual({ copiedUnderlay: true, paintedBelow: false });
  });

  it("is repainted when the scene changes, as when an image or font loads", () => {
    const { paint } = board();
    paint();
    paint();
    expect(paint({ config: { sceneNonce: 2 } })).toEqual({
      copiedUnderlay: false,
      paintedBelow: true,
    });
  });

  it("is repainted when an element under the new element changes", () => {
    const { below, paint } = board();
    paint();
    paint();
    mutateElement(below, new Map(), { strokeColor: "#e03131" });
    expect(paint().paintedBelow).toBe(true);
  });

  it("is repainted when the view moves", () => {
    const { paint } = board();
    paint();
    paint();
    expect(paint({ state: { scrollX: 10 } })).toEqual({
      copiedUnderlay: false,
      paintedBelow: true,
    });
  });

  it("is never copied while the frame differs on every move", () => {
    const { paint } = board();
    for (let move = 0; move < 4; move++) {
      expect(paint({ state: { scrollX: move } }).copiedUnderlay).toBe(false);
    }
  });

  it("is dropped once the new element is done", () => {
    const { paint } = board();
    paint();
    paint();
    expect(paint().copiedUnderlay).toBe(true);
    paint({ newElement: null });
    expect(paint()).toEqual({ copiedUnderlay: false, paintedBelow: true });
  });
});
