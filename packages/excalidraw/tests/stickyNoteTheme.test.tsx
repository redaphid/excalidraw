import rough from "roughjs/bin/rough";

import { elementWithCanvasCache, Scene } from "@excalidraw/element";

import type { ExcalidrawStickyNoteElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { CanvasTheme } from "../cssTheme";
import type { AppState } from "../types";

const PAPER = "#a5d8ff";

const note = () =>
  API.createElement({
    type: "stickynote",
    x: 10,
    y: 10,
    width: 200,
    height: 200,
    backgroundColor: PAPER,
  }) as ExcalidrawStickyNoteElement;

/** the fill and stroke styles in effect at each fill and stroke, in order */
const draw = (
  element: ExcalidrawStickyNoteElement,
  canvasTheme: CanvasTheme | undefined,
  { isExporting = true } = {},
) => {
  const fills: string[] = [];
  const shadows: { color: string; blur: number }[] = [];
  const strokes: { style: string; width: number }[] = [];
  vi.spyOn(CanvasRenderingContext2D.prototype, "fill").mockImplementation(
    function (this: CanvasRenderingContext2D) {
      fills.push(String(this.fillStyle));
      if (this.shadowBlur) {
        shadows.push({ color: this.shadowColor, blur: this.shadowBlur });
      }
    },
  );
  vi.spyOn(CanvasRenderingContext2D.prototype, "stroke").mockImplementation(
    function (this: CanvasRenderingContext2D) {
      strokes.push({ style: String(this.strokeStyle), width: this.lineWidth });
    },
  );

  const scene = new Scene([element], { skipValidation: true });
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
      isExporting,
      canvasBackgroundColor: "#fff",
      embedsValidationStatus: new Map(),
      elementsPendingErasure: new Set(),
      pendingFlowchartNodes: null,
      theme: "light",
      canvasTheme,
    },
  });
  vi.restoreAllMocks();
  return { fills, shadows, strokes };
};

describe("sticky note chrome from the canvas theme", () => {
  it("draws the built-in shadow and edge without a theme", () => {
    const { fills, strokes } = draw(note(), undefined);
    expect(fills).toEqual(["rgba(0, 0, 0, 0.16)", PAPER]);
    expect(strokes).toEqual([{ style: "rgba(0, 0, 0, 0.08)", width: 1 }]);
  });

  it("draws no shadow and no edge for a theme's none", () => {
    const { fills, strokes } = draw(note(), {
      stickyNoteShadowX: 0,
      stickyNoteShadowY: 0,
      stickyNoteShadowColor: "transparent",
      stickyNoteEdgeWidth: 0,
      stickyNoteEdgeColor: "transparent",
    });
    expect(fills).toEqual([PAPER]);
    expect(strokes).toEqual([]);
  });

  it("draws the theme's shadow and edge colors, undimmed", () => {
    const { fills, strokes } = draw(note(), {
      stickyNoteShadowX: 5,
      stickyNoteShadowY: 5,
      stickyNoteShadowColor: "#111111",
      stickyNoteEdgeWidth: 2,
      stickyNoteEdgeColor: "#222222",
    });
    expect(fills).toEqual(["#111111", PAPER]);
    expect(strokes).toEqual([{ style: "#222222", width: 4 }]);
  });

  it("blurs a theme's shadow in device pixels and nothing else", () => {
    const { fills, shadows } = draw(note(), {
      stickyNoteShadowX: 6,
      stickyNoteShadowY: 8,
      stickyNoteShadowBlur: 10,
      stickyNoteShadowColor: "rgba(80, 58, 28, 0.2)",
    });
    expect(shadows).toEqual([{ color: "rgba(80, 58, 28, 0.2)", blur: 10 }]);
    expect(fills.slice(1)).toEqual([PAPER]);
  });

  it("draws no blur without a theme", () => {
    expect(draw(note(), undefined).shadows).toEqual([]);
  });

  it("redraws a note's cached bitmap when the canvas theme changes", () => {
    const element = note();
    const hard: CanvasTheme = {
      stickyNoteShadowX: 5,
      stickyNoteShadowY: 5,
      stickyNoteShadowColor: "#111111",
    };
    const first = draw(element, hard, { isExporting: false });
    expect(first.fills[0]).toBe("#111111");
    const bitmap = elementWithCanvasCache.get(element);
    expect(bitmap).toBeDefined();

    expect(draw(element, hard, { isExporting: false }).fills).toEqual([]);
    expect(elementWithCanvasCache.get(element)).toBe(bitmap);

    const next = draw(
      element,
      { ...hard, stickyNoteShadowColor: "#333333" },
      { isExporting: false },
    );
    expect(next.fills[0]).toBe("#333333");
    expect(elementWithCanvasCache.get(element)).not.toBe(bitmap);
  });
});
