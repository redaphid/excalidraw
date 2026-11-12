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
  /** by edge in device pixels, least recently used first */
  rasters: Map<number, HTMLCanvasElement>;
};

/** a raster's longest edge in device pixels; the pattern transform scales a
 * clamped raster up to the tile's on-screen size */
export const MAX_RASTER_EDGE = 2048;
/** the backing store all cached rasters may hold together: four rasters at
 * the longest edge */
export const MAX_RASTER_BYTES = 4 * MAX_RASTER_EDGE * MAX_RASTER_EDGE * 4;
/** the images kept decoded: the current theme's and a few recent ones, for a
 * host that switches between themes */
const MAX_TILES = 4;

/** by URL, least recently used first */
const tiles = new Map<string, Tiles>();
let rasterBytes = 0;

const bytesOf = (raster: HTMLCanvasElement) => raster.width * raster.height * 4;

const dropRaster = (entry: Tiles, edge: number, raster: HTMLCanvasElement) => {
  entry.rasters.delete(edge);
  rasterBytes -= bytesOf(raster);
  // frees the backing store now rather than at garbage collection
  raster.width = raster.height = 0;
};

const tilesOf = (url: string) => {
  let entry = tiles.get(url);
  if (entry) {
    tiles.delete(url);
  } else {
    const image = new Image();
    const loaded = new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    });
    image.src = url;
    entry = { image, loaded, rasters: new Map() };
  }
  tiles.set(url, entry);
  for (const [oldUrl, old] of tiles) {
    if (tiles.size <= MAX_TILES) {
      break;
    }
    old.rasters.forEach((raster, edge) => dropRaster(old, edge, raster));
    tiles.delete(oldUrl);
  }
  return entry;
};

const ready = ({ image }: Tiles) => image.complete && image.naturalWidth > 0;

/** settles once the image has decoded (or failed); callers repaint then */
export const loadBackdrop = (url: string) => tilesOf(url).loaded;

/** drops the least recently used rasters, other images' first, until the
 * cache fits its budget */
const evictRasters = () => {
  for (const entry of tiles.values()) {
    for (const [edge, raster] of entry.rasters) {
      if (rasterBytes <= MAX_RASTER_BYTES) {
        return;
      }
      dropRaster(entry, edge, raster);
    }
  }
};

const rasterOf = (entry: Tiles, edge: number) => {
  let raster = entry.rasters.get(edge);
  if (raster) {
    entry.rasters.delete(edge);
  } else {
    raster = document.createElement("canvas");
    raster.width = raster.height = edge;
    raster.getContext("2d")!.drawImage(entry.image, 0, 0, edge, edge);
    rasterBytes += bytesOf(raster);
  }
  entry.rasters.set(edge, raster);
  evictRasters();
  return raster;
};

/**
 * Fills the canvas with the backdrop as a repeating pattern anchored to world
 * coordinates: tile corners sit on multiples of the period. The tile is
 * rasterized once per on-screen size in device pixels, so the lines in it
 * stay one device pixel wide at every zoom, up to `MAX_RASTER_EDGE`; a larger
 * tile is that raster scaled up. Draws nothing until the image
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
  const size = Math.min(MAX_RASTER_EDGE, Math.max(1, Math.round(spacing)));
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
