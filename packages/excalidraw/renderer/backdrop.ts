import { getGridSizeAtScale } from "@excalidraw/common";

import type { CanvasTheme } from "../cssTheme";
import type { StaticCanvasAppState } from "../types";

/** the world-anchored tile a theme repeats under the grid */
export type Backdrop = Readonly<{
  /** a `data:` URL */
  image: string;
  /** one tile's size in scene units at zoom 1 */
  size: number;
}>;

type BackdropAppState = Pick<
  StaticCanvasAppState,
  "scrollX" | "scrollY" | "zoom" | "gridSize" | "gridStep"
>;

export const getBackdrop = (
  canvasTheme: CanvasTheme | undefined,
  appState: Pick<BackdropAppState, "gridSize" | "gridStep">,
): Backdrop | null =>
  canvasTheme?.backdropImage
    ? {
        image: canvasTheme.backdropImage,
        size: canvasTheme.backdropSize ?? appState.gridSize * appState.gridStep,
      }
    : null;

/**
 * The tile's period in scene units at this zoom. It nests with the grid: the
 * size times whole powers of the grid step, so a tile stays between `size`
 * and `size × gridStep` screen pixels and its corners land on grid lines.
 */
export const backdropPeriod = (
  backdrop: Backdrop,
  appState: Pick<BackdropAppState, "zoom" | "gridStep">,
) =>
  getGridSizeAtScale(backdrop.size, appState.gridStep, 1 / appState.zoom.value);

const mod = (a: number, b: number) => ((a % b) + b) % b;

type Tiles = {
  image: HTMLImageElement;
  loaded: Promise<void>;
  rasters: Map<number, HTMLCanvasElement>;
};

const tiles = new Map<string, Tiles>();

const tilesOf = (url: string) => {
  let entry = tiles.get(url);
  if (!entry) {
    const image = new Image();
    const loaded = new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    });
    image.src = url;
    entry = { image, loaded, rasters: new Map() };
    tiles.set(url, entry);
  }
  return entry;
};

const ready = ({ image }: Tiles) => image.complete && image.naturalWidth > 0;

/** settles once the image has decoded (or failed); callers repaint then */
export const loadBackdrop = (url: string) => tilesOf(url).loaded;

const MAX_RASTERS = 48;

const rasterOf = (entry: Tiles, size: number) => {
  let raster = entry.rasters.get(size);
  if (!raster) {
    raster = document.createElement("canvas");
    raster.width = raster.height = size;
    raster.getContext("2d")!.drawImage(entry.image, 0, 0, size, size);
    if (entry.rasters.size >= MAX_RASTERS) {
      entry.rasters.clear();
    }
    entry.rasters.set(size, raster);
  }
  return raster;
};

/**
 * Fills the canvas with the backdrop as a repeating pattern anchored to world
 * coordinates: tile corners sit on multiples of the period. The tile is
 * rasterized once per on-screen size in device pixels, so the lines in it
 * stay one device pixel wide at every zoom. Draws nothing until the image
 * has decoded; see `loadBackdrop`.
 */
export const strokeBackdrop = (
  context: CanvasRenderingContext2D,
  backdrop: Backdrop,
  appState: BackdropAppState,
  /** device pixels per CSS pixel */
  scale: number,
) => {
  const entry = tilesOf(backdrop.image);
  if (!ready(entry)) {
    return;
  }
  const period = backdropPeriod(backdrop, appState);
  const devicePixels = appState.zoom.value * scale;
  const spacing = period * devicePixels;
  const size = Math.max(1, Math.round(spacing));
  const pattern = context.createPattern(rasterOf(entry, size), "repeat");
  if (!pattern) {
    return;
  }
  pattern.setTransform(
    new DOMMatrix()
      .translate(
        mod(appState.scrollX, period) * devicePixels,
        mod(appState.scrollY, period) * devicePixels,
      )
      .scale(spacing / size),
  );
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = pattern;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
};

/**
 * The same backdrop for an SVG export: a `<pattern>` in `defs` and a full-size
 * `<rect>` filled with it, with the pattern origin at the scene origin.
 */
export const appendSvgBackdrop = (
  svgRoot: SVGElement,
  defs: SVGElement,
  backdrop: Backdrop,
  {
    offsetX,
    offsetY,
    width,
    height,
  }: { offsetX: number; offsetY: number; width: number; height: number },
) => {
  const ns = svgRoot.namespaceURI;
  const doc = svgRoot.ownerDocument;
  const { size } = backdrop;
  const pattern = doc.createElementNS(ns, "pattern");
  pattern.setAttribute("id", "backdrop");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("x", `${mod(offsetX, size)}`);
  pattern.setAttribute("y", `${mod(offsetY, size)}`);
  pattern.setAttribute("width", `${size}`);
  pattern.setAttribute("height", `${size}`);
  const image = doc.createElementNS(ns, "image");
  image.setAttribute("href", backdrop.image);
  image.setAttribute("width", `${size}`);
  image.setAttribute("height", `${size}`);
  pattern.appendChild(image);
  defs.appendChild(pattern);
  const rect = doc.createElementNS(ns, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", `${width}`);
  rect.setAttribute("height", `${height}`);
  rect.setAttribute("fill", "url(#backdrop)");
  svgRoot.appendChild(rect);
};
