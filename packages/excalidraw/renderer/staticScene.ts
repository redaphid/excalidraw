import {
  applyDarkModeFilter,
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
import { getThemeCanvasBackground } from "../cssTheme";

import { getBackdrop, strokeBackdrop } from "./backdrop";
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

/** upstream's smallest zoom, under which the grid nests instead of shrinking */
const GRID_NESTING_ZOOM = 0.1;

type GridLineStyle = "bold" | "regular" | null;

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

  // Zoomed out past upstream's 10%, the loops below would visit millions of
  // lines a frame. The grid repeats how it looks at 10% instead, a step
  // coarser each time the zoom falls by a step. Over each step, the lines
  // the coarser grid drops or draws in another style cross-fade into it, so
  // nothing pops. At 10% and over, `fade` is 0 and this is upstream's grid.
  const base = Math.max(gridStep, 2);
  const nesting = Math.max(
    0,
    Math.log(GRID_NESTING_ZOOM / zoom.value) / Math.log(base),
  );
  const level = Math.floor(nesting);
  const fade = nesting - level;
  const actualGridSize = gridSize * Math.max(zoom.value, GRID_NESTING_ZOOM);
  gridSize *= base ** level;

  const offsetX = (scrollX % gridSize) - gridSize;
  const offsetY = (scrollY % gridSize) - gridSize;

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
    // (and kept at 10%'s past it, so a nested grid looks like 10%'s)
    const widthInDevicePixels = Math.min(
      scale,
      maxWidthInCssPixels * Math.max(zoom.value, GRID_NESTING_ZOOM) * scale,
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

  // don't render regular lines when zoomed out and they're barely visible
  const styleOf = (index: number): GridLineStyle =>
    gridStep > 1 && index % gridStep === 0
      ? "bold"
      : actualGridSize < 10
      ? null
      : "regular";

  const strokeLine = (
    style: GridLineStyle,
    alpha: number,
    at: number,
    vertical: boolean,
  ) => {
    if (!style || !alpha) {
      return;
    }
    const isBold = style === "bold";
    const { position, lineWidth } = snap(at, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold || !dashed ? [] : lineDash);
    context.strokeStyle = isBold ? boldColor : regularColor;
    context.globalAlpha = alpha;
    if (vertical) {
      context.moveTo(position, offsetY - gridSize);
      context.lineTo(position, Math.ceil(offsetY + height + gridSize * 2));
    } else {
      context.moveTo(offsetX - gridSize, position);
      context.lineTo(Math.ceil(offsetX + width + gridSize * 2), position);
    }
    context.stroke();
  };

  /** a line as this grid draws it and as the next coarser one does */
  const strokeGridLine = (at: number, scroll: number, vertical: boolean) => {
    const index = Math.round((at - scroll) / gridSize);
    const style = styleOf(index);
    const coarser = !fade
      ? style
      : index % base === 0
      ? styleOf(index / base)
      : null;
    if (style === coarser) {
      strokeLine(style, 1, at, vertical);
    } else {
      strokeLine(style, 1 - fade, at, vertical);
      strokeLine(coarser, fade, at, vertical);
    }
  };

  // Past 10% with regular lines hidden, only every step's line can show, so
  // the loops visit only those (upstream's visit every line, at most 10x10
  // as many as it draws)
  const stride =
    nesting > 0 && actualGridSize < 10 ? gridSize * gridStep : gridSize;
  const startX = stride === gridSize ? offsetX : (scrollX % stride) - stride;
  const startY = stride === gridSize ? offsetY : (scrollY % stride) - stride;

  for (let x = startX; x < offsetX + width + gridSize * 2; x += stride) {
    strokeGridLine(x, scrollX, true);
  }
  for (let y = startY; y < offsetY + height + gridSize * 2; y += stride) {
    strokeGridLine(y, scrollY, false);
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
      (renderConfig.canvasTheme?.frameRadius ?? FRAME_STYLE.radius) /
        appState.zoom.value,
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
    shouldCacheIgnoreZoom: appState.shouldCacheIgnoreZoom,
    viewBackgroundColor: appState.viewBackgroundColor,
    viewBackgroundColorPicked: appState.viewBackgroundColorPicked,
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

type PaintedUnderNewElement = {
  config: StaticSceneRenderConfig;
  newElementId: string;
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

const elementsToPaintOver = (
  painted: PaintedUnderNewElement | undefined,
  next: StaticSceneRenderConfig,
): NonDeletedExcalidrawElement[] | null => {
  const frameHighlightClipsPaint =
    next.appState.selectedElementsAreBeingDragged;
  if (
    !painted ||
    next.appState.newElement ||
    next.renderConfig.isExporting ||
    next.scale !== painted.config.scale ||
    next.backgroundCanvas !== painted.config.backgroundCanvas ||
    painted.settledBitmapCount !== getSettledBitmapCount() ||
    painted.loadedImageCount !==
      countLoadedImages(next.renderConfig.imageCache) ||
    painted.config.renderConfig.pendingFlowchartNodes?.length ||
    !isShallowEqual(
      getStaticSceneAppState(painted.config.appState as AppState),
      getStaticSceneAppState(next.appState as AppState),
      {
        frameToHighlight: (a, b) => a === b || !frameHighlightClipsPaint,
      },
    ) ||
    !isShallowEqual(painted.config.renderConfig, next.renderConfig, {
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
    backgroundCanvas,
    rc,
    elementsMap,
    allElementsMap,
    visibleElements,
    scale,
    appState: unsnappedAppState,
    renderConfig,
    onPainted,
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
      elementsMap,
      allElementsMap,
      renderConfig,
      appState,
    );
    onPainted?.(unsnappedAppState);
    return;
  }

  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );

  const backgroundContext = bootstrapCanvas({
    canvas: backgroundCanvas ?? canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
    theme: renderConfig.theme,
    isExporting,
    viewBackgroundColor: appState.viewBackgroundColor,
    themeBackgroundColor: getThemeCanvasBackground(
      appState,
      renderConfig.canvasTheme,
    ),
  });
  const context = backgroundCanvas
    ? bootstrapCanvas({
        canvas,
        scale,
        normalizedWidth,
        normalizedHeight,
        viewBackgroundColor: "transparent",
      })
    : backgroundContext;

  // the backdrop belongs to the background: an export without one has neither
  const backdrop =
    typeof appState.viewBackgroundColor === "string"
      ? getBackdrop(renderConfig.canvasTheme, appState)
      : null;
  if (backdrop) {
    strokeBackdrop(backgroundContext, backdrop, appState, scale);
  }

  // Apply zoom
  context.scale(appState.zoom.value, appState.zoom.value);
  if (backgroundContext !== context) {
    backgroundContext.scale(appState.zoom.value, appState.zoom.value);
  }

  // Grid
  if (renderGrid) {
    strokeGrid(
      backgroundContext,
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
    elementsMap,
    allElementsMap,
    renderConfig,
    appState,
  );

  onPainted?.(unsnappedAppState);
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
