import { FONT_FAMILY } from "@excalidraw/common";

import type {
  Arrowhead,
  FillStyle,
  FontFamilyValues,
  StrokeRoundness,
  StrokeStyle,
  StrokeVariability,
} from "@excalidraw/element/types";
import type { StrokeWidthKey } from "@excalidraw/common";

import type { AppState } from "./types";

/**
 * Colors the editor paints on its canvases around the user's elements. Each
 * field is optional; the renderers fall back to their built-in values.
 */
export type CanvasTheme = Readonly<{
  /** painted instead of the default (`#ffffff`) `viewBackgroundColor`; a
   * scene with another background keeps it */
  background?: string;
  gridColor?: string;
  gridBoldColor?: string;
  /** `dashed` (the default) or `solid` minor grid lines */
  gridStyle?: "dashed" | "solid";
  selectionColor?: string;
  /** fill of the resize and rotation handles */
  handleFill?: string;
  frameColor?: string;
}>;

/** The appState fields a theme may seed: new-element defaults and swatches. */
export type CssThemeAppState = Partial<
  Pick<
    AppState,
    | "currentItemStrokeColor"
    | "currentItemBackgroundColor"
    | "currentItemFillStyle"
    | "currentItemStrokeWidthKey"
    | "currentItemStrokeStyle"
    | "currentItemRoughness"
    | "currentItemRoundness"
    | "currentItemFontFamily"
    | "currentItemFontSize"
    | "currentItemStartArrowhead"
    | "currentItemEndArrowhead"
    | "currentItemArrowType"
    | "currentItemStrokeVariability"
    | "currentItemFreedrawStrokeWidth"
  >
> & {
  /** merged over the user's pins: the lists a theme leaves out are kept */
  colorTopPicks?: Partial<AppState["colorTopPicks"]>;
};

export type CssTheme = Readonly<{
  canvas: CanvasTheme;
  appState: CssThemeAppState;
}>;

export const EMPTY_CSS_THEME: CssTheme = Object.freeze({
  canvas: Object.freeze({}),
  appState: Object.freeze({}),
});

const ARROWHEADS: readonly Arrowhead[] = [
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type ReadProperty = (name: string) => string;

const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2");

const oneOf =
  <T extends string>(options: readonly T[]) =>
  (value: string): T | undefined =>
    (options as readonly string[]).includes(value) ? (value as T) : undefined;

/** element colors are stored in the scene, so only hex (or transparent) */
const elementColor = (value: string) =>
  HEX_COLOR.test(value) || value === "transparent" ? value : undefined;

const positiveNumber = (value: string) => {
  const number = Number(value);
  return value !== "" && Number.isFinite(number) && number > 0
    ? number
    : undefined;
};

const roughness = (value: string) => {
  const number = Number(value);
  return value !== "" && [0, 1, 2].includes(number) ? number : undefined;
};

const fontFamily = (value: string): FontFamilyValues | undefined => {
  if (value in FONT_FAMILY) {
    return FONT_FAMILY[value as keyof typeof FONT_FAMILY];
  }
  const id = Number(value);
  return (Object.values(FONT_FAMILY) as number[]).includes(id)
    ? (id as FontFamilyValues)
    : undefined;
};

/** `none` clears the arrowhead */
const arrowhead = (value: string): Arrowhead | null | undefined =>
  value === "none" ? null : oneOf(ARROWHEADS)(value);

const colorList = (value: string) => {
  const colors = value.split(/[\s,]+/).filter(Boolean);
  return colors.length && colors.every((color) => elementColor(color))
    ? colors.slice(0, 5)
    : undefined;
};

const definedEntries = <T extends Record<string, unknown>>(record: T) =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Parses the theme's custom properties from the editor container's computed
 * style. Unset or malformed values are left out, so the editor keeps its
 * built-in behavior for them.
 */
export const readCssTheme = (style: {
  getPropertyValue: ReadProperty;
}): CssTheme => {
  const read = (name: string) => unquote(style.getPropertyValue(name).trim());
  const color = (name: string) => read(name) || undefined;

  const strokePicks = colorList(read("--color-picks-stroke"));
  const backgroundPicks = colorList(read("--color-picks-background"));

  const canvas: CanvasTheme = definedEntries({
    background: color("--canvas-background"),
    gridColor: color("--canvas-grid-color"),
    gridBoldColor: color("--canvas-grid-bold-color"),
    gridStyle: oneOf(["dashed", "solid"] as const)(read("--canvas-grid-style")),
    selectionColor: color("--color-selection"),
    handleFill: color("--canvas-handle-fill"),
    frameColor: color("--canvas-frame-color"),
  });

  const appState: CssThemeAppState = definedEntries({
    currentItemStrokeColor: elementColor(read("--element-stroke-color")),
    currentItemBackgroundColor: elementColor(
      read("--element-background-color"),
    ),
    currentItemFillStyle: oneOf<FillStyle>([
      "hachure",
      "cross-hatch",
      "solid",
      "zigzag",
    ])(read("--element-fill-style")),
    currentItemStrokeWidthKey: oneOf<StrokeWidthKey>([
      "thin",
      "medium",
      "bold",
    ])(read("--element-stroke-width")),
    currentItemStrokeStyle: oneOf<StrokeStyle>(["solid", "dashed", "dotted"])(
      read("--element-stroke-style"),
    ),
    currentItemRoughness: roughness(read("--element-roughness")),
    currentItemRoundness: oneOf<StrokeRoundness>(["round", "sharp"])(
      read("--element-roundness"),
    ),
    currentItemFontFamily: fontFamily(read("--element-font-family")),
    currentItemFontSize: positiveNumber(read("--element-font-size")),
    currentItemStartArrowhead: arrowhead(read("--element-start-arrowhead")),
    currentItemEndArrowhead: arrowhead(read("--element-end-arrowhead")),
    currentItemArrowType: oneOf(["sharp", "round", "elbow"] as const)(
      read("--element-arrow-type"),
    ),
    currentItemStrokeVariability: oneOf<StrokeVariability>([
      "variable",
      "constant",
    ])(read("--element-freedraw-variability")),
    currentItemFreedrawStrokeWidth: positiveNumber(
      read("--element-freedraw-width"),
    ),
  });

  if (strokePicks || backgroundPicks) {
    appState.colorTopPicks = definedEntries({
      elementStroke: strokePicks,
      elementBackground: backgroundPicks,
    });
  }

  return { canvas, appState };
};
