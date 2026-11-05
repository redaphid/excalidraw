import type { ExcalidrawButtonElement } from "./types";

const ICON_TO_BUTTON = 0.3;
const UNLABELLED_ICON_TO_BUTTON = 0.4;
const ICON_MARGIN_TO_ICON = 0.7;
const LABEL_GAP_TO_ICON = 0.4;
const ICON_CORNER_TO_ICON = 0.14;

const hasLabel = (button: ExcalidrawButtonElement) =>
  !!button.boundElements?.some(({ type }) => type === "text");

const getIconSize = (button: ExcalidrawButtonElement) =>
  Math.min(button.width, button.height) *
  (hasLabel(button) ? ICON_TO_BUTTON : UNLABELLED_ICON_TO_BUTTON);

/** Where the label may start, relative to the unrotated button's left edge. */
export const getButtonLabelLeft = (button: ExcalidrawButtonElement) =>
  getIconSize(button) * (ICON_MARGIN_TO_ICON + 1 + LABEL_GAP_TO_ICON);

/**
 * The play triangle, relative to the unrotated button's top left. Stroked at
 * `cornerWidth` with round joins over its fill, for soft corners.
 *
 * Worked out from the button alone, because a renderer can be handed the button
 * without its label, as a tile that lies inside the button is.
 */
export const getButtonIcon = (button: ExcalidrawButtonElement) => {
  const size = getIconSize(button);
  const x = hasLabel(button)
    ? size * ICON_MARGIN_TO_ICON
    : (button.width - size) / 2;
  const y = (button.height - size) / 2;
  const inset = size * ICON_CORNER_TO_ICON;
  return {
    corners: [
      [x + inset, y + inset],
      [x + size - inset, y + size / 2],
      [x + inset, y + size - inset],
    ] as const,
    cornerWidth: inset,
  };
};
