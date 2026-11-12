import {
  elementsOverlappingBBox,
  getCommonBounds,
  getNonDeletedElements,
} from "@excalidraw/element";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { exportToCanvas } from "@excalidraw/utils";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { SCENES } from "../../playground/bench/scenes";

import type { SceneName } from "../../playground/bench/scenes";

/**
 * Exports a large scene tile by tile through the public `exportToCanvas`, the
 * way draw paints its board view, twice over: the first pass loads fonts, the
 * second is the steady state the editor spends its time in. Each pass counts
 * `document.fonts.check` calls and the time spent inside them.
 */

type PassReport = {
  tiles: number;
  exportMs: number;
  checkCalls: number;
  checkMs: number;
  checkChars: number;
  loadCalls: number;
};

export type ExportTilesReport = {
  scene: string;
  elements: number;
  textElements: number;
  tileScene: number;
  scale: number;
  passes: PassReport[];
};

declare global {
  interface Window {
    benchReport?: ExportTilesReport;
    benchError?: string;
    profilerHook?: (id: string, phase: "start" | "stop") => Promise<void>;
  }
}

const params = new URLSearchParams(window.location.search);
const sceneName = params.get("scene") ?? "labels";
const tileScene = Number(params.get("tile") ?? 1024);
const scale = Number(params.get("scale") ?? 0.5);
const passCount = Number(params.get("passes") ?? 2);
const status = document.getElementById("status")!;

const counters = { checkCalls: 0, checkMs: 0, checkChars: 0, loadCalls: 0 };
const fonts = document.fonts;
const originalCheck = fonts.check.bind(fonts);
const originalLoad = fonts.load.bind(fonts);
fonts.check = (font: string, text?: string) => {
  const start = performance.now();
  const result = originalCheck(font, text);
  counters.checkMs += performance.now() - start;
  counters.checkCalls += 1;
  counters.checkChars += text?.length ?? 0;
  return result;
};
fonts.load = (font: string, text?: string) => {
  counters.loadCalls += 1;
  return originalLoad(font, text);
};
const takeCounters = () => {
  const taken = { ...counters };
  counters.checkCalls = 0;
  counters.checkMs = 0;
  counters.checkChars = 0;
  counters.loadCalls = 0;
  return taken;
};

const loadScene = async (): Promise<{
  elements: readonly NonDeletedExcalidrawElement[];
  files: BinaryFiles;
}> => {
  if (sceneName === "file") {
    const response = await fetch("/scene.json");
    if (!response.ok) {
      throw new Error(`scene.json: ${response.status}`);
    }
    const data = await response.json();
    return {
      elements: getNonDeletedElements(
        restoreElements(data.elements, null, {
          deleteInvisibleElements: true,
        }),
      ),
      files: data.files ?? {},
    };
  }
  const scene = SCENES[sceneName as SceneName]?.();
  if (!scene) {
    throw new Error(`unknown scene "${sceneName}"`);
  }
  return {
    elements: getNonDeletedElements(restoreElements(scene.elements, null)),
    files: scene.files,
  };
};

const tilesOf = (elements: readonly NonDeletedExcalidrawElement[]) => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const tiles: { x: number; y: number }[] = [];
  for (
    let y = Math.floor(minY / tileScene) * tileScene;
    y < maxY;
    y += tileScene
  ) {
    for (
      let x = Math.floor(minX / tileScene) * tileScene;
      x < maxX;
      x += tileScene
    ) {
      tiles.push({ x, y });
    }
  }
  return tiles;
};

const exportTile = (
  elements: readonly NonDeletedExcalidrawElement[],
  files: BinaryFiles,
  x: number,
  y: number,
) => {
  const frame = {
    id: "bench-tile",
    type: "frame",
    name: null,
    x,
    y,
    width: tileScene,
    height: tileScene,
    angle: 0,
    isDeleted: false,
  } as unknown as NonDeleted<ExcalidrawFrameLikeElement>;
  return exportToCanvas({
    elements,
    appState: { exportBackground: true },
    files,
    restoreElements: false,
    exportingFrame: frame,
    getDimensions: () => ({
      width: Math.round(tileScene * scale),
      height: Math.round(tileScene * scale),
      scale,
    }),
  });
};

const run = async () => {
  const { elements, files } = await loadScene();
  const tiles = tilesOf(elements).flatMap(({ x, y }) => {
    const inside = elementsOverlappingBBox({
      elements,
      bounds: [x, y, x + tileScene, y + tileScene] as const,
      type: "overlap",
    });
    return inside.length ? [{ x, y, inside }] : [];
  });
  status.textContent = `${elements.length} elements, ${tiles.length} tiles`;

  const passes: PassReport[] = [];
  for (let pass = 1; pass <= passCount; pass++) {
    takeCounters();
    await window.profilerHook?.(`pass${pass}`, "start");
    const start = performance.now();
    for (const { x, y, inside } of tiles) {
      await exportTile(inside, files, x, y);
    }
    const exportMs = performance.now() - start;
    await window.profilerHook?.(`pass${pass}`, "stop");
    passes.push({ tiles: tiles.length, exportMs, ...takeCounters() });
    status.textContent = `pass ${pass}: ${exportMs.toFixed(0)}ms`;
  }

  window.benchReport = {
    scene: sceneName,
    elements: elements.length,
    textElements: elements.filter((e) => e.type === "text").length,
    tileScene,
    scale,
    passes,
  };
};

run().catch((error) => {
  window.benchError = String(error?.stack ?? error);
  status.textContent = window.benchError;
});
