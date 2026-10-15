import { FRAME_STYLE, THEME } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import type { CanvasTheme } from "./cssTheme";

/** the editor's UI font, for a theme that does not name one */
const DEFAULT_NAME_FONT_FAMILY =
  "Assistant, system-ui, BlinkMacSystemFont, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

/** How frames look on screen: the theme's values over the built-in style.
 * Widths, radii and sizes are in screen pixels. */
export const getFrameStyle = (
  canvasTheme: CanvasTheme | undefined,
  theme: Theme,
) => ({
  color:
    canvasTheme?.frameColor ??
    (theme === THEME.DARK
      ? FRAME_STYLE.strokeColorDarkTheme
      : FRAME_STYLE.strokeColor),
  /** the editor draws wireframe-to-code frames in its own mint */
  magicColor:
    theme === THEME.LIGHT
      ? FRAME_STYLE.magicStrokeColor
      : FRAME_STYLE.magicStrokeColorDarkTheme,
  width: canvasTheme?.frameWidth ?? FRAME_STYLE.strokeWidth,
  radius: canvasTheme?.frameRadius ?? FRAME_STYLE.radius,
  nameColor:
    canvasTheme?.frameNameColor ??
    (theme === THEME.DARK
      ? FRAME_STYLE.nameColorDarkTheme
      : FRAME_STYLE.nameColorLightTheme),
  nameSize: canvasTheme?.frameNameSize ?? FRAME_STYLE.nameFontSize,
  nameFontFamily: canvasTheme?.frameNameFontFamily ?? DEFAULT_NAME_FONT_FAMILY,
});
