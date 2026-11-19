import {
  FREEDRAW_STROKE_WIDTH,
  FREEDRAW_STROKE_WIDTH_RANGE,
} from "@excalidraw/common";
import { clamp } from "@excalidraw/math";

import type { StrokeVariability } from "@excalidraw/element/types";

import type { CssTheme } from "../../cssTheme";
import type { AppState } from "../../types";

export type PenPresetId = "liner" | "pencil" | "brush" | "marker" | "wash";

export type PenPresetState = Pick<
  AppState,
  | "currentItemStrokeVariability"
  | "currentItemFreedrawStrokeWidth"
  | "currentItemOpacity"
  | "currentItemPenOptions"
>;

export type PenPreset = Readonly<{
  id: PenPresetId;
  /** what picking it writes to appState */
  state: PenPresetState;
}>;

/** each preset's width, as a multiple of the theme's pen width */
const WIDTH = { liner: 1, pencil: 1.5, brush: 5, marker: 8, wash: 24 };

const width = (base: number, preset: PenPresetId) =>
  clamp(
    base * WIDTH[preset],
    FREEDRAW_STROKE_WIDTH_RANGE.min,
    FREEDRAW_STROKE_WIDTH_RANGE.max,
  );

/**
 * The pen presets, built from the theme's pen so they share its character:
 * the fine liner is the theme's own pen, and the others scale its width.
 * Without a theme the pen is Excalidraw's thin freedraw width.
 */
export const getPenPresets = (theme: CssTheme): readonly PenPreset[] => {
  const base =
    theme.appState.currentItemFreedrawStrokeWidth ?? FREEDRAW_STROKE_WIDTH.thin;
  const preset = (
    id: PenPresetId,
    variability: StrokeVariability,
    opacity: number,
    penOptions: AppState["currentItemPenOptions"],
  ): PenPreset => ({
    id,
    state: {
      currentItemStrokeVariability: variability,
      currentItemFreedrawStrokeWidth: width(base, id),
      currentItemOpacity: opacity,
      currentItemPenOptions: penOptions,
    },
  });
  return [
    // the theme's pen as it is: its variability, thinning, taper, streamline
    preset(
      "liner",
      theme.appState.currentItemStrokeVariability ?? "constant",
      100,
      null,
    ),
    // light pressure response, a short taper, and little smoothing so the
    // hand's wobble stays
    preset("pencil", "variable", 70, {
      thinning: 0.35,
      taper: 2,
      streamline: 0.15,
    }),
    // strong pressure response and long tapered ends
    preset("brush", "variable", 100, {
      thinning: 0.8,
      taper: 10,
      streamline: 0.5,
    }),
    // an even, slightly see-through line
    preset("marker", "constant", 85, { streamline: 0.6 }),
    // a broad, faint, smooth line for tone
    preset("wash", "constant", 25, { streamline: 0.75 }),
  ];
};

const sameOptions = (
  a: AppState["currentItemPenOptions"],
  b: AppState["currentItemPenOptions"],
) =>
  a === b ||
  (!!a &&
    !!b &&
    a.thinning === b.thinning &&
    a.taper === b.taper &&
    a.streamline === b.streamline);

/** the preset the pen is set to, if any */
export const getActivePenPreset = (
  presets: readonly PenPreset[],
  appState: PenPresetState,
) =>
  presets.find(
    ({ state }) =>
      state.currentItemStrokeVariability ===
        appState.currentItemStrokeVariability &&
      Math.abs(
        state.currentItemFreedrawStrokeWidth -
          appState.currentItemFreedrawStrokeWidth,
      ) < 1e-9 &&
      state.currentItemOpacity === appState.currentItemOpacity &&
      sameOptions(state.currentItemPenOptions, appState.currentItemPenOptions),
  ) ?? null;
