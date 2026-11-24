import {
  applyDarkModeFilter,
  DEFAULT_FILL_GRADIENT,
  isTransparent,
} from "@excalidraw/common";

import type { AppState } from "@excalidraw/excalidraw/types";

import { isFreeDrawElement, isLinearElement } from "./typeChecks";

import type { ExcalidrawElement } from "./types";

import type { Drawable } from "roughjs/bin/core";

type GradientColors = readonly [start: string, end: string];

export type ElementFillGradient =
  | {
      type: "linear";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      colors: GradientColors;
    }
  | {
      type: "radial";
      cx: number;
      cy: number;
      r: number;
      colors: GradientColors;
    };

const getLocalBounds = (element: ExcalidrawElement) => {
  if (isLinearElement(element) || isFreeDrawElement(element)) {
    return element.points.reduce(
      (bounds, [x, y]) => ({
        minX: Math.min(bounds.minX, x),
        minY: Math.min(bounds.minY, y),
        maxX: Math.max(bounds.maxX, x),
        maxY: Math.max(bounds.maxY, y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
  }
  return { minX: 0, minY: 0, maxX: element.width, maxY: element.height };
};

export const getFillGradient = (
  element: ExcalidrawElement,
  isDarkMode: boolean,
): ElementFillGradient | null => {
  if (
    element.fillStyle !== "gradient" ||
    isTransparent(element.backgroundColor)
  ) {
    return null;
  }

  const { type, color, angle } = element.fillGradient ?? DEFAULT_FILL_GRADIENT;
  const colors = [
    applyDarkModeFilter(element.backgroundColor, isDarkMode),
    applyDarkModeFilter(color, isDarkMode),
  ] as const;

  const { minX, minY, maxX, maxY } = getLocalBounds(element);
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = minX + width / 2;
  const cy = minY + height / 2;

  if (type === "radial") {
    return { type, cx, cy, r: Math.hypot(width, height) / 2, colors };
  }

  const radians = (angle * Math.PI) / 180;
  const directionX = Math.sin(radians);
  const directionY = -Math.cos(radians);
  const halfLength =
    (Math.abs(width * directionX) + Math.abs(height * directionY)) / 2;

  return {
    type,
    x1: cx - directionX * halfLength,
    y1: cy - directionY * halfLength,
    x2: cx + directionX * halfLength,
    y2: cy + directionY * halfLength,
    colors,
  };
};

export const getCurrentItemFill = (
  appState: Pick<AppState, "currentItemFillStyle" | "currentItemFillGradient">,
): Pick<ExcalidrawElement, "fillStyle" | "fillGradient"> =>
  appState.currentItemFillStyle === "gradient"
    ? {
        fillStyle: appState.currentItemFillStyle,
        fillGradient: appState.currentItemFillGradient,
      }
    : { fillStyle: appState.currentItemFillStyle };

export const withFillPaint = <Paint>(
  drawable: Drawable,
  paint: Paint | null,
): Drawable =>
  paint === null
    ? drawable
    : {
        ...drawable,
        options: { ...drawable.options, fill: paint as unknown as string },
      };

export const createCanvasFillGradient = (
  context: CanvasRenderingContext2D,
  element: ExcalidrawElement,
  isDarkMode: boolean,
): CanvasGradient | null => {
  const gradient = getFillGradient(element, isDarkMode);
  if (!gradient) {
    return null;
  }
  const canvasGradient =
    gradient.type === "radial"
      ? context.createRadialGradient(
          gradient.cx,
          gradient.cy,
          0,
          gradient.cx,
          gradient.cy,
          gradient.r,
        )
      : context.createLinearGradient(
          gradient.x1,
          gradient.y1,
          gradient.x2,
          gradient.y2,
        );
  canvasGradient.addColorStop(0, gradient.colors[0]);
  canvasGradient.addColorStop(1, gradient.colors[1]);
  return canvasGradient;
};
