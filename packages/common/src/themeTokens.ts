/**
 * Theme tokens: a small JSON description of an editor theme, and the
 * function that turns it into CSS for `<Excalidraw css={...}>`.
 *
 * Pure and isomorphic: no DOM, no Node built-ins, no editor code, so a
 * server (a Cloudflare Worker, an MCP tool) can generate themes too.
 */
import { applyDarkModeFilter, removeDarkModeFilter } from "./colors";

/** Colors are 6-digit hex, written as the user should see them. */
export type ThemeTokens = {
  name: string;
  mode: "light" | "dark";
  description: string;
  canvas: string;
  ink: string;
  accent: string;
  /** element colors besides ink */
  palette: string[];
  /** indexes into `palette` for the four background swatches */
  washes?: number[];
  grid: {
    color: string;
    minor: number;
    major: number;
    style: "solid" | "dashed";
  };
  type: { ui: string; canvas: string; size: number };
  stroke: {
    width: "thin" | "medium" | "bold";
    roughness: 0 | 1 | 2;
    roundness: "sharp" | "round";
    arrowhead: string;
    arrowType: "sharp" | "round";
    fill: "solid" | "hachure" | "cross-hatch" | "zigzag";
  };
  pen: {
    pressure: boolean;
    width: number;
    thinning?: number;
    taper?: number;
    streamline?: number;
  };
  surface: {
    radius: number;
    border: "none" | "hairline" | "bold";
    shadow: "none" | "soft" | "long" | "hard";
    panel?: string;
    active?: string;
  };
  frame: { width: number; alpha: number };
  /** paints the canvas transparent and puts this CSS background behind it */
  backdrop?: string;
  /** CSS appended verbatim; prefix each selector with `:scope ` */
  extra?: string;
};

/** A color the generator changed so that text or ink stays legible. */
export type ThemeWarning = {
  /** the token the color came from, e.g. `ink` or `palette[2]` */
  token: string;
  from: string;
  to: string;
  reason: string;
};

const HEX = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } as const;
const UNIT = { type: "number", minimum: 0, maximum: 1 } as const;

/** JSON Schema (draft 2020-12) for {@link ThemeTokens}. */
export const THEME_TOKENS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Excalidraw theme tokens",
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "mode",
    "description",
    "canvas",
    "ink",
    "accent",
    "palette",
    "grid",
    "type",
    "stroke",
    "pen",
    "surface",
    "frame",
  ],
  properties: {
    $schema: { type: "string" },
    name: { type: "string", minLength: 1 },
    mode: { enum: ["light", "dark"] },
    description: { type: "string" },
    canvas: HEX,
    ink: HEX,
    accent: HEX,
    palette: { type: "array", items: HEX, minItems: 4, maxItems: 12 },
    washes: {
      type: "array",
      items: { type: "integer", minimum: 0 },
      minItems: 4,
      maxItems: 4,
    },
    grid: {
      type: "object",
      additionalProperties: false,
      required: ["color", "minor", "major", "style"],
      properties: {
        color: HEX,
        minor: UNIT,
        major: UNIT,
        style: { enum: ["solid", "dashed"] },
      },
    },
    type: {
      type: "object",
      additionalProperties: false,
      required: ["ui", "canvas", "size"],
      properties: {
        ui: { type: "string" },
        canvas: {
          enum: [
            "Excalifont",
            "Virgil",
            "Nunito",
            "Lilita One",
            "Comic Shanns",
            "Liberation Sans",
            "Cascadia",
            "Assistant",
            "Helvetica",
          ],
        },
        size: { type: "number", exclusiveMinimum: 0 },
      },
    },
    stroke: {
      type: "object",
      additionalProperties: false,
      required: [
        "width",
        "roughness",
        "roundness",
        "arrowhead",
        "arrowType",
        "fill",
      ],
      properties: {
        width: { enum: ["thin", "medium", "bold"] },
        roughness: { enum: [0, 1, 2] },
        roundness: { enum: ["sharp", "round"] },
        arrowhead: {
          enum: [
            "arrow",
            "bar",
            "circle",
            "circle_outline",
            "triangle",
            "triangle_outline",
            "diamond",
            "diamond_outline",
          ],
        },
        arrowType: { enum: ["sharp", "round"] },
        fill: { enum: ["solid", "hachure", "cross-hatch", "zigzag"] },
      },
    },
    pen: {
      type: "object",
      additionalProperties: false,
      required: ["pressure", "width"],
      properties: {
        pressure: { type: "boolean" },
        width: { type: "number", exclusiveMinimum: 0, maximum: 4 },
        thinning: { type: "number", minimum: -1, maximum: 1 },
        taper: { type: "number", minimum: 0 },
        streamline: UNIT,
      },
    },
    surface: {
      type: "object",
      additionalProperties: false,
      required: ["radius", "border", "shadow"],
      properties: {
        radius: { type: "number", minimum: 0 },
        border: { enum: ["none", "hairline", "bold"] },
        shadow: { enum: ["none", "soft", "long", "hard"] },
        panel: HEX,
        active: HEX,
      },
    },
    frame: {
      type: "object",
      additionalProperties: false,
      required: ["width", "alpha"],
      properties: {
        width: { type: "number", exclusiveMinimum: 0 },
        alpha: UNIT,
      },
    },
    backdrop: { type: "string" },
    extra: { type: "string" },
  },
} as const;

type RGB = [number, number, number];

const rgb = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (color: RGB) =>
  `#${color
    .map((value) =>
      Math.round(Math.max(0, Math.min(255, value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const mix = (a: string, b: string, t: number) => {
  const [from, to] = [rgb(a), rgb(b)];
  return toHex(from.map((value, i) => value + (to[i] - value) * t) as RGB);
};
const rgba = (color: string, alpha: number) =>
  `rgba(${rgb(color).join(", ")}, ${alpha})`;

const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2 contrast ratio of two hex colors */
export const contrastRatio = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

const SHADOWS: Record<
  ThemeTokens["surface"]["shadow"],
  (ink: string) => string
> = {
  none: (ink) => `0 0 0 1px ${rgba(ink, 0.14)}`,
  soft: (ink) =>
    `0 0 0 1px ${rgba(ink, 0.1)}, 0 10px 28px -14px ${rgba(ink, 0.3)}`,
  long: (ink) =>
    `0 0 0 1px ${rgba(ink, 0.12)}, 26px 30px 44px -20px ${rgba(ink, 0.38)}`,
  hard: (ink) => `0 0 0 2px ${ink}, 5px 5px 0 2px ${ink}`,
};

const STROKE_SHADES = [0.82, 0.62, 0.42, 0.2, 0];
const FILL_WASH = 0.68;

/**
 * Turns tokens into a stylesheet for the `css` prop. Derives panels, states,
 * borders, shadows, shade ramps, swatches and palettes, and moves any color
 * that would make text or ink illegible until it passes WCAG contrast,
 * reporting each move as a warning.
 */
export const generateThemeCss = (
  tokens: ThemeTokens,
): { css: string; warnings: ThemeWarning[] } => {
  const warnings: ThemeWarning[] = [];
  const dark = tokens.mode === "dark";
  // dark mode shows element colors through a filter, so store the inverse
  const store = (color: string) =>
    dark && color !== "transparent" ? removeDarkModeFilter(color) : color;
  const shown = (color: string) => (dark ? applyDarkModeFilter(color) : color);

  /**
   * moves `color` away from `background` until the pair reaches `ratio`;
   * reported against `token` when the tokens caused it, silent (`null`) for
   * colors the generator derived itself
   */
  const legible = (
    token: string | null,
    color: string,
    background: string,
    ratio: number,
    purpose: string,
  ) => {
    const target = luminance(background) > 0.4 ? "#000000" : "#ffffff";
    let result = color;
    for (
      let t = 0.05;
      contrastRatio(result, background) < ratio && t <= 1;
      t += 0.05
    ) {
      result = mix(color, target, t);
    }
    if (result !== color && token) {
      warnings.push({
        token,
        from: color,
        to: result,
        reason: `${purpose}: ${contrastRatio(color, background).toFixed(
          2,
        )}:1 on ${background}, needs ${ratio}:1`,
      });
    }
    return result;
  };

  const { canvas, surface } = tokens;
  const panel = surface.panel ?? mix(canvas, "#ffffff", dark ? 0.04 : 0.35);
  const input = mix(panel, dark ? "#000000" : "#ffffff", 0.35);
  const ink = legible("ink", tokens.ink, panel, 7, "UI text on panels");
  const muted = legible(
    null,
    mix(ink, panel, 0.45),
    panel,
    4.5,
    "secondary text on panels",
  );
  // the hint under the toolbar sits on the canvas, not a panel
  const hint = legible(null, mix(ink, canvas, 0.45), canvas, 4.5, "hint text");
  const hover = mix(panel, ink, 0.06);
  const active = surface.active ?? mix(panel, tokens.accent, dark ? 0.3 : 0.22);
  // the selected tool's icon, and the help dialog's keycaps (same surface)
  const onActive = legible(
    surface.active ? "surface.active" : "accent",
    ink,
    active,
    4.5,
    "text on the selected state",
  );
  const border =
    surface.border === "bold"
      ? ink
      : mix(panel, ink, surface.border === "none" ? 0.08 : 0.16);
  const accent = legible(
    "accent",
    tokens.accent,
    canvas,
    3,
    "selection on the canvas",
  );
  const primary = dark ? accent : ink;

  // a board keeps ink drawn under other themes: a canvas of the opposite
  // lightness to the mode can hide all of it
  const canvasIsDark = luminance(canvas) < 0.18;
  if (canvasIsDark !== dark) {
    warnings.push({
      token: "mode",
      from: tokens.mode,
      to: tokens.mode,
      reason: dark
        ? "dark mode on a light canvas: ink drawn under other themes displays light and may be invisible"
        : "light mode on a dark canvas: ink drawn under other themes (black by default) may be invisible",
    });
  }

  const elementInk = legible("ink", tokens.ink, canvas, 7, "ink on the canvas");
  const inkShown = shown(store(elementInk));
  // the first four palette colors are the stroke swatches: their lines must
  // show. Only the stroke shades move; fills keep the token's hue.
  const lineColors = tokens.palette.map((color, i) =>
    i < 4
      ? legible(`palette[${i}]`, color, canvas, 3, "lines on the canvas")
      : color,
  );
  const hues = [elementInk, ...tokens.palette];
  const lineHues = [elementInk, ...lineColors];
  if (dark) {
    hues.forEach((color, i) => {
      const displayed = shown(store(color));
      const [a, b] = [rgb(color), rgb(displayed)];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 40) {
        warnings.push({
          token: i ? `palette[${i - 1}]` : "ink",
          from: color,
          to: displayed,
          reason:
            "dark mode's color filter cannot display this color; elements show it as the `to` color",
        });
      }
    });
  }
  const ramp = (color: string, steps: number[]) =>
    steps.map((t) => store(mix(color, canvas, t)));
  const strokeEntries = lineHues.map((hue) => ramp(hue, STROKE_SHADES));
  // shade 1 is the wash under ink labels: paled until the label reads
  const fillEntries = hues.map((hue, i) => {
    let wash = FILL_WASH;
    while (
      wash < 0.95 &&
      contrastRatio(inkShown, shown(store(mix(hue, canvas, wash)))) < 4.5
    ) {
      wash += 0.03;
    }
    if (wash > FILL_WASH && i > 0) {
      warnings.push({
        token: `palette[${i - 1}]`,
        from: mix(hue, canvas, FILL_WASH),
        to: mix(hue, canvas, wash),
        reason: "the background wash was too strong for ink labels",
      });
    }
    return ramp(hue, [Math.max(0.86, wash + 0.12), wash, 0.48, 0.24, 0]);
  });
  const washes = (tokens.washes ?? [0, 1, 2, 3]).map(
    (i) => fillEntries[i + 1][1],
  );

  const list = (entries: string[][]) =>
    entries.map((entry) => entry.join(" ")).join(",\n    ");
  const shadow =
    surface.border === "bold" && surface.shadow !== "hard"
      ? `0 0 0 2px ${ink}`
      : SHADOWS[surface.shadow](ink);
  const radius = `${surface.radius}px`;
  const { pen } = tokens;
  const optional = (name: string, value: number | undefined) =>
    value === undefined ? "" : `\n  ${name}: ${value};`;

  const css = `/* ${tokens.name}. mode: ${tokens.mode} */
/*
${tokens.description.replace(/(.{1,72})(\s|$)/g, " * $1\n").trimEnd()}
 *
 * Generated from theme tokens; edit the tokens, not this file.
 */
:scope,
:scope.theme--dark {
  --canvas-background: ${tokens.backdrop ? "transparent" : canvas};
  --canvas-grid-color: ${rgba(tokens.grid.color, tokens.grid.minor)};
  --canvas-grid-bold-color: ${rgba(tokens.grid.color, tokens.grid.major)};
  --canvas-grid-style: ${tokens.grid.style};
  --canvas-handle-fill: ${panel};
  --canvas-frame-color: ${rgba(elementInk, tokens.frame.alpha)};
  --canvas-frame-width: ${tokens.frame.width};
  --canvas-frame-name-color: ${muted};
  --color-selection: ${accent};

  --element-stroke-color: ${store(elementInk)};
  --element-background-color: transparent;
  --element-fill-style: ${tokens.stroke.fill};
  --element-stroke-width: ${tokens.stroke.width};
  --element-roughness: ${tokens.stroke.roughness};
  --element-roundness: ${tokens.stroke.roundness};
  --element-arrow-type: ${tokens.stroke.arrowType};
  --element-start-arrowhead: none;
  --element-end-arrowhead: ${tokens.stroke.arrowhead};
  --element-font-family: "${tokens.type.canvas}";
  --element-font-size: ${tokens.type.size};
  --element-freedraw-variability: ${pen.pressure ? "variable" : "constant"};
  --element-freedraw-width: ${pen.width};${optional(
    "--element-freedraw-thinning",
    pen.thinning,
  )}${optional("--element-freedraw-taper", pen.taper)}${optional(
    "--element-freedraw-streamline",
    pen.streamline,
  )}
  --color-picks-stroke: ${strokeEntries
    .slice(0, 5)
    .map((entry) => entry[4])
    .join(" ")};
  --color-picks-background: transparent ${washes.join(" ")};
  --color-palette-stroke: ${list(strokeEntries)};
  --color-palette-background: transparent,
    ${list(fillEntries.slice(1))};

  --ui-font: "${tokens.type.ui}", system-ui, sans-serif;
  --text-primary-color: ${ink};
  --color-on-surface: ${ink};
  --icon-fill-color: ${ink};
  --popup-text-color: ${ink};
  --keybinding-color: ${muted};
  --color-gray-60: ${muted};
  --input-label-color: ${muted};

  --island-bg-color: ${panel};
  --island-bg-color-alt: ${panel};
  --popup-bg-color: ${panel};
  --sidebar-bg-color: ${panel};
  --default-bg-color: ${panel};
  --popup-secondary-bg-color: ${hover};
  --input-bg-color: ${input};
  --input-border-color: ${border};
  --input-hover-bg-color: ${hover};

  --color-surface-lowest: ${input};
  --color-surface-low: ${hover};
  --color-surface-mid: ${hover};
  --color-surface-high: ${hover};
  --color-surface-primary-container: ${active};
  --color-on-primary-container: ${onActive};

  --color-primary: ${primary};
  --color-primary-darker: ${primary};
  --color-primary-darkest: ${primary};
  --color-primary-hover: ${primary};
  --color-primary-light: ${active};
  --color-primary-light-darker: ${active};
  --color-brand-hover: ${primary};
  --color-brand-active: ${primary};
  --select-highlight-color: ${accent};
  --focus-highlight-color: ${accent};

  --button-hover-bg: ${hover};
  --button-active-bg: ${active};
  --button-active-border: ${primary};
  --button-gray-1: ${hover};
  --button-gray-2: ${hover};
  --button-gray-3: ${active};
  --default-border-color: ${border};
  --dialog-border-color: ${border};
  --sidebar-border-color: ${border};
  --color-border-outline: ${muted};
  --color-border-outline-variant: ${border};

  --border-radius-md: ${radius};
  --border-radius-lg: ${radius};
  --shadow-island: ${shadow};
  --shadow-island-stronger: ${shadow};
  --modal-shadow: ${shadow};
  --sidebar-shadow: ${shadow};
  --library-dropdown-shadow: ${shadow};
  --overlay-bg-color: ${rgba(canvas, 0.72)};
  --color-slider-track: ${border};
  --color-slider-thumb: ${primary};
}

:scope .HintViewer {
  --color-gray-40: ${hint};
}

:scope .HelpDialog__key {
  color: ${onActive};
}

:scope [data-radix-popper-content-wrapper] .Island {
  background: ${panel};
}
${
  tokens.backdrop
    ? `
:scope {
  background: ${tokens.backdrop};
}
`
    : ""
}${tokens.extra ? `\n${tokens.extra.trim()}\n` : ""}`;

  return { css, warnings };
};
