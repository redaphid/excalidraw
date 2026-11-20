import fs from "node:fs";
import path from "node:path";

import { generateThemeCss } from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

import { EMPTY_CSS_THEME, readCssTheme } from "../../cssTheme";

import {
  RECENT_COLOR_SLOTS,
  getThemeColors,
  getThemeInks,
  rememberColor,
} from "./themeInks";

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

describe("themeInks", () => {
  describe.each(TOKEN_THEMES)("with the %s theme", (name) => {
    let css: string;

    beforeEach(() => {
      ({ css } = generateThemeCss(loadTokens(name)));
    });

    it("inks with the theme's stroke color and swatches", () => {
      const picks = cssValue(css, "color-picks-stroke").split(/\s+/);
      expect(getThemeInks(readCssTheme(styleOf(css)))).toEqual({
        ink: cssValue(css, "element-stroke-color") || picks[0],
        palette: picks.slice(1),
      });
    });
  });

  describe("with no theme", () => {
    it("inks with Excalidraw's own stroke picks", () => {
      expect(getThemeInks(EMPTY_CSS_THEME)).toEqual({
        ink: "#1e1e1e",
        palette: ["#e03131", "#2f9e44", "#1971c2", "#f08c00"],
      });
    });
  });

  describe("the ring's colors with the parchment theme", () => {
    let colors: readonly string[];

    beforeEach(() => {
      const theme = readCssTheme(
        styleOf(generateThemeCss(loadTokens("architect-parchment")).css),
      );
      colors = getThemeColors(theme, getThemeInks(theme));
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
