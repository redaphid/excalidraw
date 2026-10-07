/**
 * Reads a W3C design tokens document (Design Tokens Format Module 2025.10)
 * into the theme generator's spec.
 *
 * The theme profile is plain DTCG: colors, font families, dimensions, numbers
 * and a stroke style at known paths, and the choices only this editor has
 * under `$extensions["com.hypnodroid.draw"]`. A designer's export without the
 * profile works too: each role is found by name, anything missing falls back
 * to Excalidraw's own look, and every such decision is reported.
 *
 * Pure and isomorphic, like the generator.
 */
import { DEFAULT_ELEMENT_STROKE_PICKS } from "./colors";
import {
  DEFAULT_ELEMENT_STROKE_WIDTH_KEY,
  DEFAULT_FONT_SIZE,
  FONT_FAMILY,
  FREEDRAW_STROKE_WIDTH,
} from "./constants";

/** the reverse-domain key of this profile's `$extensions` */
export const THEME_TOKENS_VENDOR = "com.hypnodroid.draw";

/**
 * A design tokens document (DTCG 2025.10) describing a theme. Its shape is
 * checked when it is read; {@link THEME_TOKENS_SCHEMA} documents the profile.
 */
export type ThemeTokens = { readonly [key: string]: unknown };

/** A value the generator chose or changed, named by its token's path. */
export type ThemeWarning = {
  /** a DTCG token path such as `color.ink`, or an `$extensions` field */
  token: string;
  from: string;
  to: string;
  reason: string;
};

/** The generator's input, read from a document by {@link readThemeTokens}. */
export type ThemeSpec = {
  name: string;
  /** absent: follows the canvas, dark below 0.18 luminance */
  mode?: "light" | "dark";
  description: string;
  canvas: string;
  ink: string;
  accent: string;
  /** element colors besides ink; the first four are the stroke swatches */
  palette: string[];
  /** indexes into `palette` for the four background swatches */
  washes?: number[];
  grid: {
    color: string;
    minor: number;
    major: number;
    style: "solid" | "dashed";
  };
  type: { ui: string[]; canvas: string; size: number };
  stroke: {
    width: typeof STROKE_KEYS[number];
    roughness: 0 | 1 | 2;
    roundness: typeof ROUNDNESS[number];
    arrowhead: typeof ARROWHEADS[number];
    arrowType: typeof ARROW_TYPES[number];
    fill: typeof FILLS[number];
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
    border: typeof BORDERS[number];
    shadow: typeof SHADOWS[number];
    panel?: string;
    active?: string;
  };
  frame: { width: number; alpha: number };
  /** paints the canvas transparent and puts this CSS background behind it */
  backdrop?: string;
  /** CSS appended verbatim; prefix each selector with `:scope ` */
  extra?: string;
};

const MODES = ["light", "dark"] as const;
const STROKE_KEYS = ["thin", "medium", "bold"] as const;
const ROUNDNESS = ["sharp", "round"] as const;
const ARROW_TYPES = ["sharp", "round"] as const;
const FILLS = ["solid", "hachure", "cross-hatch", "zigzag"] as const;
const BORDERS = ["none", "hairline", "bold"] as const;
const SHADOWS = ["none", "soft", "long", "hard"] as const;
const ARROWHEADS = [
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
] as const;
const STROKE_STYLES = [
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "outset",
  "inset",
] as const;
/** the fonts the editor can draw text in */
const CANVAS_FONTS = Object.keys(FONT_FAMILY);

const EXTENSION = `$extensions["${THEME_TOKENS_VENDOR}"]`;

/** Excalidraw's own look, for whatever a document leaves out */
const DEFAULTS = {
  canvas: "#ffffff",
  ink: DEFAULT_ELEMENT_STROKE_PICKS[0],
  // the editor's selection color
  accent: "#6965db",
  palette: DEFAULT_ELEMENT_STROKE_PICKS.slice(1),
  name: "Design tokens",
  ui: ["Assistant"],
  canvasFont: "Excalifont",
  fontSize: DEFAULT_FONT_SIZE,
  gridMinor: 0.06,
  gridMajor: 0.14,
  roughness: 1,
  penWidth: FREEDRAW_STROKE_WIDTH[DEFAULT_ELEMENT_STROKE_WIDTH_KEY],
  radius: 8,
  frameWidth: 1,
  frameAlpha: 0.35,
} as const;

/** the names a designer's export may give each role */
const ROLE_NAMES = {
  canvas: ["canvas", "background", "bg", "paper", "surface", "base"],
  ink: ["ink", "text", "foreground", "fg", "onbackground", "onsurface"],
  accent: ["accent", "primary", "brand", "highlight", "selection"],
  ui: ["ui", "body", "sans", "base", "text", "default", "primary"],
  canvasFont: ["canvas", "hand", "handwriting", "heading", "display"],
  fontSize: ["size", "body", "base", "default", "md", "medium"],
  typography: ["body", "base", "text", "default", "paragraph", "regular"],
};

const PALETTE_SIZE = { min: 4, max: 12 };

const ALIAS = /^\{([^{}]+)\}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalize = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

const show = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value) ?? "";

const unescapePointer = (key: string) =>
  key.replace(/~1/g, "/").replace(/~0/g, "~");

const definedEntries = <T extends Record<string, unknown>>(object: T) =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };

type Parse<T> = (value: unknown) => T | undefined;

const oneOf =
  <T extends string>(options: readonly T[]): Parse<T> =>
  (value) =>
    options.find((option) => option === value);

const inRange =
  (min: number, max: number, { aboveMin = false } = {}): Parse<number> =>
  (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    (aboveMin ? value > min : value >= min) &&
    value <= max
      ? value
      : undefined;

const text: Parse<string> = (value) =>
  typeof value === "string" ? value : undefined;

const toHex: Parse<string> = (value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }
  return /^#[0-9a-f]{3}$/i.test(value)
    ? `#${[...value.slice(1)]
        .map((digit) => digit + digit)
        .join("")}`.toLowerCase()
    : undefined;
};

/**
 * An sRGB color value, or another color space's `hex` fallback. A plain hex
 * string, the form of the drafts before 2025.10, is read too. Alpha is
 * ignored: the generator works with opaque colors.
 */
const readColor: Parse<string> = (value) => {
  if (!isRecord(value)) {
    return toHex(value);
  }
  const { colorSpace, components } = value;
  if (
    colorSpace === "srgb" &&
    Array.isArray(components) &&
    components.length === 3 &&
    components.every(
      (component) =>
        component === "none" ||
        (typeof component === "number" && Number.isFinite(component)),
    )
  ) {
    return `#${components
      .map((component) =>
        Math.round(
          Math.max(0, Math.min(1, component === "none" ? 0 : component)) * 255,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }
  return toHex(value.hex);
};

/** in px; a rem is 16px. The "16px" strings of earlier drafts are read too. */
const readDimension = ({ min = 0, aboveMin = false } = {}): Parse<number> => {
  const range = inRange(min, Infinity, { aboveMin });
  return (value) => {
    const [amount, unit] = isRecord(value)
      ? [value.value, value.unit]
      : typeof value === "string"
      ? [
          Number(/^(-?[\d.]+)(?:px|rem)$/.exec(value)?.[1]),
          /(px|rem)$/.exec(value)?.[1],
        ]
      : [];
    return typeof amount === "number" && (unit === "px" || unit === "rem")
      ? range(unit === "rem" ? amount * 16 : amount)
      : undefined;
  };
};

const readFontFamily: Parse<string[]> = (value) => {
  const families = typeof value === "string" ? [value] : value;
  return Array.isArray(families) &&
    families.length &&
    families.every((family) => typeof family === "string" && family)
    ? (families as string[])
    : undefined;
};

/** the grid draws solid or dashed lines; other stroke styles read as dashed */
const readGridStyle: Parse<"solid" | "dashed"> = (value) =>
  value === "solid"
    ? "solid"
    : oneOf(STROKE_STYLES)(value) || isRecord(value)
    ? "dashed"
    : undefined;

type Entry = { node: Record<string, unknown>; groupType?: string };
type Resolved = { type?: string; value: unknown } | { error: string };

/** every token in the document, by dotted path, in document order */
const collectTokens = (document: Record<string, unknown>) => {
  const tokens = new Map<string, Entry>();
  const walk = (
    group: Record<string, unknown>,
    path: string[],
    groupType: string | undefined,
  ) => {
    for (const [name, child] of Object.entries(group)) {
      if (name.startsWith("$") || !isRecord(child)) {
        continue;
      }
      if ("$value" in child || "$ref" in child) {
        tokens.set([...path, name].join("."), { node: child, groupType });
      } else {
        walk(
          child,
          [...path, name],
          typeof child.$type === "string" ? child.$type : groupType,
        );
      }
    }
  };
  walk(
    document,
    [],
    typeof document.$type === "string" ? document.$type : undefined,
  );
  return tokens;
};

/**
 * Resolves `{group.token}` aliases and `$ref` JSON pointers, whole values or
 * inside them. A token's type is its own `$type`, else its reference's, else
 * its closest group's.
 */
const createResolver = (
  document: Record<string, unknown>,
  tokens: Map<string, Entry>,
) => {
  const resolveToken = (path: string, seen: string[]): Resolved => {
    const entry = tokens.get(path);
    if (!entry) {
      return { error: `{${path}} names no token` };
    }
    if (seen.includes(path)) {
      return { error: `circular reference ${[...seen, path].join(" -> ")}` };
    }
    const resolved = resolveValue(
      "$ref" in entry.node ? { $ref: entry.node.$ref } : entry.node.$value,
      [...seen, path],
    );
    if ("error" in resolved) {
      return resolved;
    }
    const ownType =
      typeof entry.node.$type === "string" ? entry.node.$type : undefined;
    return {
      type: ownType ?? resolved.type ?? entry.groupType,
      value: resolved.value,
    };
  };

  const resolveValue = (raw: unknown, seen: string[]): Resolved => {
    if (typeof raw === "string") {
      const alias = ALIAS.exec(raw);
      return alias ? resolveToken(alias[1], seen) : { value: raw };
    }
    if (isRecord(raw) && typeof raw.$ref === "string") {
      const ref = raw.$ref;
      const whole = /^#\/(.+)\/\$value$/.exec(ref);
      if (whole) {
        return resolveToken(
          whole[1].split("/").map(unescapePointer).join("."),
          seen,
        );
      }
      if (!ref.startsWith("#/") || seen.includes(ref)) {
        return { error: `cannot follow $ref ${ref}` };
      }
      const target = ref
        .slice(2)
        .split("/")
        .map(unescapePointer)
        .reduce<unknown>(
          (at, key) =>
            isRecord(at) || Array.isArray(at)
              ? (at as Record<string, unknown>)[key]
              : undefined,
          document,
        );
      if (target === undefined) {
        return { error: `$ref ${ref} points at nothing` };
      }
      const resolved = resolveValue(target, [...seen, ref]);
      return "error" in resolved ? resolved : { value: resolved.value };
    }
    if (Array.isArray(raw) || isRecord(raw)) {
      const items = Object.entries(raw).map(
        ([key, item]) => [key, resolveValue(item, seen)] as const,
      );
      const failed = items.find(([, item]) => "error" in item)?.[1];
      if (failed) {
        return failed;
      }
      const values = items.map(
        ([key, item]) => [key, (item as { value: unknown }).value] as const,
      );
      return {
        value: Array.isArray(raw)
          ? values.map(([, value]) => value)
          : Object.fromEntries(values),
      };
    }
    return { value: raw };
  };

  return (path: string) => resolveToken(path, []);
};

/**
 * Reads a theme from a design tokens document. Returns the spec, the token
 * path behind each name the generator reports warnings under, and warnings
 * about the document: values it could not read, roles it found by name, and
 * roles it filled with Excalidraw's defaults.
 */
export const readThemeTokens = (
  document: ThemeTokens,
): {
  spec: ThemeSpec;
  paths: Record<string, string>;
  warnings: ThemeWarning[];
} => {
  if (!isRecord(document)) {
    throw new TypeError("theme tokens must be a design tokens JSON object");
  }
  const warnings: ThemeWarning[] = [];
  const tokens = collectTokens(document);
  const resolve = createResolver(document, tokens);
  const claimed = new Set<string>();

  const typeOf = (path: string) => {
    const resolved = resolve(path);
    return "error" in resolved ? undefined : resolved.type;
  };

  /** a token's value, or `fallback` with a warning saying why */
  const read = <T>(
    path: string,
    type: string,
    parse: Parse<T>,
    fallback: T,
  ): T => {
    const resolved = resolve(path);
    const value =
      "error" in resolved || resolved.type !== type
        ? undefined
        : parse(resolved.value);
    if (value !== undefined) {
      claimed.add(path);
      return value;
    }
    const { node } = tokens.get(path)!;
    warnings.push({
      token: path,
      from: show(node.$value ?? node),
      to: show(fallback),
      reason:
        "error" in resolved
          ? resolved.error
          : resolved.type === undefined
          ? "no $type on the token or its groups"
          : resolved.type !== type
          ? `a ${resolved.type} token where a ${type} belongs`
          : `not a ${type} this field takes`,
    });
    return fallback;
  };

  /** the profile's path, else the first unclaimed token of `type` named one of `names` */
  const locate = (
    path: string,
    type: string,
    names: readonly string[],
    accept: (path: string) => boolean = () => true,
  ) =>
    tokens.has(path)
      ? path
      : [...tokens.keys()].find(
          (candidate) =>
            !claimed.has(candidate) &&
            accept(candidate) &&
            candidate
              .split(".")
              .some((segment) => names.includes(normalize(segment))) &&
            typeOf(candidate) === type,
        );

  const notice = (path: string, profilePath: string, role: string) => {
    if (path !== profilePath) {
      warnings.push({
        token: path,
        from: "",
        to: "",
        reason: `read as the ${role} (the profile's ${profilePath})`,
      });
    }
  };

  const colorRole = (name: "canvas" | "ink" | "accent") => {
    const profilePath = `color.${name}`;
    const path = locate(profilePath, "color", ROLE_NAMES[name]);
    if (!path) {
      warnings.push({
        token: profilePath,
        from: "",
        to: DEFAULTS[name],
        reason: `no ${profilePath} token, nor a color named ${ROLE_NAMES[
          name
        ].join(", ")}: using Excalidraw's`,
      });
      return { value: DEFAULTS[name], path: profilePath };
    }
    notice(path, profilePath, `${name} color`);
    return { value: read(path, "color", readColor, DEFAULTS[name]), path };
  };

  const ifPresent = <T>(path: string, type: string, parse: Parse<T>) =>
    tokens.has(path)
      ? read<T | undefined>(path, type, parse, undefined)
      : undefined;

  const orDefault = <T>(
    path: string,
    type: string,
    parse: Parse<T>,
    fallback: T,
  ) => (tokens.has(path) ? read(path, type, parse, fallback) : fallback);

  const extensions = isRecord(document.$extensions)
    ? document.$extensions[THEME_TOKENS_VENDOR]
    : undefined;
  /** a field of this profile's `$extensions`, or `fallback` */
  const field = <T>(
    keys: string[],
    parse: Parse<T>,
    fallback: T,
    expected: string,
  ): T => {
    const raw = keys.reduce<unknown>(
      (at, key) => (isRecord(at) ? at[key] : undefined),
      extensions,
    );
    const value = raw === undefined ? undefined : parse(raw);
    if (raw !== undefined && value === undefined) {
      warnings.push({
        token: `${EXTENSION}.${keys.join(".")}`,
        from: show(raw),
        to: show(fallback),
        reason: `takes ${expected}`,
      });
    }
    return value ?? fallback;
  };
  const choice = <T extends string>(
    keys: string[],
    options: readonly T[],
    fallback: T,
  ) => field(keys, oneOf(options), fallback, options.join(", "));

  const canvas = colorRole("canvas");
  const ink = colorRole("ink");
  const accent = colorRole("accent");
  const panel = ifPresent("color.panel", "color", readColor);
  const active = ifPresent("color.active", "color", readColor);
  const gridColor = ifPresent("color.grid", "color", readColor) ?? ink.value;

  const paletteGroup = [...tokens.keys()].filter(
    (path) => path.startsWith("color.palette.") && path.split(".").length === 3,
  );
  const paletteSource = paletteGroup.length
    ? paletteGroup
    : [...tokens.keys()].filter((path) => {
        if (claimed.has(path) || typeOf(path) !== "color") {
          return false;
        }
        // the canvas color draws nothing, and ink is already the first swatch
        const resolved = resolve(path);
        const hex = "error" in resolved ? undefined : readColor(resolved.value);
        return hex !== canvas.value && hex !== ink.value;
      });
  if (!paletteGroup.length && paletteSource.length) {
    warnings.push({
      token: "color.palette",
      from: "",
      to: paletteSource.join(", "),
      reason:
        "no color.palette group: the document's other colors, in order, are the palette",
    });
  }
  const palette = paletteSource
    .map((path) => ({
      path,
      color: read<string | undefined>(path, "color", readColor, undefined),
    }))
    .filter((entry): entry is { path: string; color: string } =>
      Boolean(entry.color),
    )
    .filter(
      (entry, i, all) =>
        paletteGroup.length ||
        all.findIndex(({ color }) => color === entry.color) === i,
    );
  if (palette.length > PALETTE_SIZE.max) {
    warnings.push({
      token: palette[PALETTE_SIZE.max].path,
      from: `${palette.length} colors`,
      to: `${PALETTE_SIZE.max} colors`,
      reason: `the palette holds ${PALETTE_SIZE.max} colors; the rest are left out`,
    });
    palette.length = PALETTE_SIZE.max;
  }
  if (palette.length < PALETTE_SIZE.min) {
    const added = DEFAULTS.palette
      .filter((color) => !palette.some((entry) => entry.color === color))
      .slice(0, PALETTE_SIZE.min - palette.length);
    warnings.push({
      token: "color.palette",
      from: `${palette.length} colors`,
      to: `${palette.length + added.length} colors`,
      reason: `the palette needs ${
        PALETTE_SIZE.min
      } colors: added Excalidraw's ${added.join(", ")}`,
    });
    palette.push(...added.map((color) => ({ path: "color.palette", color })));
  }
  const paletteNames = palette.map(({ path }) => path.split(".").pop());

  // a designer's typography token supplies the font when no fontFamily does
  const typographyPath = locate(
    "font.typography",
    "typography",
    ROLE_NAMES.typography,
  );
  const typographyValue = typographyPath && resolve(typographyPath);
  const typography =
    typographyValue &&
    !("error" in typographyValue) &&
    isRecord(typographyValue.value)
      ? typographyValue.value
      : {};

  const uiPath = locate("font.ui", "fontFamily", ROLE_NAMES.ui);
  if (uiPath) {
    notice(uiPath, "font.ui", "UI font");
  }
  const uiFromDocument = uiPath
    ? read(uiPath, "fontFamily", readFontFamily, undefined)
    : readFontFamily(typography.fontFamily);
  const ui = uiFromDocument ?? [...DEFAULTS.ui];

  const canvasFontPath = locate(
    "font.canvas",
    "fontFamily",
    ROLE_NAMES.canvasFont,
  );
  if (canvasFontPath) {
    notice(canvasFontPath, "font.canvas", "canvas font");
  }
  const canvasFamilies = canvasFontPath
    ? read(canvasFontPath, "fontFamily", readFontFamily, undefined)
    : uiFromDocument;
  const canvasFont =
    canvasFamilies?.find((family) => CANVAS_FONTS.includes(family)) ??
    DEFAULTS.canvasFont;
  if (canvasFamilies && !CANVAS_FONTS.includes(canvasFamilies[0])) {
    warnings.push({
      token: canvasFontPath ?? uiPath ?? typographyPath ?? "font.canvas",
      from: canvasFamilies.join(", "),
      to: canvasFont,
      reason: `elements are drawn in one of ${CANVAS_FONTS.join(", ")}`,
    });
  }

  const sizePath = locate(
    "font.size",
    "dimension",
    ROLE_NAMES.fontSize,
    (path) => /font|type|text/i.test(path),
  );
  const fontSize = readDimension({ aboveMin: true });
  const size = sizePath
    ? read(sizePath, "dimension", fontSize, DEFAULTS.fontSize)
    : fontSize(typography.fontSize) ?? DEFAULTS.fontSize;

  const spec: ThemeSpec = {
    name: field(["name"], text, DEFAULTS.name, "a string"),
    ...definedEntries({
      mode: field<ThemeSpec["mode"]>(
        ["mode"],
        oneOf(MODES),
        undefined,
        MODES.join(", "),
      ),
    }),
    description: text(document.$description) ?? "",
    canvas: canvas.value,
    ink: ink.value,
    accent: accent.value,
    palette: palette.map(({ color }) => color),
    ...definedEntries({
      washes: field<number[] | undefined>(
        ["washes"],
        (value) => {
          const indexes = Array.isArray(value)
            ? value.map((name) => paletteNames.indexOf(name))
            : [];
          return indexes.length === 4 && indexes.every((index) => index >= 0)
            ? indexes
            : undefined;
        },
        undefined,
        "four names of color.palette tokens",
      ),
    }),
    grid: {
      color: gridColor,
      minor: orDefault(
        "grid.minor",
        "number",
        inRange(0, 1),
        DEFAULTS.gridMinor,
      ),
      major: orDefault(
        "grid.major",
        "number",
        inRange(0, 1),
        DEFAULTS.gridMajor,
      ),
      style: orDefault("grid.style", "strokeStyle", readGridStyle, "dashed"),
    },
    type: { ui, canvas: canvasFont, size },
    stroke: {
      width: choice(
        ["stroke", "width"],
        STROKE_KEYS,
        DEFAULT_ELEMENT_STROKE_WIDTH_KEY,
      ),
      roughness: Math.round(
        orDefault(
          "stroke.roughness",
          "number",
          inRange(0, 2),
          DEFAULTS.roughness,
        ),
      ) as 0 | 1 | 2,
      roundness: choice(["stroke", "roundness"], ROUNDNESS, "round"),
      arrowhead: choice(["stroke", "arrowhead"], ARROWHEADS, "arrow"),
      arrowType: choice(["stroke", "arrowType"], ARROW_TYPES, "round"),
      fill: choice(["stroke", "fill"], FILLS, "solid"),
    },
    pen: {
      pressure: field(
        ["pen", "pressure"],
        (value) => (typeof value === "boolean" ? value : undefined),
        true,
        "true or false",
      ),
      width: orDefault(
        "pen.width",
        "number",
        inRange(0, 4, { aboveMin: true }),
        DEFAULTS.penWidth,
      ),
      ...definedEntries({
        thinning: ifPresent("pen.thinning", "number", inRange(-1, 1)),
        taper: ifPresent("pen.taper", "number", inRange(0, Infinity)),
        streamline: ifPresent("pen.streamline", "number", inRange(0, 1)),
      }),
    },
    surface: {
      radius: orDefault(
        "surface.radius",
        "dimension",
        readDimension(),
        DEFAULTS.radius,
      ),
      border: choice(["surface", "border"], BORDERS, "hairline"),
      shadow: choice(["surface", "shadow"], SHADOWS, "soft"),
      ...definedEntries({ panel, active }),
    },
    frame: {
      width: orDefault(
        "frame.width",
        "dimension",
        readDimension({ aboveMin: true }),
        DEFAULTS.frameWidth,
      ),
      alpha: orDefault(
        "frame.alpha",
        "number",
        inRange(0, 1),
        DEFAULTS.frameAlpha,
      ),
    },
    ...definedEntries({
      backdrop: field(["backdrop"], text, undefined, "a CSS background"),
      extra: field(["extra"], text, undefined, "a CSS string"),
    }),
  };

  return {
    spec,
    paths: {
      ink: ink.path,
      accent: accent.path,
      "surface.active": "color.active",
      mode: `${EXTENSION}.mode`,
      ...Object.fromEntries(
        palette.map(({ path }, i) => [`palette[${i}]`, path]),
      ),
    },
    warnings,
  };
};

const ALIAS_VALUE = {
  type: "string",
  pattern: "^{[^{}]+}$",
  description: "an alias, {group.token}",
} as const;
const REF_VALUE = {
  type: "object",
  required: ["$ref"],
  properties: { $ref: { type: "string", pattern: "^#/" } },
} as const;
const COLOR_VALUE = {
  anyOf: [
    {
      type: "object",
      required: ["colorSpace", "components"],
      properties: {
        colorSpace: {
          type: "string",
          description: "srgb is read directly; other spaces use hex",
        },
        components: {
          type: "array",
          items: { anyOf: [{ type: "number" }, { const: "none" }] },
        },
        alpha: { type: "number", minimum: 0, maximum: 1 },
        hex: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      },
    },
    {
      type: "string",
      pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
      description: "a hex string, as in the drafts before 2025.10",
    },
  ],
} as const;
const DIMENSION_VALUE = {
  anyOf: [
    {
      type: "object",
      required: ["value", "unit"],
      properties: {
        value: { type: "number" },
        unit: { enum: ["px", "rem"] },
      },
    },
    { type: "string", pattern: "^-?[0-9.]+(px|rem)$" },
  ],
} as const;
const FONT_FAMILY_VALUE = {
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "array", items: { type: "string" }, minItems: 1 },
  ],
} as const;

const token = (description: string, value: object) => ({
  type: "object",
  description,
  properties: {
    $value: { anyOf: [value, ALIAS_VALUE, REF_VALUE] },
    $ref: { type: "string", pattern: "^#/" },
    $type: { type: "string" },
    $description: { type: "string" },
    $extensions: { type: "object" },
    $deprecated: { type: ["boolean", "string"] },
  },
  anyOf: [{ required: ["$value"] }, { required: ["$ref"] }],
});
const number = (description: string, minimum: number, maximum?: number) =>
  token(description, {
    type: "number",
    minimum,
    ...(maximum !== undefined && { maximum }),
  });
const group = (description: string, properties: Record<string, object>) => ({
  type: "object",
  description,
  properties: {
    $type: { type: "string" },
    $description: { type: "string" },
    $extensions: { type: "object" },
    ...properties,
  },
});
const color = (description: string) => token(description, COLOR_VALUE);
const dimension = (description: string) => token(description, DIMENSION_VALUE);

/**
 * JSON Schema (draft 2020-12) for this profile of the W3C Design Tokens
 * Format Module 2025.10. Every token is optional; other groups are allowed
 * and ignored, so a designer's export validates too.
 */
export const THEME_TOKENS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Excalidraw theme tokens",
  description:
    "A W3C design tokens document (Format Module 2025.10) for generateThemeCss in @excalidraw/common.",
  type: "object",
  properties: {
    $schema: { type: "string" },
    $description: {
      type: "string",
      description: "the theme's description, printed atop the stylesheet",
    },
    $extensions: {
      type: "object",
      properties: {
        [THEME_TOKENS_VENDOR]: {
          type: "object",
          description: "the choices only this editor has",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 },
            mode: {
              enum: MODES,
              description: "default: dark when the canvas is dark",
            },
            stroke: {
              type: "object",
              additionalProperties: false,
              properties: {
                width: { enum: STROKE_KEYS },
                roundness: { enum: ROUNDNESS },
                arrowhead: { enum: ARROWHEADS },
                arrowType: { enum: ARROW_TYPES },
                fill: { enum: FILLS },
              },
            },
            pen: {
              type: "object",
              additionalProperties: false,
              properties: {
                pressure: {
                  type: "boolean",
                  description: "false draws freehand at a constant width",
                },
              },
            },
            surface: {
              type: "object",
              additionalProperties: false,
              properties: {
                border: { enum: BORDERS },
                shadow: { enum: SHADOWS },
              },
            },
            washes: {
              type: "array",
              description:
                "the four background swatches, as names of color.palette tokens",
              items: { type: "string" },
              minItems: 4,
              maxItems: 4,
            },
            backdrop: {
              type: "string",
              description:
                "a CSS background behind a transparent canvas, such as a gradient",
            },
            extra: {
              type: "string",
              description:
                "CSS appended verbatim; prefix each selector with :scope",
            },
          },
        },
      },
    },
    color: group("$type color", {
      canvas: color("the board"),
      ink: color("UI text and the default element stroke"),
      accent: color("selection and focus"),
      panel: color("panels; default: derived from the canvas"),
      active: color("the selected state; default: derived from the accent"),
      grid: color("grid lines; default: ink"),
      palette: {
        type: "object",
        description:
          "element colors in order: the first four are the stroke swatches, and each also gives a background wash",
        patternProperties: {
          "^[^${}.][^{}.]*$": color("an element color"),
        },
      },
    }),
    font: group("fonts", {
      ui: token("the UI font", FONT_FAMILY_VALUE),
      canvas: token(
        `the font new text is drawn in: one of ${CANVAS_FONTS.join(", ")}`,
        FONT_FAMILY_VALUE,
      ),
      size: dimension("the font size of new text"),
    }),
    grid: group("$type number", {
      minor: number("the minor grid lines' opacity", 0, 1),
      major: number("the major grid lines' opacity", 0, 1),
      style: token("$type strokeStyle: solid, or dashed for any other", {
        anyOf: [{ enum: STROKE_STYLES }, { type: "object" }],
      }),
    }),
    stroke: group("new elements", {
      roughness: number("0 architect, 1 artist, 2 cartoonist (rounded)", 0, 2),
    }),
    pen: group("$type number; the freehand pen", {
      width: number("stroke width, at most 4", 0, 4),
      thinning: number("how much pressure thins the line, -1 to 1", -1, 1),
      taper: number("how long the ends taper, in stroke widths", 0),
      streamline: number("smoothing, 0 to 1", 0, 1),
    }),
    surface: group("panels", {
      radius: dimension("corner radius"),
    }),
    frame: group("frames", {
      width: dimension("frame outline width"),
      alpha: number("frame outline opacity", 0, 1),
    }),
  },
} as const;
