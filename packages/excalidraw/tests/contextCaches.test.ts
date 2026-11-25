import rough from "roughjs/bin/rough";

import { Scene } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { forgetContextCaches } from "../renderer/contextCaches";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";

const VIEW = 500;

const renderers: Renderer[] = [];

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.destroy());
  vi.restoreAllMocks();
});

/** paints the view once, and reports the canvases laid on it */
const canvasesDrawn = (elements: NonDeletedExcalidrawElement[]) => {
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
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = VIEW;
  const drawImage = vi.spyOn(canvas.getContext("2d")!, "drawImage");
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
  return drawImage.mock.calls
    .map(([source]) => source)
    .filter((source) => source instanceof HTMLCanvasElement);
};

// a lost context (a GPU process crash, say) blanks every canvas cached from
// one, so none drawn before it may be drawn after
describe("a linked card painted before the context caches are dropped", () => {
  let card: NonDeletedExcalidrawElement;
  let before: unknown[];
  let after: unknown[];

  beforeEach(() => {
    card = {
      ...API.createElement({
        type: "rectangle",
        id: "rect-linked-marmot",
        x: 100,
        y: 100,
        width: 240,
        height: 150,
      }),
      link: "https://example.com/marmot",
    };
    before = canvasesDrawn([card]);
    forgetContextCaches([card]);
    after = canvasesDrawn([card]);
  });

  it("is painted again from none of the canvases cached before", () => {
    expect({
      drawnBefore: before.length > 0,
      drawnAfter: after.length > 0,
      reused: after.filter((source) => before.includes(source)).length,
    }).toEqual({ drawnBefore: true, drawnAfter: true, reused: 0 });
  });
});
