import React from "react";

import {
  COLOR_PALETTE,
  DEFAULT_FILL_GRADIENT,
  FONT_FAMILY,
  FONT_SIZES,
  getStrokeWidthByKey,
  STROKE_WIDTH_KEYS,
} from "@excalidraw/common";
import { getAuthoringScale, hasFillStyle } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  actionChangeArrowType,
  actionChangeArrowhead,
  actionChangeFillGradient,
  actionChangeFillStyle,
  actionChangeFontFamily,
  actionChangeFontSize,
  actionChangeFreedrawMode,
  actionChangeRoundness,
  actionChangeSloppiness,
  actionChangeStrokeStyle,
  actionChangeStrokeWidth,
  actionChangeTextAlign,
} from "../../actions/actionProperties";
import {
  ArrowheadArrowIcon,
  ArrowheadBarIcon,
  ArrowheadCircleIcon,
  ArrowheadDiamondIcon,
  ArrowheadNoneIcon,
  ArrowheadTriangleIcon,
  EdgeRoundIcon,
  EdgeSharpIcon,
  FillCrossHatchIcon,
  FillGradientIcon,
  FillGradientRadialIcon,
  FillHachureIcon,
  FillSolidIcon,
  FillZigZagIcon,
  FontSizeExtraLargeIcon,
  FontSizeLargeIcon,
  FontSizeMediumIcon,
  FontSizeSmallIcon,
  SloppinessArchitectIcon,
  SloppinessArtistIcon,
  SloppinessCartoonistIcon,
  StrokeStyleDashedIcon,
  StrokeStyleDottedIcon,
  StrokeWidthBaseIcon,
  StrokeWidthBoldIcon,
  StrokeWidthExtraBoldIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  elbowArrowIcon,
  roundArrowIcon,
  sharpArrowIcon,
  strokeVariabilityConstantIcon,
  strokeVariabilityVariableIcon,
} from "../icons";

import type { Action } from "../../actions/types";
import type { TranslationKeys } from "../../i18n";
import type { AppState } from "../../types";

/** one value a style property can take */
export type StyleOption = Readonly<{
  value: unknown;
  label: TranslationKeys | { text: string };
  icon: React.ReactNode;
}>;

export const STYLE_PROPERTY_IDS = [
  "fillStyle",
  "fillGradientType",
  "fillGradientAngle",
  "fillGradientColor",
  "strokeWidth",
  "strokeStyle",
  "sloppiness",
  "roundness",
  "arrowType",
  "startArrowhead",
  "endArrowhead",
  "fontFamily",
  "fontSize",
  "textAlign",
  "freedrawMode",
] as const;

export type StylePropertyId = typeof STYLE_PROPERTY_IDS[number];

/** a row of the old properties panel: the action its options set, when it
 * shows, and the value in use */
export type StyleProperty = Readonly<{
  id: StylePropertyId;
  label: TranslationKeys;
  action: Action;
  options: readonly StyleOption[];
  /** whether it shows for the selected elements, or for the tool when none */
  applies: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) => boolean;
  /** the value the elements it applies to share, null when they differ;
   * the value for new elements when none is selected */
  current: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) => unknown;
}>;

type Type = string;

const NOT_STROKED = new Set<Type>([
  "text",
  "image",
  "frame",
  "magicframe",
  "selection",
  "lasso",
  "hand",
  "eraser",
  "laser",
  "embeddable",
  "iframe",
]);
const stroked = (type: Type) => !NOT_STROKED.has(type);
const outlined = (type: Type) => stroked(type) && type !== "freedraw";
const rounded = (type: Type) =>
  ["rectangle", "diamond", "line", "image", "embeddable", "iframe"].includes(
    type,
  );
const is = (wanted: Type) => (type: Type) => type === wanted;

const property = <T,>(spec: {
  id: StylePropertyId;
  label: TranslationKeys;
  action: Action;
  on: (type: Type) => boolean;
  options: readonly StyleOption[];
  get: (element: ExcalidrawElement, appState: AppState) => T;
  fallback: (appState: AppState) => T;
}): StyleProperty => ({
  id: spec.id,
  label: spec.label,
  action: spec.action,
  options: spec.options,
  applies: (elements, appState) =>
    elements.length
      ? elements.some((element) => spec.on(element.type))
      : spec.on(appState.activeTool.type),
  current: (elements, appState) => {
    if (!elements.length) {
      return spec.fallback(appState);
    }
    const values = new Set(
      elements
        .filter((element) => spec.on(element.type))
        .map((element) => spec.get(element, appState)),
    );
    return values.size === 1 ? [...values][0] : null;
  },
});

const plain = (
  entries: readonly (readonly [unknown, TranslationKeys, React.ReactNode])[],
): readonly StyleOption[] =>
  entries.map(([value, label, icon]) => ({ value, label, icon }));

const ARROWHEADS = [
  [null, "labels.arrowhead_none", ArrowheadNoneIcon],
  ["arrow", "labels.arrowhead_arrow", ArrowheadArrowIcon],
  ["triangle", "labels.arrowhead_triangle", ArrowheadTriangleIcon],
  ["circle", "labels.arrowhead_circle", ArrowheadCircleIcon],
  ["diamond", "labels.arrowhead_diamond", ArrowheadDiamondIcon],
  ["bar", "labels.arrowhead_bar", ArrowheadBarIcon],
] as const;

const arrowhead = (position: "start" | "end") =>
  property({
    id: position === "start" ? "startArrowhead" : "endArrowhead",
    label: "labels.arrowheads",
    action: actionChangeArrowhead,
    on: is("arrow"),
    options: ARROWHEADS.map(([type, label, Icon]) => ({
      value: { position, type },
      label,
      icon: <Icon flip={position === "start"} />,
    })),
    get: (element) =>
      (position === "start"
        ? (element as { startArrowhead?: unknown }).startArrowhead
        : (element as { endArrowhead?: unknown }).endArrowhead) ?? null,
    fallback: (appState) =>
      position === "start"
        ? appState.currentItemStartArrowhead
        : appState.currentItemEndArrowhead,
  });

const FONTS = ["Excalifont", "Nunito", "Comic Shanns"] as const;

type FillGradient = NonNullable<ExcalidrawElement["fillGradient"]>;

const FILL_GRADIENT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

const FILL_GRADIENT_COLORS = [
  COLOR_PALETTE.white,
  COLOR_PALETTE.black,
  COLOR_PALETTE.red[2],
  COLOR_PALETTE.violet[2],
  COLOR_PALETTE.blue[2],
  COLOR_PALETTE.green[2],
  COLOR_PALETTE.yellow[2],
  COLOR_PALETTE.orange[2],
] as const;

const fillGradientProperty = <K extends keyof FillGradient>(spec: {
  id: StylePropertyId;
  label: TranslationKeys;
  key: K;
  on?: (fillGradient: FillGradient) => boolean;
  options: readonly StyleOption[];
}): StyleProperty => {
  const gradients = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) =>
    (elements.length
      ? elements
          .filter(
            (element) =>
              hasFillStyle(element.type) && element.fillStyle === "gradient",
          )
          .map((element) => element.fillGradient ?? DEFAULT_FILL_GRADIENT)
      : hasFillStyle(appState.activeTool.type) &&
        appState.currentItemFillStyle === "gradient"
      ? [appState.currentItemFillGradient]
      : []
    ).filter((fillGradient) => !spec.on || spec.on(fillGradient));

  return {
    id: spec.id,
    label: spec.label,
    action: actionChangeFillGradient,
    options: spec.options,
    applies: (elements, appState) => gradients(elements, appState).length > 0,
    current: (elements, appState) => {
      const values = new Set(
        gradients(elements, appState).map(
          (fillGradient) => fillGradient[spec.key],
        ),
      );
      return values.size === 1 ? [...values][0] : null;
    },
  };
};

export const STYLE_PROPERTIES: readonly StyleProperty[] = [
  property({
    id: "fillStyle",
    label: "labels.fill",
    action: actionChangeFillStyle,
    on: (type) => hasFillStyle(type as ExcalidrawElement["type"]),
    options: plain([
      ["hachure", "labels.hachure", FillHachureIcon],
      ["cross-hatch", "labels.crossHatch", FillCrossHatchIcon],
      ["solid", "labels.solid", FillSolidIcon],
      ["zigzag", "labels.zigzag", FillZigZagIcon],
      ["gradient", "labels.gradient", FillGradientIcon],
    ]),
    get: (element) => element.fillStyle,
    fallback: (appState) => appState.currentItemFillStyle,
  }),
  fillGradientProperty({
    id: "fillGradientType",
    label: "labels.gradientType",
    key: "type",
    options: [
      {
        value: { type: "linear" },
        label: "labels.gradientType_linear",
        icon: FillGradientIcon,
      },
      {
        value: { type: "radial" },
        label: "labels.gradientType_radial",
        icon: FillGradientRadialIcon,
      },
    ],
  }),
  fillGradientProperty({
    id: "fillGradientAngle",
    label: "labels.gradientAngle",
    key: "angle",
    on: ({ type }) => type === "linear",
    options: FILL_GRADIENT_ANGLES.map((angle) => ({
      value: { angle },
      label: { text: `${angle}°` },
      icon: (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
          <path
            d="M10 16V4M6 8l4-4 4 4"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={`rotate(${angle} 10 10)`}
          />
        </svg>
      ),
    })),
  }),
  fillGradientProperty({
    id: "fillGradientColor",
    label: "labels.gradientColor",
    key: "color",
    options: FILL_GRADIENT_COLORS.map((color) => ({
      value: { color },
      label: { text: color },
      icon: (
        <svg viewBox="0 0 20 20">
          <circle
            cx="10"
            cy="10"
            r="7"
            fill={color}
            stroke="currentColor"
            strokeWidth={1}
          />
        </svg>
      ),
    })),
  }),
  property({
    id: "strokeWidth",
    label: "labels.strokeWidth",
    action: actionChangeStrokeWidth,
    on: outlined,
    options: plain([
      ["thin", "labels.thin", StrokeWidthBaseIcon],
      ["medium", "labels.medium", StrokeWidthBoldIcon],
      ["bold", "labels.bold", StrokeWidthExtraBoldIcon],
    ]),
    get: (element, appState) =>
      STROKE_WIDTH_KEYS.find(
        (key) =>
          Math.abs(
            getStrokeWidthByKey(element.type, key) *
              getAuthoringScale(appState) -
              element.strokeWidth,
          ) <=
          element.strokeWidth * 1e-9,
      ) ?? null,
    fallback: (appState) => appState.currentItemStrokeWidthKey,
  }),
  property({
    id: "strokeStyle",
    label: "labels.strokeStyle",
    action: actionChangeStrokeStyle,
    on: outlined,
    options: plain([
      ["solid", "labels.strokeStyle_solid", StrokeWidthBaseIcon],
      ["dashed", "labels.strokeStyle_dashed", StrokeStyleDashedIcon],
      ["dotted", "labels.strokeStyle_dotted", StrokeStyleDottedIcon],
    ]),
    get: (element) => element.strokeStyle,
    fallback: (appState) => appState.currentItemStrokeStyle,
  }),
  property({
    id: "sloppiness",
    label: "labels.sloppiness",
    action: actionChangeSloppiness,
    on: outlined,
    options: plain([
      [0, "labels.architect", SloppinessArchitectIcon],
      [1, "labels.artist", SloppinessArtistIcon],
      [2, "labels.cartoonist", SloppinessCartoonistIcon],
    ]),
    get: (element) => element.roughness,
    fallback: (appState) => appState.currentItemRoughness,
  }),
  property({
    id: "roundness",
    label: "labels.edges",
    action: actionChangeRoundness,
    on: rounded,
    options: plain([
      ["sharp", "labels.sharp", EdgeSharpIcon],
      ["round", "labels.round", EdgeRoundIcon],
    ]),
    get: (element) => (element.roundness ? "round" : "sharp"),
    fallback: (appState) => appState.currentItemRoundness,
  }),
  property({
    id: "arrowType",
    label: "labels.arrowtypes",
    action: actionChangeArrowType,
    on: is("arrow"),
    options: plain([
      ["sharp", "labels.arrowtype_sharp", sharpArrowIcon],
      ["round", "labels.arrowtype_round", roundArrowIcon],
      ["elbow", "labels.arrowtype_elbowed", elbowArrowIcon],
    ]),
    get: (element) =>
      (element as { elbowed?: boolean }).elbowed
        ? "elbow"
        : element.roundness
        ? "round"
        : "sharp",
    fallback: (appState) => appState.currentItemArrowType,
  }),
  arrowhead("start"),
  arrowhead("end"),
  property({
    id: "fontFamily",
    label: "labels.fontFamily",
    action: actionChangeFontFamily,
    on: is("text"),
    options: FONTS.map((name) => ({
      value: { currentItemFontFamily: FONT_FAMILY[name] },
      label: { text: name },
      icon: null,
    })),
    get: (element) => (element as { fontFamily?: number }).fontFamily ?? null,
    fallback: (appState) => appState.currentItemFontFamily,
  }),
  property({
    id: "fontSize",
    label: "labels.fontSize",
    action: actionChangeFontSize,
    on: is("text"),
    options: plain([
      [FONT_SIZES.sm, "labels.small", FontSizeSmallIcon],
      [FONT_SIZES.md, "labels.medium", FontSizeMediumIcon],
      [FONT_SIZES.lg, "labels.large", FontSizeLargeIcon],
      [FONT_SIZES.xl, "labels.veryLarge", FontSizeExtraLargeIcon],
    ]),
    get: (element, appState) =>
      Number(
        (
          ((element as { fontSize?: number }).fontSize ?? 0) /
          getAuthoringScale(appState)
        ).toPrecision(12),
      ),
    fallback: (appState) => appState.currentItemFontSize,
  }),
  property({
    id: "textAlign",
    label: "labels.textAlign",
    action: actionChangeTextAlign,
    on: is("text"),
    options: plain([
      ["left", "labels.left", TextAlignLeftIcon],
      ["center", "labels.center", TextAlignCenterIcon],
      ["right", "labels.right", TextAlignRightIcon],
    ]),
    get: (element) => (element as { textAlign?: string }).textAlign ?? null,
    fallback: (appState) => appState.currentItemTextAlign,
  }),
  property({
    id: "freedrawMode",
    label: "labels.pressure",
    action: actionChangeFreedrawMode,
    on: is("freedraw"),
    options: plain([
      ["constant", "labels.pressure_constant", strokeVariabilityConstantIcon],
      ["variable", "labels.pressure_variable", strokeVariabilityVariableIcon],
    ]),
    get: (element) =>
      (element as { strokeOptions?: { variability?: string } }).strokeOptions
        ?.variability ?? null,
    fallback: (appState) => appState.currentItemStrokeVariability,
  }),
];

export const getStyleProperty = (id: string) =>
  STYLE_PROPERTIES.find((property) => property.id === id);

/** an option's id in the ring: its value, as text */
export const styleOptionId = ({ value }: StyleOption) =>
  typeof value === "object" && value !== null
    ? String(
        Object.values(value).find((v) => v !== "start" && v !== "end") ??
          "none",
      )
    : String(value);
