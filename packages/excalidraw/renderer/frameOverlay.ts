import { FRAME_STYLE } from "@excalidraw/common";

import { getFrameLikeTitle } from "@excalidraw/element";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import { frameNameOpacities } from "../frameNameVisibility";
import { getFrameStyle } from "../frameStyle";

import type { CanvasTheme } from "../cssTheme";
import type { AppState } from "../types";

export type FrameOverlayAppState = Pick<
  AppState,
  | "zoom"
  | "scrollX"
  | "scrollY"
  | "width"
  | "height"
  | "frameRendering"
  | "theme"
>;

export type FrameOverlayOptions = {
  frames: readonly ExcalidrawFrameLikeElement[];
  appState: FrameOverlayAppState;
  /** the editor's `cssTheme.canvas`, or `readCssTheme(style).canvas` */
  canvasTheme?: CanvasTheme;
  /** canvas pixels per CSS pixel */
  dpr?: number;
  /** frames whose names show at full strength and untruncated, as the editor
   * pins the selected, hovered and edited frames */
  pinnedIds?: ReadonlySet<string>;
};

const ELLIPSIS = "…";

const truncate = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  let end = text.length;
  while (
    end > 0 &&
    context.measureText(text.slice(0, end) + ELLIPSIS).width > maxWidth
  ) {
    end--;
  }
  return end ? text.slice(0, end) + ELLIPSIS : "";
};

/**
 * Strokes frame outlines and draws frame names in screen space at the
 * current zoom, as the editor shows them: line width, corner radius and name
 * size stay constant in screen pixels, colors come from the theme, and names
 * crowd and hide by the same rules as the editor's DOM labels.
 *
 * For hosts that draw frames on their own layer. The context's transform is
 * replaced with `dpr` scaling for the call and restored after; the caller
 * clears the canvas.
 */
export const renderFrameOverlay = (
  context: CanvasRenderingContext2D,
  { frames, appState, canvasTheme, dpr = 1, pinnedIds }: FrameOverlayOptions,
) => {
  const { frameRendering, zoom, scrollX, scrollY, width, height } = appState;
  if (!frameRendering.enabled) {
    return;
  }
  const style = getFrameStyle(canvasTheme, appState.theme);
  const font = `${style.nameSize}px ${style.nameFontFamily}`;

  const visible = frames
    .filter((frame) => !frame.isDeleted)
    .map((frame) => ({
      frame,
      name: getFrameLikeTitle(frame),
      x: (frame.x + scrollX) * zoom.value,
      y: (frame.y + scrollY) * zoom.value,
      width: frame.width * zoom.value,
      height: frame.height * zoom.value,
    }))
    .filter(
      (f) =>
        f.x < width && f.y < height && f.x + f.width > 0 && f.y + f.height > 0,
    );

  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (frameRendering.outline) {
    context.strokeStyle = style.color;
    context.lineWidth = style.width;
    for (const f of visible) {
      context.beginPath();
      if (style.radius && context.roundRect) {
        context.roundRect(f.x, f.y, f.width, f.height, style.radius);
      } else {
        context.rect(f.x, f.y, f.width, f.height);
      }
      context.stroke();
    }
  }

  if (frameRendering.name) {
    context.font = font;
    context.fillStyle = style.nameColor;
    context.textBaseline = "bottom";
    const pinned = pinnedIds ?? new Set<string>();
    const opacities = frameNameOpacities(
      visible.map((f) => ({
        id: f.frame.id,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        labelWidth: context.measureText(f.name).width,
      })),
      { width, height },
      pinned,
    );
    // the bottom of the DOM label's line box
    const bottom =
      FRAME_STYLE.nameOffsetY +
      (style.nameSize * (FRAME_STYLE.nameLineHeight - 1)) / 2;
    for (const f of visible) {
      const opacity = opacities.get(f.frame.id) ?? 0;
      if (!opacity) {
        continue;
      }
      context.globalAlpha = opacity;
      context.fillText(
        pinned.has(f.frame.id) ? f.name : truncate(context, f.name, f.width),
        f.x,
        f.y - bottom,
      );
    }
  }

  context.restore();
};
