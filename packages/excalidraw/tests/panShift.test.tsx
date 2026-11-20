import rough from "roughjs/bin/rough";

import { cancelSettledBitmaps, Scene } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene, uncoveredStrips } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { StaticCanvasRenderConfig } from "../scene/types";
import type { AppState } from "../types";

const VIEW = 500;

let canvas: HTMLCanvasElement;
let renderer: Renderer;
let scene: Scene;

const renderConfig: StaticCanvasRenderConfig = {
  imageCache: new Map(),
  renderGrid: false,
  isExporting: false,
  canvasBackgroundColor: "#fff",
  embedsValidationStatus: new Map(),
  elementsPendingErasure: new Set(),
  pendingFlowchartNodes: null,
  theme: "light",
};

/** a shape at each side of the view */
const sides = () => [
  API.createElement({
    type: "rectangle",
    x: 10,
    y: 200,
    width: 40,
    height: 40,
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
  }),
  API.createElement({
    type: "rectangle",
    x: 480,
    y: 200,
    width: 40,
    height: 40,
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
  }),
];

/** the editor's state between paints: a pan changes only the scroll */
let base: AppState;

const paint = (view: Partial<AppState>, sceneNonce = "scene") => {
  const appState: AppState = { ...base, ...view };
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
    renderConfig,
    sceneNonce,
  });
};

/** the images drawn onto the canvas that are not the canvas itself: one for
 * each element drawn from its bitmap */
const elementsDrawn = (drawImage: { mock: { calls: unknown[][] } }) =>
  drawImage.mock.calls.filter(([source]) => source !== canvas).length;

describe("a pan of the static canvas", () => {
  let elements: NonDeletedExcalidrawElement[];
  let drawImage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    elements = sides();
    scene = new Scene(elements, { skipValidation: true });
    renderer = new Renderer(scene);
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = VIEW;
    base = {
      ...getDefaultAppState(),
      width: VIEW,
      height: VIEW,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
    };
    paint({ scrollX: 0 });
    drawImage = vi.spyOn(canvas.getContext("2d")!, "drawImage");
    // the canvas mock's own spy keeps the first paint's calls
    drawImage.mockClear();
  });

  afterEach(() => {
    cancelSettledBitmaps(canvas);
    renderer.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("when the scene moves left by whole pixels", () => {
    beforeEach(() => {
      paint({ scrollX: -30 });
    });

    it("moves what is already painted, by the pan", () => {
      expect(drawImage).toHaveBeenCalledWith(canvas, -30, 0);
    });

    it("draws only the element the pan uncovers", () => {
      expect(elementsDrawn(drawImage)).toBe(1);
    });
  });

  describe("when the scene changes as it moves", () => {
    beforeEach(() => {
      paint({ scrollX: -30 }, "changed");
    });

    it("paints the whole view again", () => {
      expect(drawImage).not.toHaveBeenCalledWith(canvas, -30, 0);
    });
  });

  describe("when the zoom changes", () => {
    beforeEach(() => {
      paint({
        scrollX: -30,
        zoom: { value: 0.5 as AppState["zoom"]["value"] },
      });
    });

    it("paints the whole view again", () => {
      expect(drawImage).not.toHaveBeenCalledWith(canvas, -30, 0);
    });
  });

  describe("when the scene moves by more than the view", () => {
    beforeEach(() => {
      paint({ scrollX: -VIEW });
    });

    it("paints the whole view again", () => {
      expect(drawImage).not.toHaveBeenCalledWith(canvas, -VIEW, 0);
    });
  });
});

describe("the strips a pan uncovers", () => {
  it("is a column on the right when the scene moves left", () => {
    expect(uncoveredStrips(500, 400, { dx: -30, dy: 0 })).toEqual([
      { x: 470, y: 0, width: 30, height: 400 },
    ]);
  });

  it("is a row on top and the rest of a column when it moves down and right", () => {
    expect(uncoveredStrips(500, 400, { dx: 10, dy: 20 })).toEqual([
      { x: 0, y: 0, width: 500, height: 20 },
      { x: 0, y: 20, width: 10, height: 380 },
    ]);
  });
});
