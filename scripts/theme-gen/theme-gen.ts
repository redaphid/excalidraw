/**
 * Writes playground/themes/<id>.css from playground/themes/tokens/<id>.json.
 *
 *   yarn theme:gen architect-parchment [more ids...]
 *   yarn theme:gen --all
 *
 * The tokens name a few colors and choices; this derives the rest (panels,
 * hover and active states, borders, shadows, shade ramps, swatches, picker
 * palettes) and checks WCAG contrast on every text and surface pair it
 * emits, nudging a color until it passes and printing what it changed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyDarkModeFilter, removeDarkModeFilter } from "@excalidraw/common";

type Tokens = {
  name: string;
  mode: "light" | "dark";
  description: string;
  /** displayed colors: what the user sees, in either mode */
  canvas: string;
  ink: string;
  accent: string;
  /** element colors besides ink, 4 to 8 */
  palette: string[];
  /** which of `palette` fill the four quick background swatches */
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
    /** the panel color; derived from the canvas when absent */
    panel?: string;
    /** the selected tool and option; derived from the accent when absent */
    active?: string;
  };
  frame: { width: number; alpha: number };
  /** canvas painted transparent, with this CSS background behind it */
  backdrop?: string;
  /** appended verbatim: component rules, with `:scope ` prefixes */
  extra?: string;
};

type RGB = [number, number, number];

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const themesDir = path.join(root, "playground/themes");

const rgb = (hex: string): RGB =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const hex = (c: RGB) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const mix = (a: string, b: string, t: number) =>
  hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t) as RGB);
const rgba = (color: string, alpha: number) =>
  `rgba(${rgb(color).join(", ")}, ${alpha})`;

const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const changes: string[] = [];

/** moves `color` away from `background` until the pair reaches `ratio` */
const legible = (
  label: string,
  color: string,
  background: string,
  ratio: number,
) => {
  const target = luminance(background) > 0.4 ? "#000000" : "#ffffff";
  let result = color;
  for (
    let t = 0.05;
    contrast(result, background) < ratio && t <= 1;
    t += 0.05
  ) {
    result = mix(color, target, t);
  }
  if (result !== color) {
    changes.push(
      `${label}: ${color} -> ${result} (${contrast(color, background).toFixed(
        2,
      )} -> ${contrast(result, background).toFixed(2)} on ${background})`,
    );
  }
  return result;
};

const SHADOW = {
  none: (ink: string) => `0 0 0 1px ${rgba(ink, 0.14)}`,
  soft: (ink: string) =>
    `0 0 0 1px ${rgba(ink, 0.1)}, 0 10px 28px -14px ${rgba(ink, 0.3)}`,
  long: (ink: string) =>
    `0 0 0 1px ${rgba(ink, 0.12)}, 26px 30px 44px -20px ${rgba(ink, 0.38)}`,
  hard: (ink: string) => `0 0 0 2px ${ink}, 5px 5px 0 2px ${ink}`,
};

const generate = (id: string, tokens: Tokens) => {
  const dark = tokens.mode === "dark";
  /** dark mode shows element colors through a filter; store the inverse */
  const store = (color: string) =>
    dark && color !== "transparent" ? removeDarkModeFilter(color) : color;
  const shown = (color: string) => (dark ? applyDarkModeFilter(color) : color);

  const canvas = tokens.canvas;
  const panel =
    tokens.surface.panel ??
    mix(canvas, dark ? "#ffffff" : "#ffffff", dark ? 0.04 : 0.35);
  const input = mix(panel, dark ? "#000000" : "#ffffff", 0.35);
  const ink = legible("ui text", tokens.ink, panel, 7);
  const muted = legible("secondary text", mix(ink, panel, 0.45), panel, 4.5);
  const hover = mix(panel, ink, 0.06);
  const active =
    tokens.surface.active ?? mix(panel, tokens.accent, dark ? 0.3 : 0.22);
  const onActive = legible("selected icon", ink, active, 4.5);
  const border =
    tokens.surface.border === "bold"
      ? ink
      : mix(panel, ink, tokens.surface.border === "none" ? 0.08 : 0.16);
  const accent = legible("selection on canvas", tokens.accent, canvas, 3);
  const primary = dark ? accent : ink;

  // element colors, as displayed; ramps step toward the canvas
  const elementInk = legible("element ink on canvas", tokens.ink, canvas, 7);
  const inkShown = shown(store(elementInk));
  const hues = [elementInk, ...tokens.palette];
  const ramp = (color: string, steps: number[]) =>
    steps.map((t) => store(mix(color, canvas, t)));
  const strokeEntries = hues.map((hue) =>
    ramp(hue, [0.82, 0.62, 0.42, 0.2, 0]),
  );
  // shade 1 is the wash under ink labels: paled until the label reads
  const fillEntries = hues.map((hue, i) => {
    let wash = 0.68;
    while (
      wash < 0.95 &&
      contrast(inkShown, shown(store(mix(hue, canvas, wash)))) < 4.5
    ) {
      wash += 0.03;
    }
    if (wash > 0.68 && i > 0) {
      changes.push(
        `wash of ${hue}: paled to ${Math.round(
          wash * 100,
        )}% canvas so ink labels read`,
      );
    }
    return ramp(hue, [Math.max(0.86, wash + 0.12), wash, 0.48, 0.24, 0]);
  });
  const washes = (tokens.washes ?? [0, 1, 2, 3]).map(
    (i) => fillEntries[i + 1][1],
  );

  const list = (entries: string[][]) =>
    entries.map((entry) => entry.join(" ")).join(",\n    ");
  const surfaceBorder =
    tokens.surface.border === "none" ? "none" : tokens.surface.border;
  const shadow =
    surfaceBorder === "bold" && tokens.surface.shadow !== "hard"
      ? `0 0 0 2px ${ink}`
      : SHADOW[tokens.surface.shadow](ink);
  const radius = `${tokens.surface.radius}px`;
  const keycap = legible("help dialog keycap text", ink, active, 4.5);

  return `/* ${tokens.name}. mode: ${tokens.mode} */
/*
${tokens.description.replace(/(.{1,72})(\s|$)/g, " * $1\n").trimEnd()}
 *
 * Generated by scripts/theme-gen from tokens/${id}.json; edit the tokens.
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
  --element-freedraw-variability: ${
    tokens.pen.pressure ? "variable" : "constant"
  };
  --element-freedraw-width: ${tokens.pen.width};${
    tokens.pen.thinning !== undefined
      ? `\n  --element-freedraw-thinning: ${tokens.pen.thinning};`
      : ""
  }${
    tokens.pen.taper !== undefined
      ? `\n  --element-freedraw-taper: ${tokens.pen.taper};`
      : ""
  }${
    tokens.pen.streamline !== undefined
      ? `\n  --element-freedraw-streamline: ${tokens.pen.streamline};`
      : ""
  }
  --color-picks-stroke: ${strokeEntries
    .slice(0, 5)
    .map((e) => e[4])
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

:scope .HelpDialog__key {
  color: ${keycap};
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
};

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const ids = args.includes("--all")
  ? fs
      .readdirSync(path.join(themesDir, "tokens"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
  : args;
if (!ids.length) {
  process.stderr.write("usage: yarn theme:gen <id>... | --all\n");
  process.exit(1);
}
for (const id of ids) {
  changes.length = 0;
  const tokens: Tokens = JSON.parse(
    fs.readFileSync(path.join(themesDir, "tokens", `${id}.json`), "utf8"),
  );
  const css = generate(id, tokens);
  fs.writeFileSync(path.join(themesDir, `${id}.css`), css);
  process.stdout.write(`playground/themes/${id}.css\n`);
  for (const change of changes) {
    process.stdout.write(`  contrast: ${change}\n`);
  }
}
