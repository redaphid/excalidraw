import {
  THEME_TOKENS_VENDOR,
  generateThemeCss,
  mergeThemeTokens,
} from "@excalidraw/common";

const property = (css: string, name: string) =>
  css.match(new RegExp(`\n  ${name}: ([^;]+);`))?.[1];

const BASE = {
  $description: "Warm paper.",
  $extensions: {
    [THEME_TOKENS_VENDOR]: {
      name: "Paper",
      stroke: { width: "thin", roundness: "sharp" },
    },
  },
  color: {
    $type: "color",
    canvas: { $value: "#fbfaf7", $description: "the paper" },
    ink: { $value: "#1c1b19" },
    accent: { $value: "#0f62fe" },
    palette: {
      red: { $value: "#da1e28" },
      green: { $value: "#24a148" },
    },
  },
  font: { size: { $type: "dimension", $value: { value: 16, unit: "px" } } },
};

describe("mergeThemeTokens", () => {
  it("replaces a token's value and keeps its type and description", () => {
    const merged = mergeThemeTokens(BASE, {
      color: { canvas: { $value: "#0b2b2b" } },
    });
    expect(merged.color).toMatchObject({
      $type: "color",
      canvas: { $value: "#0b2b2b", $description: "the paper" },
      ink: { $value: "#1c1b19" },
    });
  });

  it("reads a bare value as the token's $value", () => {
    const merged = mergeThemeTokens(BASE, {
      color: { accent: "#2dd4bf" },
      font: { size: "20px" },
    });
    expect(merged).toMatchObject({
      color: { accent: { $value: "#2dd4bf" } },
      font: { size: { $type: "dimension", $value: "20px" } },
    });
  });

  it("reads a dotted key as a token path", () => {
    const merged = mergeThemeTokens(BASE, {
      "color.accent": "#2dd4bf",
      "color.palette.blue": "#1971c2",
    });
    expect(merged).toMatchObject({
      color: {
        accent: { $value: "#2dd4bf" },
        palette: {
          red: { $value: "#da1e28" },
          blue: { $value: "#1971c2" },
        },
      },
    });
  });

  it("deletes a token or group given null", () => {
    const merged = mergeThemeTokens(BASE, {
      "color.palette.red": null,
      font: null,
    });
    expect(merged).not.toHaveProperty("font");
    expect((merged.color as any).palette).toEqual({
      green: { $value: "#24a148" },
    });
  });

  it("merges the extension field by field", () => {
    const merged = mergeThemeTokens(BASE, {
      $extensions: { [THEME_TOKENS_VENDOR]: { stroke: { width: "bold" } } },
    });
    expect(merged.$extensions).toEqual({
      [THEME_TOKENS_VENDOR]: {
        name: "Paper",
        stroke: { width: "bold", roundness: "sharp" },
      },
    });
  });

  it("applies overrides in order and leaves its inputs alone", () => {
    const before = JSON.stringify(BASE);
    const merged = mergeThemeTokens(
      BASE,
      { "color.accent": "#111111" },
      { "color.accent": "#2dd4bf" },
    );
    expect((merged.color as any).accent).toEqual({ $value: "#2dd4bf" });
    expect(JSON.stringify(BASE)).toBe(before);
  });

  it("makes a whole theme from three colors over nothing", () => {
    const { css, warnings, mode } = generateThemeCss(
      mergeThemeTokens(
        {},
        { color: { canvas: "#0b2b2b", ink: "#e6fffa", accent: "#2dd4bf" } },
      ),
    );
    expect(property(css, "--canvas-background")).toBe("#0b2b2b");
    expect(mode).toBe("dark");
    expect(warnings.map(({ token }) => token)).not.toContain("color.canvas");
  });
});
