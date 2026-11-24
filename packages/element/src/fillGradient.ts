import {
  applyDarkModeFilter,
  DEFAULT_FILL_GRADIENT,
  isTransparent,
} from "@excalidraw/common";

import { isFreeDrawElement, isLinearElement } from "./typeChecks";

import type { ExcalidrawElement } from "./types";

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
