import { getElementDetailScale } from "./authoring";

import type { ExcalidrawButtonElement } from "./types";

const ICON_SLOT = 56;
const ICON_SIZE = 30;
const ICON_MARGIN_TO_SLOT = 0.2;
const SLOT_TO_WIDTH = 0.4;
const ICON_TO_SLOT = 0.6;
const ICON_TO_HEIGHT = 0.6;
const UNLABELLED_ICON_TO_BUTTON = 0.4;
const ICON_CORNER_TO_ICON = 0.14;

const hasLabel = (button: ExcalidrawButtonElement) =>
  !!button.boundElements?.some(({ type }) => type === "text");

/** The room kept for the icon on a button wide enough to give all of it. */
export const getButtonIconSlot = (button: ExcalidrawButtonElement) =>
  ICON_SLOT * getElementDetailScale(button);

/**
 * Where the label may start, relative to the unrotated button's left edge.
 *
 * It depends on no height, because a label that wraps taller grows its button,
 * and that must not change the room it wrapped to.
 */
export const getButtonLabelLeft = (button: ExcalidrawButtonElement) =>
  Math.min(getButtonIconSlot(button), button.width * SLOT_TO_WIDTH);

/**
 * The play triangle, relative to the unrotated button's top left. Stroked at
 * `cornerWidth` with round joins over its fill, for soft corners.
 *
 * Worked out from the button alone, because a renderer can be handed the button
 * without its label, as a tile that lies inside the button is.
 */
export const getButtonIcon = (button: ExcalidrawButtonElement) => {
  const slot = getButtonLabelLeft(button);
  const size = hasLabel(button)
    ? Math.min(
        ICON_SIZE * getElementDetailScale(button),
        slot * ICON_TO_SLOT,
        button.height * ICON_TO_HEIGHT,
      )
    : Math.min(button.width, button.height) * UNLABELLED_ICON_TO_BUTTON;
  const x = hasLabel(button)
    ? slot * ICON_MARGIN_TO_SLOT
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
