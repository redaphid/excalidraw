import { isShallowEqual, throttleRAF } from "@excalidraw/common";

import {
  getElementPaintBounds,
  getTargetFrame,
  isInvisiblySmallElement,
  renderElement,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import type { Bounds } from "@excalidraw/common";

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
  sceneBounds: Bounds;
};

const ANTI_ALIAS_MARGIN_DEVICE_PX = 1;

const paintedLayers = new WeakMap<HTMLCanvasElement, PaintedLayer>();

const getDirtyRect = (
  canvas: HTMLCanvasElement,
  painted: PaintedLayer | undefined,
  next: NewElementSceneRenderConfig,
  bounds: Bounds,
  appState: NewElementSceneRenderConfig["appState"],
) => {
  if (
    !painted ||
    !("elementsAbove" in painted.config.layer) ||
    !("elementsAbove" in next.layer) ||
    painted.config.layer.elementsAbove !== next.layer.elementsAbove ||
    painted.newElementId !== next.appState.newElement?.id ||
    painted.canvasWidth !== canvas.width ||
    painted.canvasHeight !== canvas.height ||
    painted.config.scale !== next.scale ||
    painted.config.elementsMap !== next.elementsMap ||
    painted.config.allElementsMap !== next.allElementsMap ||
    !isShallowEqual(painted.config.renderConfig, next.renderConfig) ||
    !isShallowEqual(
      getStaticSceneAppState(painted.config.appState),
      getStaticSceneAppState(next.appState),
    )
  ) {
    return null;
  }
  const toDevice = next.scale * appState.zoom.value;
  const x1 = Math.max(
    0,
    Math.floor(
      (Math.min(painted.sceneBounds[0], bounds[0]) + appState.scrollX) *
        toDevice,
    ) - ANTI_ALIAS_MARGIN_DEVICE_PX,
  );
  const y1 = Math.max(
    0,
    Math.floor(
      (Math.min(painted.sceneBounds[1], bounds[1]) + appState.scrollY) *
        toDevice,
    ) - ANTI_ALIAS_MARGIN_DEVICE_PX,
  );
  const x2 = Math.min(
    canvas.width,
    Math.ceil(
      (Math.max(painted.sceneBounds[2], bounds[2]) + appState.scrollX) *
        toDevice,
    ) + ANTI_ALIAS_MARGIN_DEVICE_PX,
  );
  const y2 = Math.min(
    canvas.height,
    Math.ceil(
      (Math.max(painted.sceneBounds[3], bounds[3]) + appState.scrollY) *
        toDevice,
    ) + ANTI_ALIAS_MARGIN_DEVICE_PX,
  );
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
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
    const bounds =
      "elementsAbove" in layer && newElement
        ? getElementPaintBounds(newElement, allElementsMap)
        : null;
    const dirty =
      bounds &&
      getDirtyRect(canvas, paintedLayers.get(canvas), config, bounds, appState);
    if (bounds && newElement) {
      paintedLayers.set(canvas, {
        config,
        newElementId: newElement.id,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        sceneBounds: bounds,
      });
    } else {
      paintedLayers.delete(canvas);
    }

    let context: CanvasRenderingContext2D;
    if (dirty) {
      context = canvas.getContext("2d")!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(dirty.x, dirty.y, dirty.width, dirty.height);
      context.save();
      context.beginPath();
      context.rect(dirty.x, dirty.y, dirty.width, dirty.height);
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
