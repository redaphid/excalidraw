import rough from "roughjs/bin/rough";

import { Scene } from "@excalidraw/element";

import { getDefaultAppState } from "../appState";
import { renderStaticScene } from "../renderer/staticScene";
import { Renderer } from "../scene/Renderer";

import type { AppState, NormalizedZoomValue } from "../types";

type Stroke = {
  from: [number, number];
  to: [number, number];
  lineWidth: number;
  strokeStyle: string;
  dash: number[];
  alpha: number;
};

/** every grid line stroked over a 1000 by 600 px screen */
const gridStrokes = ({
  zoom,
  gridSize = 20,
  gridStep = 5,
  scrollX = 0,
  scrollY = 0,
  scale = 1,
}: {
  zoom: number;
  gridSize?: number;
  gridStep?: number;
  scrollX?: number;
  scrollY?: number;
  scale?: number;
}) => {
  const scene = new Scene([], { skipValidation: true });
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 1000,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    gridSize,
    gridStep,
    gridModeEnabled: true,
    scrollX,
    scrollY,
    zoom: { value: zoom as NormalizedZoomValue },
  };
  const { elementsMap, visibleElements } = new Renderer(
    scene,
  ).getRenderableElements({ ...appState, selectedElements: [] });
  const canvas = document.createElement("canvas");
  canvas.width = 1000 * scale;
  canvas.height = 600 * scale;
  const context = canvas.getContext("2d")!;
  const strokes: Stroke[] = [];
  let line: Partial<Stroke> = {};
  // plain overrides, not spies: a sweep renders hundreds of frames
  context.moveTo = (x, y) => {
    line.from = [x, y];
  };
  context.lineTo = (x, y) => {
    line.to = [x, y];
  };
  context.stroke = () => {
    strokes.push({
      ...(line as Stroke),
      lineWidth: context.lineWidth,
      strokeStyle: String(context.strokeStyle),
      dash: context.getLineDash(),
      alpha: context.globalAlpha,
    });
    line = {};
  };
  renderStaticScene({
    canvas,
    rc: rough.canvas(canvas),
    scale,
    elementsMap,
    allElementsMap: scene.getNonDeletedElementsMap(),
    visibleElements,
    appState,
    renderConfig: {
      imageCache: new Map(),
      renderGrid: true,
      isExporting: false,
      canvasBackgroundColor: "#fff",
      embedsValidationStatus: new Map(),
      elementsPendingErasure: new Set(),
      pendingFlowchartNodes: null,
      theme: "light",
    },
  });
  return strokes;
};

/** FNV-1a over the strokes, to compare a frame against master's */
const digest = (strokes: Stroke[]) => {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(strokes)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `${strokes.length}:${hash.toString(16)}`;
};

/** the grid's ink on screen: each line's width in px times its opacity */
const ink = (zoom: number, gridSize = 20, gridStep = 5) =>
  gridStrokes({ zoom, gridSize, gridStep })
    .filter(({ from: [x, y], to: [x2] }) => {
      // strokes are in scene units from the screen's corner
      const vertical = x === x2;
      const at = (vertical ? x : y) * zoom;
      return at >= 0 && at <= (vertical ? 1000 : 600);
    })
    .reduce((sum, stroke) => sum + stroke.lineWidth * zoom * stroke.alpha, 0);

/** log-spaced zooms over [from, to] */
const sweep = (from: number, to: number, count: number) =>
  Array.from(
    { length: count },
    (_, i) => from * (to / from) ** (i / (count - 1)),
  );

/** the frames compared with master's, one digest per grid size and step */
const MASTER_ZOOMS = [0.1, 0.137, 0.5, 1, 3.3, 30];
const masterFrames = (gridSize: number, gridStep: number) =>
  digest(
    [
      ...MASTER_ZOOMS.map((zoom) => ({ zoom })),
      { zoom: 0.1, scrollX: 12_345.6, scrollY: -789.1 },
      { zoom: 0.73, scale: 2 },
      { zoom: 0.1, scale: 3 },
    ].flatMap((frame) => gridStrokes({ ...frame, gridSize, gridStep })),
  );

// master's strokes, recorded by running masterFrames against master's
// renderer/staticScene.ts (master's MIN_ZOOM is 0.1)
const MASTER: Record<string, string> = {
  "1/1": "58:29706a5",
  "1/2": "33653:22b3ad38",
  "1/5": "13504:dd029e40",
  "1/10": "6789:121dbefa",
  "7/1": "86:8db902ab",
  "7/2": "4863:a1332e83",
  "7/5": "2000:e0682112",
  "7/10": "1044:6fb53573",
  "20/1": "400:59b77ee2",
  "20/2": "1899:b3f4e8c4",
  "20/5": "1002:2a6b2b92",
  "20/10": "703:a381e421",
  "100/1": "712:b56f2695",
  "100/2": "712:3496fbb1",
  "100/5": "712:d960f325",
  "100/10": "712:931a8623",
  "1000/1": "110:10b673d",
  "1000/2": "110:38e418eb",
  "1000/5": "110:30c74ae1",
  "1000/10": "110:edc0dc2d",
};

describe("the grid at upstream's zooms", () => {
  it.each(Object.keys(MASTER))(
    "strokes exactly master's lines with grid size/step %s",
    (key) => {
      const [gridSize, gridStep] = key.split("/").map(Number);
      expect(masterFrames(gridSize, gridStep)).toBe(MASTER[key]);
    },
  );
});

describe("the grid zoomed out past 10%", () => {
  // (grid size 1 draws thousands of lines a frame, too slow to sweep; its
  // frames at 10% and over are compared with master's above)
  const GRIDS = [
    [20, 5],
    [7, 2],
    [100, 5],
    [1000, 10],
    [20, 1],
  ];
  // log-spaced, plus each step's boundary, where a grid would pop
  const zoomsFor = (gridStep: number) => {
    const base = Math.max(gridStep, 2);
    return [
      ...sweep(1e-6, 0.1, 150),
      ...Array.from({ length: 30 }, (_, k) => 0.1 / base ** k).filter(
        (zoom) => zoom >= 1e-6,
      ),
    ];
  };

  it.each(GRIDS)(
    "never pops: ink changes by under one bold line between nearby zooms, grid %s step %s",
    (gridSize, gridStep) => {
      // a bold line at upstream's 10% is 0.4 px wide; a line can still
      // enter or leave at the screen's edge
      const pops = zoomsFor(gridStep)
        .map((zoom) => ({
          zoom,
          change: Math.abs(
            ink(zoom, gridSize, gridStep) -
              ink(zoom * (1 - 1e-6), gridSize, gridStep),
          ),
        }))
        .filter(({ change }) => change > 0.4);
      expect(pops).toEqual([]);
    },
  );

  it.each(GRIDS)(
    "looks the same a whole step further out, grid %s step %s",
    (gridSize, gridStep) => {
      const base = Math.max(gridStep, 2);
      const differ = sweep(1e-5, 0.1 / base, 60)
        .map((zoom) => ({
          zoom,
          near: ink(zoom * base, gridSize, gridStep),
          far: ink(zoom, gridSize, gridStep),
        }))
        .filter(({ near, far }) => Math.abs(near - far) > 0.4 + near * 0.02);
      expect(differ).toEqual([]);
    },
  );

  it.each(GRIDS)(
    "strokes at most a step's worth more lines than at 10%%, grid %s step %s",
    (gridSize, gridStep) => {
      const base = Math.max(gridStep, 2);
      const atTenth = gridStrokes({ zoom: 0.1, gridSize, gridStep }).length;
      const most = Math.max(
        ...zoomsFor(gridStep).map(
          (zoom) => gridStrokes({ zoom, gridSize, gridStep }).length,
        ),
      );
      expect(most).toBeLessThanOrEqual((atTenth + 8) * (base + 1));
    },
  );
});
