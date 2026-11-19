import fs from "node:fs";
import path from "node:path";

import { generateThemeCss, removeDarkModeFilter } from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

import { EMPTY_CSS_THEME, readCssTheme } from "../../cssTheme";

import {
  RECENT_COLOR_SLOTS,
  STYLE_ROLES,
  getRoleStyle,
  getThemeColors,
  getThemeInks,
  rememberColor,
} from "./themeInks";

import type { RoleStyle, StyleRole } from "./themeInks";

const THEMES_DIR = path.resolve(__dirname, "../../themes");

const TOKEN_THEMES = fs
  .readdirSync(THEMES_DIR)
  .filter((file) => file.endsWith(".tokens.json"))
  .map((file) => file.replace(".tokens.json", ""));

const loadTokens = (name: string): ThemeTokens =>
  JSON.parse(
    fs.readFileSync(path.join(THEMES_DIR, `${name}.tokens.json`), "utf8"),
  );

const cssValue = (css: string, name: string) =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? "";

/** the stylesheet as the editor's `getComputedStyle` read sees it */
const styleOf = (css: string) => ({
  getPropertyValue: (name: string) => cssValue(css, name.replace(/^--/, "")),
});

/**
 * draw's `roleStyle` colors (src/roles.ts in redaphid/draw), restated: the
 * reference the palette must agree with
 */
const drawRoleStyle = (
  role: StyleRole,
  css: string,
  mode: "light" | "dark",
): RoleStyle => {
  const stored = (color: string) =>
    mode === "dark" && color !== "transparent"
      ? removeDarkModeFilter(color)
      : color;
  const value = (name: string) => cssValue(css, name);
  const palette = value("color-picks-stroke").split(/\s+/).slice(1);
  const accent = stored(value("color-selection"));
  const colors = {
    accent,
    data: palette[2] ?? accent,
    note: value("sticky-note-background-color"),
    error: palette[0] ?? accent,
    healthy: palette[1] ?? accent,
    ink: value("element-stroke-color"),
  };
  const table = {
    service: ["accent", "solid"],
    data: ["data", "solid"],
    async: ["accent", "dashed"],
    note: ["note", "solid"],
    error: ["error", "solid"],
    healthy: ["healthy", "solid"],
    assumed: ["ink", "dashed"],
  } as const;
  const [color, strokeStyle] = table[role];
  return {
    strokeColor:
      role === "note" ? value("sticky-note-stroke-color") : colors[color],
    backgroundColor:
      role === "note" ? colors.note : stored(value("canvas-background")),
    fillStyle: value("element-fill-style") as RoleStyle["fillStyle"],
    strokeStyle,
  };
};

describe("themeInks", () => {
  describe.each(TOKEN_THEMES)("with the %s theme", (name) => {
    let css: string;
    let mode: "light" | "dark";

    beforeEach(() => {
      ({ css, mode } = generateThemeCss(loadTokens(name)));
    });

    it.each(STYLE_ROLES)(
      "resolves the %s role as draw's agents do",
      (role) => {
        const theme = readCssTheme(styleOf(css));
        const inks = getThemeInks(
          theme,
          { viewBackgroundColor: "#ffffff" },
          theme.canvas.mode ?? "light",
        );
        expect(getRoleStyle(role, inks)).toEqual(
          drawRoleStyle(role, css, mode),
        );
      },
    );
  });

  describe("with no theme", () => {
    let style: (role: StyleRole) => RoleStyle;

    beforeEach(() => {
      const inks = getThemeInks(
        EMPTY_CSS_THEME,
        { viewBackgroundColor: "#ffffff" },
        "light",
      );
      style = (role) => getRoleStyle(role, inks);
    });

    it.each([
      ["service", "#6965db", "solid"],
      ["data", "#1971c2", "solid"],
      ["async", "#6965db", "dashed"],
      ["error", "#e03131", "solid"],
      ["healthy", "#2f9e44", "solid"],
      ["assumed", "#1e1e1e", "dashed"],
    ] as const)(
      "gives the %s role Excalidraw's own colors, as draw does",
      (role, strokeColor, strokeStyle) => {
        expect(style(role)).toMatchObject({
          strokeColor,
          strokeStyle,
          backgroundColor: "#ffffff",
        });
      },
    );
  });

  describe("the ring's colors with the parchment theme", () => {
    let colors: readonly string[];

    beforeEach(() => {
      const theme = readCssTheme(
        styleOf(generateThemeCss(loadTokens("architect-parchment")).css),
      );
      colors = getThemeColors(
        theme,
        getThemeInks(theme, { viewBackgroundColor: "#ffffff" }, "light"),
      );
    });

    it("are the ink, then the palette, in the theme's order", () => {
      expect(colors).toEqual([
        "#1b2129",
        "#9e3a33",
        "#5a7a6a",
        "#4f7088",
        "#a8732f",
        "#a38327",
        "#7e4a6e",
        "#a85f2c",
        "#6b6459",
      ]);
    });
  });

  describe("rememberColor", () => {
    const theirs = ["#1b2129", "#9e3a33"];

    describe("when the color is the theme's", () => {
      it("keeps the recent colors as they are", () => {
        expect(rememberColor(["#123456"], "#9E3A33", theirs)).toEqual([
          "#123456",
        ]);
      });
    });

    describe("when the color is new", () => {
      it("puts it first", () => {
        expect(rememberColor(["#123456"], "#abcdef", theirs)).toEqual([
          "#abcdef",
          "#123456",
        ]);
      });
    });

    describe("when the color is already recent", () => {
      it("moves it first without a repeat", () => {
        expect(
          rememberColor(["#123456", "#abcdef"], "#abcdef", theirs),
        ).toEqual(["#abcdef", "#123456"]);
      });
    });

    describe("when the recent colors are full", () => {
      it("drops the oldest", () => {
        const full = ["#000001", "#000002", "#000003"];
        const next = rememberColor(full, "#abcdef", theirs);
        expect(next).toHaveLength(RECENT_COLOR_SLOTS);
        expect(next).not.toContain("#000003");
      });
    });
  });
});
