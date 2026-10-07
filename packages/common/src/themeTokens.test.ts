import {
  contrastRatio,
  generateThemeCss,
  removeDarkModeFilter,
} from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

const tokens: ThemeTokens = {
  name: "Test Parchment",
  mode: "light",
  description: "A quiet test theme.",
  canvas: "#ebe4d6",
  ink: "#1b2129",
  accent: "#a8732f",
  palette: ["#9e3a33", "#5a7a6a", "#4f7088", "#a8732f"],
  grid: { color: "#547691", minor: 0.2, major: 0.48, style: "solid" },
  type: { ui: "Liberation Sans", canvas: "Liberation Sans", size: 16 },
  stroke: {
    width: "thin",
    roughness: 0,
    roundness: "sharp",
    arrowhead: "arrow",
    arrowType: "sharp",
    fill: "solid",
  },
  pen: { pressure: true, width: 0.2, thinning: 0.2, taper: 4 },
  surface: { radius: 2, border: "hairline", shadow: "none", panel: "#f1ebdf" },
  frame: { width: 1, alpha: 0.42 },
};

const property = (css: string, name: string) =>
  css.match(new RegExp(`\n  ${name}: ([^;]+);`))?.[1];

describe("generateThemeCss", () => {
  it("writes the tokens' choices as the editor's custom properties", () => {
    const { css } = generateThemeCss(tokens);

    expect({
      background: property(css, "--canvas-background"),
      roughness: property(css, "--element-roughness"),
      thinning: property(css, "--element-freedraw-thinning"),
      selection: property(css, "--color-selection"),
    }).toEqual({
      background: "#ebe4d6",
      roughness: "0",
      thinning: "0.2",
      selection: "#a8732f",
    });
  });

  it("moves illegible text until it passes, and says so", () => {
    const { css, warnings } = generateThemeCss({ ...tokens, ink: "#c8c0b0" });
    const text = property(css, "--text-primary-color")!;

    expect(contrastRatio(text, "#f1ebdf")).toBeGreaterThanOrEqual(7);
    expect(warnings).toContainEqual(
      expect.objectContaining({ token: "ink", from: "#c8c0b0", to: text }),
    );
  });

  it("has nothing to report for a legible theme", () => {
    expect(
      generateThemeCss({
        ...tokens,
        surface: { ...tokens.surface, panel: "#ffffff" },
      }).warnings.filter(({ token }) => token === "ink"),
    ).toEqual([]);
  });

  it("stores a dark theme's element colors so dark mode shows them", () => {
    const { css } = generateThemeCss({
      ...tokens,
      mode: "dark",
      canvas: "#0b0c0e",
      ink: "#ece8e0",
      surface: { ...tokens.surface, panel: "#121316" },
    });

    expect(property(css, "--element-stroke-color")).toBe(
      removeDarkModeFilter("#ece8e0"),
    );
  });

  it("warns when the canvas is dark but the mode is light", () => {
    expect(
      generateThemeCss({ ...tokens, canvas: "#050a06", ink: "#39ff6a" })
        .warnings,
    ).toContainEqual(expect.objectContaining({ token: "mode" }));
  });

  it("warns when dark mode cannot display an element color", () => {
    const { warnings } = generateThemeCss({
      ...tokens,
      mode: "dark",
      canvas: "#050a06",
      ink: "#39ff6a",
      surface: { ...tokens.surface, panel: "#07120a" },
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({ token: "ink", from: "#39ff6a" }),
    );
  });

  it("pales a palette wash until ink labels read on it, and says so", () => {
    const ink = "#4a4a4a";
    const { warnings } = generateThemeCss({
      ...tokens,
      ink,
      palette: ["#000000", ...tokens.palette.slice(1)],
    });
    const wash = warnings.find(({ token }) => token === "palette[0]");

    expect(wash).toBeDefined();
    expect(contrastRatio(ink, wash!.from)).toBeLessThan(4.5);
    expect(contrastRatio(ink, wash!.to)).toBeGreaterThanOrEqual(4.5);
  });

  it("is deterministic", () => {
    expect(generateThemeCss(tokens).css).toBe(generateThemeCss(tokens).css);
  });
});
