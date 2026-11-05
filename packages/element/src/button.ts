import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type { ExcalidrawButtonElement, ExcalidrawTextElement } from "./types";

const ICON_TO_FONT_SIZE = 0.8;
const ICON_GAP_TO_FONT_SIZE = 0.4;
const UNLABELLED_ICON_TO_SIZE = 0.4;
const ICON_EDGE_MARGIN_TO_SIZE = 0.25;
const ICON_CORNER_TO_SIZE = 0.14;

/**
 * How far right the label's box starts to make room for the icon. Taking this
 * off the box's left edge centers the icon and label as one group.
 */
export const getButtonLabelInset = (fontSize: number) =>
  fontSize * (ICON_TO_FONT_SIZE + ICON_GAP_TO_FONT_SIZE);

const getIconBox = (
  button: ExcalidrawButtonElement,
  label: ExcalidrawTextElement | null,
) => {
  if (!label) {
    const size =
      Math.min(button.width, button.height) * UNLABELLED_ICON_TO_SIZE;
    return {
      x: (button.width - size) / 2,
      y: (button.height - size) / 2,
      size,
    };
  }
  const size = label.fontSize * ICON_TO_FONT_SIZE;
  const [labelCenterX] = pointRotateRads(
    pointFrom<GlobalPoint>(
      label.x + label.width / 2,
      label.y + label.height / 2,
    ),
    pointFrom<GlobalPoint>(
      button.x + button.width / 2,
      button.y + button.height / 2,
    ),
    -button.angle as Radians,
  );
  const labelLeft = labelCenterX - label.width / 2 - button.x;
  return {
    x: Math.max(
      size * ICON_EDGE_MARGIN_TO_SIZE,
      labelLeft - label.fontSize * ICON_GAP_TO_FONT_SIZE - size,
    ),
    y: (button.height - size) / 2,
    size,
  };
};

/**
 * The play triangle, relative to the unrotated button's top left. Stroked at
 * `cornerWidth` with round joins over its fill, for soft corners.
 */
export const getButtonIcon = (
  button: ExcalidrawButtonElement,
  label: ExcalidrawTextElement | null,
) => {
  const { x, y, size } = getIconBox(button, label);
  const inset = size * ICON_CORNER_TO_SIZE;
  return {
    corners: [
      [x + inset, y + inset],
      [x + size - inset, y + size / 2],
      [x + inset, y + size - inset],
    ] as const,
    cornerWidth: inset,
  };
};
