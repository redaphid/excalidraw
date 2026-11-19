import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_PICKS,
  DEFAULT_STICKY_NOTE_BG,
  THEME,
  removeDarkModeFilter,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { CssTheme } from "../../cssTheme";
import type { AppState } from "../../types";

/** the editor's selection color, the accent of a board without a theme */
const DEFAULT_ACCENT = "#6965db";

/** The colors a theme gives new elements, as stored in the scene. */
export type ThemeInks = Readonly<{
  ink: string;
  accent: string;
  /** the stroke swatches after the ink, in the theme's palette order */
  palette: readonly string[];
  notePaper: string;
  noteInk: string;
  canvas: string;
  fillStyle: ExcalidrawElement["fillStyle"];
}>;

/**
 * Reads the inks from the active theme the way draw's `roleStyle` reads them
 * from the stylesheet `generateThemeCss` writes: the accent is
 * `--color-selection`, the palette is `--color-picks-stroke` after the ink,
 * and the canvas, note paper and fill are the theme's. On a dark canvas the
 * accent and canvas are the colors that display as the theme's.
 */
export const getThemeInks = (
  theme: CssTheme,
  appState: Pick<AppState, "viewBackgroundColor">,
  canvasMode: AppState["theme"],
): ThemeInks => {
  const stored = (color: string) =>
    canvasMode === THEME.DARK && color !== COLOR_PALETTE.transparent
      ? removeDarkModeFilter(color)
      : color;
  const picks = theme.appState.colorTopPicks?.elementStroke ?? [
    ...DEFAULT_ELEMENT_STROKE_PICKS,
  ];
  const ink = theme.appState.currentItemStrokeColor ?? picks[0];
  return {
    ink,
    accent: stored(theme.canvas.selectionColor ?? DEFAULT_ACCENT),
    palette: picks.slice(1),
    notePaper:
      theme.appState.currentItemStickynoteBackgroundColor ??
      DEFAULT_STICKY_NOTE_BG,
    noteInk: theme.appState.currentItemStickynoteStrokeColor ?? ink,
    canvas: theme.canvas.background
      ? stored(theme.canvas.background)
      : appState.viewBackgroundColor,
    fillStyle: theme.appState.currentItemFillStyle ?? "solid",
  };
};

/** draw's MCP style roles, in the order the palette shows them */
export const STYLE_ROLES = [
  "service",
  "data",
  "async",
  "note",
  "error",
  "healthy",
  "assumed",
] as const;

export type StyleRole = typeof STYLE_ROLES[number];

export type RoleStyle = Readonly<
  Pick<
    ExcalidrawElement,
    "strokeColor" | "backgroundColor" | "fillStyle" | "strokeStyle"
  >
>;

/** which ink and line each role takes; the same table as draw's `ROLES` */
const ROLES: Record<
  StyleRole,
  Readonly<{
    color: "accent" | "data" | "note" | "error" | "healthy" | "ink";
    strokeStyle: "solid" | "dashed";
  }>
> = {
  service: { color: "accent", strokeStyle: "solid" },
  data: { color: "data", strokeStyle: "solid" },
  async: { color: "accent", strokeStyle: "dashed" },
  note: { color: "note", strokeStyle: "solid" },
  error: { color: "error", strokeStyle: "solid" },
  healthy: { color: "healthy", strokeStyle: "solid" },
  assumed: { color: "ink", strokeStyle: "dashed" },
};

/** a role's stroke, fill and line, as draw resolves it for its agents */
export const getRoleStyle = (role: StyleRole, inks: ThemeInks): RoleStyle => {
  const colors = {
    accent: inks.accent,
    data: inks.palette[2] ?? inks.accent,
    note: inks.notePaper,
    error: inks.palette[0] ?? inks.accent,
    healthy: inks.palette[1] ?? inks.accent,
    ink: inks.ink,
  };
  const { color, strokeStyle } = ROLES[role];
  return {
    strokeColor: role === "note" ? inks.noteInk : colors[color],
    backgroundColor: role === "note" ? inks.notePaper : inks.canvas,
    fillStyle: inks.fillStyle,
    strokeStyle,
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
