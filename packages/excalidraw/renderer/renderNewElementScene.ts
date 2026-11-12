import { FRAME_STYLE, isShallowEqual, throttleRAF } from "@excalidraw/common";

import {
  getElementPaintBounds,
  getSettledBitmapCount,
  getTargetFrame,
  isFrameLikeElement,
  isFreeDrawElement,
  isInvisiblySmallElement,
  renderElement,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import type { Bounds } from "@excalidraw/common";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import {
  frameClip,
  getStaticSceneAppState,
  renderSceneElements,
} from "./staticScene";

import type { NewElementSceneRenderConfig } from "../scene/types";

type PaintedLayer = {
  config: NewElementSceneRenderConfig;
  newElementId: string;
  canvasWidth: number;
  canvasHeight: number;
  settledBitmapCount: number;
  sceneBounds: Bounds;
};

const ANTI_ALIAS_MARGIN_DEVICE_PX = 1;

const paintedLayers = new WeakMap<HTMLCanvasElement, PaintedLayer>();

const onlyNewElementChanged = (
  canvas: HTMLCanvasElement,
  painted: PaintedLayer,
  next: NewElementSceneRenderConfig,
) =>
  "elementsAbove" in painted.config.layer &&
  "elementsAbove" in next.layer &&
  painted.config.layer.elementsAbove === next.layer.elementsAbove &&
  painted.newElementId === next.appState.newElement?.id &&
  painted.canvasWidth === canvas.width &&
  painted.canvasHeight === canvas.height &&
  painted.settledBitmapCount === getSettledBitmapCount() &&
  painted.config.scale === next.scale &&
  painted.config.elementsMap === next.elementsMap &&
  painted.config.allElementsMap === next.allElementsMap &&
  !next.renderConfig.pendingFlowchartNodes?.length &&
  isShallowEqual(painted.config.renderConfig, next.renderConfig) &&
  isShallowEqual(
    getStaticSceneAppState(painted.config.appState),
    getStaticSceneAppState(next.appState),
  );

const intersects = (a: Bounds, b: Bounds) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const contains = (outer: Bounds, inner: Bounds) =>
  outer[0] <= inner[0] &&
  outer[1] <= inner[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3];

/**
 * A device-pixel clip changes how Chromium rasterizes a vector path that
 * crosses it, so the rect must stay clear of every other element painted
 * here, and inside the frame's outline and clip edge. Painting the new
 * element alone, whole, within it matches a full repaint.
 */
const getDirtyRect = (
  canvas: HTMLCanvasElement,
  painted: PaintedLayer | undefined,
  next: NewElementSceneRenderConfig,
  newElement: NonDeletedExcalidrawElement,
  sceneBounds: Bounds,
  appState: NewElementSceneRenderConfig["appState"],
): Bounds | null => {
  const frame = newElement.frameId
    ? next.elementsMap.get(newElement.frameId)
    : undefined;
  if (
    !painted ||
    !("elementsAbove" in next.layer) ||
    !frame ||
    !isFrameLikeElement(frame) ||
    !onlyNewElementChanged(canvas, painted, next)
  ) {
    return null;
  }
  const toDevice = next.scale * appState.zoom.value;
  const toDeviceBounds = ([x1, y1, x2, y2]: Bounds, inset: number): Bounds => [
    Math.floor((x1 + appState.scrollX) * toDevice) + inset,
    Math.floor((y1 + appState.scrollY) * toDevice) + inset,
    Math.ceil((x2 + appState.scrollX) * toDevice) - inset,
    Math.ceil((y2 + appState.scrollY) * toDevice) - inset,
  ];

  const unclamped = toDeviceBounds(
    [
      Math.min(painted.sceneBounds[0], sceneBounds[0]),
      Math.min(painted.sceneBounds[1], sceneBounds[1]),
      Math.max(painted.sceneBounds[2], sceneBounds[2]),
      Math.max(painted.sceneBounds[3], sceneBounds[3]),
    ],
    -ANTI_ALIAS_MARGIN_DEVICE_PX,
  );
  const dirty: Bounds = [
    Math.max(0, unclamped[0]),
    Math.max(0, unclamped[1]),
    Math.min(canvas.width, unclamped[2]),
    Math.min(canvas.height, unclamped[3]),
  ];

  const { canvasTheme } = next.renderConfig;
  const frameOutlineInset =
    ((canvasTheme?.frameRadius ?? FRAME_STYLE.radius) +
      (canvasTheme?.frameWidth ?? FRAME_STYLE.outlineWidth)) *
      next.scale +
    2 * ANTI_ALIAS_MARGIN_DEVICE_PX;
  const insideFrame = toDeviceBounds(
    [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height],
    Math.ceil(frameOutlineInset),
  );
  if (!contains(insideFrame, dirty)) {
    return null;
  }

  for (const element of next.layer.elementsAbove) {
    if (
      element.id !== newElement.id &&
      element.id !== frame.id &&
      intersects(
        toDeviceBounds(
          getElementPaintBounds(element, next.allElementsMap),
          -ANTI_ALIAS_MARGIN_DEVICE_PX -
            (isFrameLikeElement(element) ? Math.ceil(frameOutlineInset) : 0),
        ),
        dirty,
      )
    ) {
      return null;
    }
  }
  return dirty;
};

const _renderNewElementScene = (config: NewElementSceneRenderConfig) => {
  const {
    canvas,
    rc,
    layer,
    elementsMap,
    allElementsMap,
    scale,
    appState: unsnappedAppState,
    renderConfig,
  } = config;
  if (canvas) {
    // the same whole-device-pixel scroll the static scene draws at
    const appState = snapScrollToDevicePixels(unsnappedAppState, scale);
    const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
      canvas,
      scale,
    );

    const newElement = unsnappedAppState.newElement;
    const freedraw =
      "elementsAbove" in layer && isFreeDrawElement(newElement)
        ? newElement
        : null;
    const bounds = freedraw && getElementPaintBounds(freedraw, allElementsMap);
    const dirty =
      freedraw &&
      bounds &&
      getDirtyRect(
        canvas,
        paintedLayers.get(canvas),
        config,
        freedraw,
        bounds,
        appState,
      );
    if (freedraw && bounds) {
      paintedLayers.set(canvas, {
        config,
        newElementId: freedraw.id,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        settledBitmapCount: getSettledBitmapCount(),
        sceneBounds: bounds,
      });
    } else {
      paintedLayers.delete(canvas);
    }

    let context: CanvasRenderingContext2D;
    if (dirty) {
      const [x1, y1, x2, y2] = dirty;
      context = canvas.getContext("2d")!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(x1, y1, x2 - x1, y2 - y1);
      context.save();
      context.beginPath();
      context.rect(x1, y1, x2 - x1, y2 - y1);
      context.clip();
      context.scale(scale, scale);
    } else {
      context = bootstrapCanvas({
        canvas,
        scale,
        normalizedWidth,
        normalizedHeight,
      });
      context.save();
    }

    // Apply zoom
    context.scale(appState.zoom.value, appState.zoom.value);

    if ("elementsAbove" in layer) {
      renderSceneElements({
        context,
        rc,
        elements: layer.elementsAbove,
        elementsMap,
        allElementsMap,
        appState,
        renderConfig,
      });
    } else if (layer.element.type !== "selection") {
      const newElement = layer.element;
      // e.g. when creating arrows and we're still below the arrow drag distance
      // threshold
      // (for now we skip render only with elements while we're creating to be
      // safe)
      if (isInvisiblySmallElement(newElement)) {
        return;
      }

      const frameId = newElement.frameId || appState.frameToHighlight?.id;

      if (
        frameId &&
        appState.frameRendering.enabled &&
        appState.frameRendering.clip
      ) {
        const frame = getTargetFrame(newElement, elementsMap, appState);

        if (
          frame &&
          shouldApplyFrameClip(newElement, frame, appState, elementsMap)
        ) {
          frameClip(frame, context, renderConfig, appState);
        }
      }

      const renderTargetElement = newElement;

      renderElement(
        renderTargetElement,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } else {
      context.clearRect(0, 0, normalizedWidth, normalizedHeight);
    }

    context.restore();
  }
};

export const renderNewElementSceneThrottled = throttleRAF(
  (config: NewElementSceneRenderConfig) => {
    _renderNewElementScene(config);
  },
);

export const renderNewElementScene = (
  renderConfig: NewElementSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderNewElementSceneThrottled(renderConfig);
    return;
  }

  _renderNewElementScene(renderConfig);
};
