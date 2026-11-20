import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_PICKS,
} from "@excalidraw/common";

import type { CssTheme } from "../../cssTheme";

/** The stroke colors a theme gives new elements. */
export type ThemeInks = Readonly<{
  ink: string;
  /** the stroke swatches after the ink, in the theme's palette order */
  palette: readonly string[];
}>;

/** the theme's ink and stroke swatches (`--color-picks-stroke`) */
export const getThemeInks = (theme: CssTheme): ThemeInks => {
  const picks = theme.appState.colorTopPicks?.elementStroke ?? [
    ...DEFAULT_ELEMENT_STROKE_PICKS,
  ];
  return {
    ink: theme.appState.currentItemStrokeColor ?? picks[0],
    palette: picks.slice(1),
  };
};

const MAX_THEME_COLORS = 9;
export const RECENT_COLOR_SLOTS = 3;

/**
 * The ring's theme colors: the stroke swatches, then the darkest shade of
 * each palette row, without repeats, white or transparent.
 */
export const getThemeColors = (
  theme: CssTheme,
  inks: ThemeInks,
): readonly string[] => {
  const rows = Object.values(
    theme.palettes.elementStroke ?? DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  ).map((row) => (typeof row === "string" ? row : row[row.length - 1]));
  const seen = new Set<string>();
  return [inks.ink, ...inks.palette, ...rows]
    .filter((color) => {
      const key = color.toLowerCase();
      if (
        seen.has(key) ||
        key === COLOR_PALETTE.transparent ||
        key === COLOR_PALETTE.white
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_THEME_COLORS);
};

/** `color` first in the recent colors, unless the theme already has it */
export const rememberColor = (
  recent: readonly string[],
  color: string,
  themeColors: readonly string[],
): readonly string[] => {
  const key = color.toLowerCase();
  if (
    key === COLOR_PALETTE.transparent ||
    themeColors.some((theirs) => theirs.toLowerCase() === key)
  ) {
    return recent;
  }
  return [color, ...recent.filter((mine) => mine.toLowerCase() !== key)].slice(
    0,
    RECENT_COLOR_SLOTS,
  );
};
