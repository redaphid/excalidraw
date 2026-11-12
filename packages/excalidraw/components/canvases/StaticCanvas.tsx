import React, { useEffect, useRef } from "react";

import { isShallowEqual } from "@excalidraw/common";

import type {
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { isRenderThrottlingEnabled } from "../../reactUtils";
import {
  getStaticSceneAppState,
  renderStaticScene,
} from "../../renderer/staticScene";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../../scene/types";
import type { AppState, StaticCanvasAppState } from "../../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

type StaticCanvasProps = {
  canvas: HTMLCanvasElement;
  backgroundCanvas: HTMLCanvasElement | null;
  rc: RoughCanvas;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  visibleElements: readonly NonDeletedExcalidrawElement[];
  canvasNonce: string;
  selectionNonce: number | undefined;
  scale: number;
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
  onPainted?: (appState: StaticCanvasAppState) => void;
};

const StaticCanvas = (props: StaticCanvasProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isComponentMounted = useRef(false);

  useEffect(() => {
    for (const canvas of [props.canvas, props.backgroundCanvas]) {
      if (canvas) {
        canvas.style.width = `${props.appState.width}px`;
        canvas.style.height = `${props.appState.height}px`;
        canvas.width = props.appState.width * props.scale;
        canvas.height = props.appState.height * props.scale;
      }
    }
  }, [
    props.appState.height,
    props.appState.width,
    props.canvas,
    props.backgroundCanvas,
    props.scale,
  ]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const { canvas, backgroundCanvas } = props;

    if (!isComponentMounted.current) {
      isComponentMounted.current = true;
      canvas.classList.add("excalidraw__canvas", "static");
    }
    if (wrapper.firstChild !== (backgroundCanvas ?? canvas)) {
      backgroundCanvas?.classList.add("excalidraw__canvas", "background");
      wrapper.replaceChildren(
        ...(backgroundCanvas ? [backgroundCanvas, canvas] : [canvas]),
      );
    }

    renderStaticScene(
      {
        canvas,
        backgroundCanvas,
        rc: props.rc,
        scale: props.scale,
        elementsMap: props.elementsMap,
        allElementsMap: props.allElementsMap,
        visibleElements: props.visibleElements,
        appState: props.appState,
        renderConfig: props.renderConfig,
        onPainted: props.onPainted,
      },
      isRenderThrottlingEnabled(),
    );
  });

  return <div className="excalidraw__canvas-wrapper" ref={wrapperRef} />;
};

const areEqual = (
  prevProps: StaticCanvasProps,
  nextProps: StaticCanvasProps,
) => {
  if (
    prevProps.canvasNonce !== nextProps.canvasNonce ||
    prevProps.backgroundCanvas !== nextProps.backgroundCanvas ||
    prevProps.scale !== nextProps.scale ||
    // we need to memoize on elementsMap because they may have renewed
    // even if canvasNonce didn't change (e.g. we filter elements out based
    // on appState)
    prevProps.elementsMap !== nextProps.elementsMap ||
    prevProps.visibleElements !== nextProps.visibleElements
  ) {
    return false;
  }

  return (
    isShallowEqual(
      // asserting AppState because we're being passed the whole AppState
      // but resolve to only the StaticCanvas-relevant props
      getStaticSceneAppState(prevProps.appState as AppState),
      getStaticSceneAppState(nextProps.appState as AppState),
    ) && isShallowEqual(prevProps.renderConfig, nextProps.renderConfig)
  );
};

export default React.memo(StaticCanvas, areEqual);
