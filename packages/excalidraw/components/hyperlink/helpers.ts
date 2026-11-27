import { pointDistance, pointFrom, pointRotateRads } from "@excalidraw/math";

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
 * `HIT` across follows, a finger's width, except on an element's body (its
 * own or a neighbour's), where only the disc does so a press there still
 * selects or drags that element. In view mode nothing drags, so the full
 * reach holds everywhere. An element whose longest side shows under
 * `MIN_ELEMENT` wears a `PIP` dot instead and keeps all of its taps.
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

/** What a badge shows: where its link goes, or only that there is one. */
export type LinkBadgeLook = LinkKind | "pip";

const linkKinds = new Map<string, LinkKind>();

/** Painted every frame for every linked element, so a link is parsed once. */
export const linkKindOf = (link: string): LinkKind => {
  let kind = linkKinds.get(link);
  if (!kind) {
    kind = isLocalLink(link) || isElementLink(link) ? "place" : "web";
    if (linkKinds.size >= 512) {
      linkKinds.clear();
    }
    linkKinds.set(link, kind);
  }
  return kind;
};

export const showsLinkBadge = ([x1, y1, x2, y2]: Bounds, zoom: number) =>
  Math.max(x2 - x1, y2 - y1) * zoom >= LINK_BADGE.MIN_ELEMENT;

const centreOf = ([x1, y1, x2, y2]: Bounds) =>
  pointFrom<GlobalPoint>((x1 + x2) / 2, (y1 + y2) / 2);

const linkBadgeCentre = (bounds: Bounds, angle: Radians, zoom: number) =>
  pointRotateRads(
    pointFrom<GlobalPoint>(
      bounds[2] + LINK_BADGE.OUT / zoom,
      bounds[1] - LINK_BADGE.OUT / zoom,
    ),
    centreOf(bounds),
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

/**
 * How far a point is from the element's link badge, in scene units, when a
 * tap there follows the link; Infinity when it does not. `onABody`: the point
 * hits some element other than a frame, by the real hit test.
 */
export const linkHitDistance = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  point: GlobalPoint,
  isMobile: boolean,
  onABody: boolean,
) => {
  if (!element.link || appState.selectedElementIds[element.id]) {
    return Infinity;
  }
  const zoom = appState.zoom.value;
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const bounds: Bounds = [x1, y1, x2, y2];
  const distance = pointDistance(
    point,
    linkBadgeCentre(bounds, element.angle, zoom),
  );
  if (
    !isMobile &&
    appState.viewModeEnabled &&
    hitElementBoundingBox(point, element, elementsMap)
  ) {
    return distance;
  }
  if (!showsLinkBadge(bounds, zoom)) {
    return Infinity;
  }
  const reach =
    onABody && !appState.viewModeEnabled ? LINK_BADGE.MARK : LINK_BADGE.HIT;
  return distance <= reach / 2 / zoom ? distance : Infinity;
};
