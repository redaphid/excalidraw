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

it("keeps painting unclipped after an element in a frame fails to draw", () => {
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
    clipsAtDraw.push(
      (
        context as unknown as { __getClippingRegion: () => unknown[] }
      ).__getClippingRegion(),
    );
  });
  // the first element bitmap's context is refused, as WebKit does past its
  // canvas memory cap
  const createElement = document.createElement.bind(document);
  let refuse = true;
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const element = createElement(tag);
    if (tag === "canvas" && refuse) {
      refuse = false;
      (element as HTMLCanvasElement).getContext = () => null;
    }
    return element;
  }) as typeof document.createElement);
  vi.spyOn(console, "error").mockImplementation(() => {});

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

  expect(refuse).toBe(false);
  expect(console.error).toHaveBeenCalled();
  expect(clipsAtDraw).toEqual([[]]);
});
