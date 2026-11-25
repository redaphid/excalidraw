import { pointFrom, pointRotateRads } from "@excalidraw/math";

import { isLocalLink } from "@excalidraw/common";
import {
  getElementAbsoluteCoords,
  hitElementBoundingBox,
  isElementLink,
} from "@excalidraw/element";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type { Bounds } from "@excalidraw/common";
import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { AppState } from "../../types";

/**
 * The badge an element with a link wears at its top-right corner, in CSS px,
 * the same on screen at any zoom: a `MARK` disc that a tap anywhere within
 * `HIT` across follows, a finger's width. An element whose longest side shows
 * under `MIN_ELEMENT` wears a `PIP` dot instead and keeps all of its taps.
 */
export const LINK_BADGE = {
  MARK: 24,
  HIT: 48,
  PIP: 6,
  /** how far the badge's centre sits out from the corner, on each axis */
  OUT: 4,
  MIN_ELEMENT: 64,
} as const;

/** A place on the board or this site (a portal, a frame), or the wider web. */
export type LinkKind = "place" | "web";

export const linkKindOf = (link: string): LinkKind =>
  isElementLink(link) || isLocalLink(link) ? "place" : "web";

export const showsLinkBadge = ([x1, y1, x2, y2]: Bounds, zoom: number) =>
  Math.max(x2 - x1, y2 - y1) * zoom >= LINK_BADGE.MIN_ELEMENT;

const linkBadgeCentre = (
  [x1, y1, x2, y2]: Bounds,
  angle: Radians,
  zoom: number,
) =>
  pointRotateRads(
    pointFrom(x2 + LINK_BADGE.OUT / zoom, y1 - LINK_BADGE.OUT / zoom),
    pointFrom((x1 + x2) / 2, (y1 + y2) / 2),
    angle,
  );

/** The badge's visible mark (or pip) as `[x, y, width, height]` in scene units. */
export const getLinkHandleFromCoords = (
  bounds: Bounds,
  angle: Radians,
  appState: Pick<AppState, "zoom">,
): Bounds => {
  const zoom = appState.zoom.value;
  const size =
    (showsLinkBadge(bounds, zoom) ? LINK_BADGE.MARK : LINK_BADGE.PIP) / zoom;
  const [x, y] = linkBadgeCentre(bounds, angle, zoom);
  return [x - size / 2, y - size / 2, size, size];
};

/** How far a point is from the element's link badge, in scene units; Infinity when it wears only a pip. */
export const linkBadgeDistance = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: Pick<AppState, "zoom">,
  [x, y]: GlobalPoint,
) => {
  const zoom = appState.zoom.value;
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  if (!showsLinkBadge([x1, y1, x2, y2], zoom)) {
    return Infinity;
  }
  const [cx, cy] = linkBadgeCentre([x1, y1, x2, y2], element.angle, zoom);
  return Math.hypot(x - cx, y - cy);
};

export const isPointHittingLinkIcon = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  point: GlobalPoint,
) =>
  linkBadgeDistance(element, elementsMap, appState, point) <=
  LINK_BADGE.HIT / 2 / appState.zoom.value;

export const isPointHittingLink = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  [x, y]: GlobalPoint,
  isMobile: boolean,
) => {
  if (!element.link || appState.selectedElementIds[element.id]) {
    return false;
  }
  if (
    !isMobile &&
    appState.viewModeEnabled &&
    hitElementBoundingBox(pointFrom(x, y), element, elementsMap)
  ) {
    return true;
  }
  return isPointHittingLinkIcon(
    element,
    elementsMap,
    appState,
    pointFrom(x, y),
  );
};
