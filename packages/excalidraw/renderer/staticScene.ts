import {
  applyDarkModeFilter,
  COLOR_PALETTE,
  COLOR_WHITE,
  FRAME_STYLE,
  isShallowEqual,
  THEME,
  throttleRAF,
} from "@excalidraw/common";
import { isElementLink } from "@excalidraw/element";
import { createPlaceholderEmbeddableLabel } from "@excalidraw/element";
import { getBoundTextElement } from "@excalidraw/element";
import {
  isEmbeddableElement,
  isIframeLikeElement,
  isTextElement,
} from "@excalidraw/element";
import {
  elementOverlapsWithFrame,
  getTargetFrame,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import {
  cacheSettledBitmaps,
  getRenderElementWithPositionOverride,
  getSettledBitmapCount,
  resolveElementRenderState,
  renderElement,
} from "@excalidraw/element";

import { getElementAbsoluteCoords } from "@excalidraw/element";

import type { ElementRenderState } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  EXTERNAL_LINK_IMG,
  ELEMENT_LINK_IMG,
  getLinkHandleFromCoords,
} from "../components/hyperlink/helpers";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import type {
  StaticCanvasRenderConfig,
  StaticSceneRenderConfig,
} from "../scene/types";
import type { AppState, StaticCanvasAppState, Zoom } from "../types";

const GridLineColor = {
  [THEME.LIGHT]: {
    bold: "#dddddd",
    regular: "#e5e5e5",
  },
  [THEME.DARK]: {
    bold: applyDarkModeFilter("#dddddd"),
    regular: applyDarkModeFilter("#e5e5e5"),
  },
} as const;

const strokeGrid = (
  context: CanvasRenderingContext2D,
  /** grid cell pixel size */
  gridSize: number,
  /** setting to 1 will disble bold lines */
  gridStep: number,
  scrollX: number,
  scrollY: number,
  zoom: Zoom,
  theme: StaticCanvasRenderConfig["theme"],
  width: number,
  height: number,
  scale: number,
  canvasTheme: StaticCanvasRenderConfig["canvasTheme"],
) => {
  const boldColor = canvasTheme?.gridBoldColor ?? GridLineColor[theme].bold;
  const regularColor = canvasTheme?.gridColor ?? GridLineColor[theme].regular;
  const dashed = canvasTheme?.gridStyle !== "solid";

  const offsetX = (scrollX % gridSize) - gridSize;
  const offsetY = (scrollY % gridSize) - gridSize;

  const actualGridSize = gridSize * zoom.value;

  const spaceWidth = 1 / zoom.value;

  // scene units → device pixels
  const devicePixels = zoom.value * scale;

  // A line at least a device pixel wide is drawn a whole number of device
  // pixels wide and centered to cover them exactly — on the half pixel when
  // the count is odd. Straddling a pixel boundary renders it as two lighter
  // pixels, which is how the grid looked at every zoom but 100%. Thinner
  // lines (zoomed far out) keep their sub-pixel width: their lightness is
  // the point.
  const snap = (position: number, maxWidthInCssPixels: number) => {
    // a line is `min(1 / zoom, max)` scene units wide; computed straight in
    // device pixels, so `(1 / zoom) × zoom` never lands just under 1
    const widthInDevicePixels = Math.min(
      scale,
      maxWidthInCssPixels * devicePixels,
    );
    if (widthInDevicePixels < 1) {
      return { position, lineWidth: widthInDevicePixels / devicePixels };
    }
    const wholeWidth = Math.round(widthInDevicePixels);
    const center = wholeWidth % 2 ? 0.5 : 0;
    return {
      position:
        (Math.round(position * devicePixels - center) + center) / devicePixels,
      lineWidth: wholeWidth / devicePixels,
    };
  };

  context.save();

  // vertical lines
  for (let x = offsetX; x < offsetX + width + gridSize * 2; x += gridSize) {
    const isBold =
      gridStep > 1 && Math.round((x - scrollX) / gridSize) % gridStep === 0;
    // don't render regular lines when zoomed out and they're barely visible
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const { position, lineWidth } = snap(x, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold || !dashed ? [] : lineDash);
    context.strokeStyle = isBold ? boldColor : regularColor;
    context.moveTo(position, offsetY - gridSize);
    context.lineTo(position, Math.ceil(offsetY + height + gridSize * 2));
    context.stroke();
  }

  for (let y = offsetY; y < offsetY + height + gridSize * 2; y += gridSize) {
    const isBold =
      gridStep > 1 && Math.round((y - scrollY) / gridSize) % gridStep === 0;
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const { position, lineWidth } = snap(y, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold || !dashed ? [] : lineDash);
    context.strokeStyle = isBold ? boldColor : regularColor;
    context.moveTo(offsetX - gridSize, position);
    context.lineTo(Math.ceil(offsetX + width + gridSize * 2), position);
    context.stroke();
  }
  context.restore();
};

export const frameClip = (
  frame: ExcalidrawFrameLikeElement,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState,
) => {
  context.translate(frame.x + appState.scrollX, frame.y + appState.scrollY);
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      0,
      0,
      frame.width,
      frame.height,
      FRAME_STYLE.radius / appState.zoom.value,
    );
  } else {
    context.rect(0, 0, frame.width, frame.height);
  }
  context.clip();
  context.translate(
    -(frame.x + appState.scrollX),
    -(frame.y + appState.scrollY),
  );
};

type LinkIconCanvas = HTMLCanvasElement & { zoom: number };

const linkIconCanvasCache: {
  regularLink: LinkIconCanvas | null;
  elementLink: LinkIconCanvas | null;
} = {
  regularLink: null,
  elementLink: null,
};

const renderLinkIcon = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
  renderState: ElementRenderState,
) => {
  if (element.link && !appState.selectedElementIds[element.id]) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    const [x, y, width, height] = getLinkHandleFromCoords(
      [
        x1 + renderState.offset.x,
        y1 + renderState.offset.y,
        x2 + renderState.offset.x,
        y2 + renderState.offset.y,
      ],
      element.angle,
      appState,
    );
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    context.save();
    context.translate(appState.scrollX + centerX, appState.scrollY + centerY);
    context.rotate(element.angle);

    const canvasKey = isElementLink(element.link)
      ? "elementLink"
      : "regularLink";

    let linkCanvas = linkIconCanvasCache[canvasKey];

    if (!linkCanvas || linkCanvas.zoom !== appState.zoom.value) {
      linkCanvas = Object.assign(document.createElement("canvas"), {
        zoom: appState.zoom.value,
      });
      linkCanvas.width = width * window.devicePixelRatio * appState.zoom.value;
      linkCanvas.height =
        height * window.devicePixelRatio * appState.zoom.value;
      linkIconCanvasCache[canvasKey] = linkCanvas;

      const linkCanvasCacheContext = linkCanvas.getContext("2d")!;
      linkCanvasCacheContext.scale(
        window.devicePixelRatio * appState.zoom.value,
        window.devicePixelRatio * appState.zoom.value,
      );

      // Seed a sane default so a corrupted color (silently rejected by the
      // canvas) falls back to white instead of a stale fillStyle.
      linkCanvasCacheContext.fillStyle = COLOR_WHITE;
      linkCanvasCacheContext.fillStyle =
        appState.viewBackgroundColor || COLOR_WHITE;

      linkCanvasCacheContext.fillRect(0, 0, width, height);

      if (canvasKey === "elementLink") {
        linkCanvasCacheContext.drawImage(ELEMENT_LINK_IMG, 0, 0, width, height);
      } else {
        linkCanvasCacheContext.drawImage(
          EXTERNAL_LINK_IMG,
          0,
          0,
          width,
          height,
        );
      }

      linkCanvasCacheContext.restore();
    }
    context.globalAlpha = renderState.opacity;
    context.drawImage(linkCanvas, x - centerX, y - centerY, width, height);
    context.restore();
  }
};
/**
 * Paints elements as the static scene does: the painted ones in order, then
 * the iframe-like ones over all of them, then pending flowchart nodes.
 */
export const renderSceneElements = ({
  context,
  rc,
  elements: visibleElements,
  elementsMap,
  allElementsMap,
  appState,
  renderConfig,
}: {
  context: CanvasRenderingContext2D;
  rc: StaticSceneRenderConfig["rc"];
  elements: readonly NonDeletedExcalidrawElement[];
  elementsMap: StaticSceneRenderConfig["elementsMap"];
  allElementsMap: StaticSceneRenderConfig["allElementsMap"];
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
}) => {
  const { isExporting } = renderConfig;

  const inFrameGroupsMap = new Map<string, boolean>();

  const getRenderState = (element: ExcalidrawElement) =>
    resolveElementRenderState(
      element,
      elementsMap,
      renderConfig,
      allElementsMap,
    );

  const clipElementToFrame = (
    element: NonDeletedExcalidrawElement,
    renderState: ElementRenderState,
  ) => {
    if (
      !(element.frameId || appState.frameToHighlight?.id) ||
      !appState.frameRendering.enabled ||
      !appState.frameRendering.clip
    ) {
      return;
    }
    const targetFrame = getTargetFrame(element, elementsMap, appState);
    if (!targetFrame) {
      return;
    }
    const frameState = getRenderState(targetFrame);
    const frame = getRenderElementWithPositionOverride(
      targetFrame,
      frameState.offset,
    );
    const isTranslated = (state: ElementRenderState) =>
      state.offset.x !== 0 || state.offset.y !== 0;
    if (
      (element.frameId === frame.id &&
        (isTranslated(renderState) || isTranslated(frameState))) ||
      shouldApplyFrameClip(
        getRenderElementWithPositionOverride(element, renderState.offset),
        frame,
        appState,
        elementsMap,
        inFrameGroupsMap,
      )
    ) {
      frameClip(frame, context, renderConfig, appState);
    }
  };

  // Paint visible elements
  visibleElements
    .filter((el) => !isIframeLikeElement(el))
    .forEach((element) => {
      try {
        if (
          isTextElement(element) &&
          element.containerId &&
          elementsMap.has(element.containerId)
        ) {
          // will be rendered with the container
          return;
        }

        const renderState = getRenderState(element);
        context.save();
        try {
          const boundTextElement = getBoundTextElement(element, elementsMap);
          clipElementToFrame(element, renderState);
          renderElement(
            element,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
            renderState,
          );

          if (boundTextElement) {
            renderElement(
              boundTextElement,
              elementsMap,
              allElementsMap,
              rc,
              context,
              renderConfig,
              appState,
            );
          }
        } finally {
          context.restore();
        }

        if (!isExporting && renderConfig.renderLinks !== false) {
          renderLinkIcon(element, context, appState, elementsMap, renderState);
        }
      } catch (error: any) {
        console.error(
          error,
          element.id,
          element.x,
          element.y,
          element.width,
          element.height,
        );
      }
    });

  // render embeddables on top
  visibleElements
    .filter((el) => isIframeLikeElement(el))
    .forEach((element) => {
      try {
        const renderState = getRenderState(element);
        context.save();
        try {
          clipElementToFrame(element, renderState);
          renderElement(
            element,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
            renderState,
          );

          if (
            isIframeLikeElement(element) &&
            (isExporting ||
              (isEmbeddableElement(element) &&
                renderConfig.embedsValidationStatus.get(element.id) !==
                  true)) &&
            element.width &&
            element.height
          ) {
            const label = {
              ...createPlaceholderEmbeddableLabel(element),
              // Synthetic visual: resolve overrides and frame opacity through
              // its owner, without creating another animation target.
              id: element.id,
              frameId: element.frameId,
            };
            renderElement(
              label,
              elementsMap,
              allElementsMap,
              rc,
              context,
              renderConfig,
              appState,
            );
          }
          if (!isExporting && renderConfig.renderLinks !== false) {
            renderLinkIcon(
              element,
              context,
              appState,
              elementsMap,
              renderState,
            );
          }
        } finally {
          context.restore();
        }
      } catch (error: any) {
        console.error(error);
      }
    });

  // render pending nodes for flowcharts
  renderConfig.pendingFlowchartNodes?.forEach((element) => {
    try {
      renderElement(
        element,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } catch (error) {
      console.error(error);
    }
  });
};

/** the app state the static scene paints from */
export const getStaticSceneAppState = (
  appState: AppState,
): StaticCanvasAppState => {
  const relevantAppStateProps = {
    zoom: appState.zoom,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    width: appState.width,
    height: appState.height,
    viewModeEnabled: appState.viewModeEnabled,
    openDialog: appState.openDialog,
    hoveredElementIds: appState.hoveredElementIds,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    theme: appState.theme,
    shouldCacheIgnoreZoom: appState.shouldCacheIgnoreZoom,
    viewBackgroundColor: appState.viewBackgroundColor,
    exportScale: appState.exportScale,
    selectedElementsAreBeingDragged: appState.selectedElementsAreBeingDragged,
    gridSize: appState.gridSize,
    gridStep: appState.gridStep,
    frameRendering: appState.frameRendering,
    selectedElementIds: appState.selectedElementIds,
    frameToHighlight: appState.frameToHighlight,
    editingGroupId: appState.editingGroupId,
    currentHoveredFontFamily: appState.currentHoveredFontFamily,
    croppingElementId: appState.croppingElementId,
  };

  return relevantAppStateProps;
};

/**
 * What a static canvas last painted while a new element was being drawn, so
 * that committing the element can paint over it instead of repainting all.
 */
type PaintedUnderNewElement = {
  config: StaticSceneRenderConfig;
  newElementId: string;
  /** every scene element's id and version, in scene order */
  sceneIds: string[];
  sceneVersions: number[];
  settledBitmapCount: number;
  loadedImageCount: number;
};

const paintedUnderNewElement = new WeakMap<
  HTMLCanvasElement,
  PaintedUnderNewElement
>();

const countLoadedImages = (
  imageCache: StaticCanvasRenderConfig["imageCache"],
) => {
  let count = 0;
  for (const { image } of imageCache.values()) {
    if (!(image instanceof Promise)) {
      count++;
    }
  }
  return count;
};

const recordPaintUnderNewElement = (config: StaticSceneRenderConfig) => {
  const { newElement } = config.appState;
  if (!newElement || config.renderConfig.isExporting) {
    paintedUnderNewElement.delete(config.canvas);
    return;
  }
  const sceneIds: string[] = [];
  const sceneVersions: number[] = [];
  for (const element of config.allElementsMap.values()) {
    sceneIds.push(element.id);
    sceneVersions.push(element.version);
  }
  paintedUnderNewElement.set(config.canvas, {
    config,
    newElementId: newElement.id,
    sceneIds,
    sceneVersions,
    settledBitmapCount: getSettledBitmapCount(),
    loadedImageCount: countLoadedImages(config.renderConfig.imageCache),
  });
};

/**
 * The elements to paint over the canvas so it shows what a full repaint of
 * `next` would, or null when it must be repainted in full.
 *
 * Elements paint one after another, each on its own, so painting a list's
 * tail over a canvas holding its head equals painting the list. That holds
 * when the new element just committed is the only thing in the scene that
 * changed since the canvas was painted, nothing else about the view
 * changed, and what the canvas holds is the head of what `next` paints.
 */
const elementsToPaintOver = (
  painted: PaintedUnderNewElement | undefined,
  next: StaticSceneRenderConfig,
): NonDeletedExcalidrawElement[] | null => {
  if (
    !painted ||
    next.appState.newElement ||
    next.renderConfig.isExporting ||
    next.scale !== painted.config.scale ||
    painted.settledBitmapCount !== getSettledBitmapCount() ||
    painted.loadedImageCount !==
      countLoadedImages(next.renderConfig.imageCache) ||
    painted.config.renderConfig.pendingFlowchartNodes?.length ||
    !isShallowEqual(
      getStaticSceneAppState(painted.config.appState as AppState),
      getStaticSceneAppState(next.appState as AppState),
      {
        // a new element drawn inside a frame highlights it until released;
        // the static scene clips by it only for elements being dragged
        frameToHighlight: (a, b) =>
          a === b || !next.appState.selectedElementsAreBeingDragged,
      },
    ) ||
    !isShallowEqual(painted.config.renderConfig, next.renderConfig, {
      // compared above as the bitmaps themselves
      settledBitmapCount: () => true,
    })
  ) {
    return null;
  }

  const { sceneIds, sceneVersions, newElementId } = painted;
  if (next.allElementsMap.size !== sceneIds.length) {
    return null;
  }
  let index = 0;
  for (const element of next.allElementsMap.values()) {
    if (
      element.id !== sceneIds[index] ||
      (element.version !== sceneVersions[index] && element.id !== newElementId)
    ) {
      return null;
    }
    index++;
  }

  // iframe-like elements paint after all others, so the canvas' elements
  // must be the head of the others, and include none of them
  const paintedElements = painted.config.visibleElements;
  const over: NonDeletedExcalidrawElement[] = [];
  let matched = 0;
  for (const element of next.visibleElements) {
    if (matched < paintedElements.length && !isIframeLikeElement(element)) {
      if (element.id !== paintedElements[matched].id) {
        return null;
      }
      matched++;
    } else {
      over.push(element);
    }
  }
  return matched === paintedElements.length &&
    !paintedElements.some(isIframeLikeElement)
    ? over
    : null;
};

const _renderStaticScene = (config: StaticSceneRenderConfig) => {
  const {
    canvas,
    rc,
    elementsMap,
    allElementsMap,
    visibleElements,
    scale,
    appState: unsnappedAppState,
    renderConfig,
  } = config;
  if (canvas === null) {
    return;
  }

  const { renderGrid = true, isExporting } = renderConfig;
  // export draws vectors, not cached bitmaps — nothing to keep on the grid
  const appState = isExporting
    ? unsnappedAppState
    : snapScrollToDevicePixels(unsnappedAppState, scale);

  const paintOver = elementsToPaintOver(
    paintedUnderNewElement.get(canvas),
    config,
  );
  recordPaintUnderNewElement(config);

  if (paintOver) {
    const context = canvas.getContext("2d")!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(scale, scale);
    context.scale(appState.zoom.value, appState.zoom.value);
    renderSceneElements({
      context,
      rc,
      elements: paintOver,
      elementsMap,
      allElementsMap,
      appState,
      renderConfig,
    });
    cacheSettledBitmaps(
      canvas,
      visibleElements,
      allElementsMap,
      renderConfig,
      appState,
    );
    return;
  }

  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );

  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
    theme: appState.theme,
    isExporting,
    viewBackgroundColor: appState.viewBackgroundColor,
    // a theme restyles the default canvas only, not a background the user
    // picked
    themeBackgroundColor:
      appState.viewBackgroundColor === COLOR_PALETTE.white
        ? renderConfig.canvasTheme?.background
        : undefined,
  });

  // Apply zoom
  context.scale(appState.zoom.value, appState.zoom.value);

  // Grid
  if (renderGrid) {
    strokeGrid(
      context,
      renderConfig.gridSize ?? appState.gridSize,
      appState.gridStep,
      appState.scrollX,
      appState.scrollY,
      appState.zoom,
      renderConfig.theme,
      normalizedWidth / appState.zoom.value,
      normalizedHeight / appState.zoom.value,
      scale,
      renderConfig.canvasTheme,
    );
  }

  const groupsToBeAddedToFrame = new Set<string>();

  visibleElements.forEach((element) => {
    if (
      element.groupIds.length > 0 &&
      appState.frameToHighlight &&
      appState.selectedElementIds[element.id] &&
      (elementOverlapsWithFrame(
        element,
        appState.frameToHighlight,
        elementsMap,
      ) ||
        element.groupIds.find((groupId) => groupsToBeAddedToFrame.has(groupId)))
    ) {
      element.groupIds.forEach((groupId) =>
        groupsToBeAddedToFrame.add(groupId),
      );
    }
  });

  renderSceneElements({
    context,
    rc,
    elements: visibleElements,
    elementsMap,
    allElementsMap,
    appState,
    renderConfig,
  });

  cacheSettledBitmaps(
    canvas,
    visibleElements,
    allElementsMap,
    renderConfig,
    appState,
  );
};

/** throttled to animation framerate */
export const renderStaticSceneThrottled = throttleRAF(
  (config: StaticSceneRenderConfig) => {
    _renderStaticScene(config);
  },
);

/**
 * Static scene is the non-ui canvas where we render elements.
 */
export const renderStaticScene = (
  renderConfig: StaticSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderStaticSceneThrottled(renderConfig);
    return;
  }

  _renderStaticScene(renderConfig);
};
