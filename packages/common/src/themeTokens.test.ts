import {
  THEME_TOKENS_VENDOR,
  contrastRatio,
  generateThemeCss,
  removeDarkModeFilter,
} from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

const color = (hex: string) => ({
  $value: {
    colorSpace: "srgb",
    components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
    hex,
  },
});

type Overrides = {
  mode?: "light" | "dark";
  canvas?: string;
  ink?: string;
  panel?: string;
  palette?: string[];
};

const tokens = ({
  mode = "light",
  canvas = "#ebe4d6",
  ink = "#1b2129",
  panel = "#f1ebdf",
  palette = ["#9e3a33", "#5a7a6a", "#4f7088", "#a8732f"],
}: Overrides = {}): ThemeTokens => ({
  $description: "A quiet test theme.",
  $extensions: {
    [THEME_TOKENS_VENDOR]: {
      name: "Test Parchment",
      mode,
      stroke: {
        width: "thin",
        roundness: "sharp",
        arrowhead: "arrow",
        arrowType: "sharp",
        fill: "solid",
      },
      pen: { pressure: true },
      surface: { border: "hairline", shadow: "none" },
    },
  },
  color: {
    $type: "color",
    canvas: color(canvas),
    ink: color(ink),
    accent: color("#a8732f"),
    panel: color(panel),
    grid: color("#547691"),
    palette: Object.fromEntries(
      palette.map((hex, i) => [`hue-${i}`, color(hex)]),
    ),
  },
  font: {
    ui: { $type: "fontFamily", $value: "Liberation Sans" },
    canvas: { $type: "fontFamily", $value: "Liberation Sans" },
    size: { $type: "dimension", $value: { value: 16, unit: "px" } },
  },
  grid: {
    $type: "number",
    minor: { $value: 0.2 },
    major: { $value: 0.48 },
    style: { $type: "strokeStyle", $value: "solid" },
  },
  stroke: { roughness: { $type: "number", $value: 0 } },
  pen: {
    $type: "number",
    width: { $value: 0.2 },
    thinning: { $value: 0.2 },
    taper: { $value: 4 },
  },
  surface: { radius: { $type: "dimension", $value: { value: 2, unit: "px" } } },
  frame: {
    width: { $type: "dimension", $value: { value: 1, unit: "px" } },
    alpha: { $type: "number", $value: 0.42 },
  },
});

const property = (css: string, name: string) =>
  css.match(new RegExp(`\n  ${name}: ([^;]+);`))?.[1];

const MODE = `$extensions["${THEME_TOKENS_VENDOR}"].mode`;

describe("generateThemeCss", () => {
  it("writes the tokens' choices as the editor's custom properties", () => {
    const { css } = generateThemeCss(tokens());

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

  it("moves illegible text until it passes, and names the token", () => {
    const { css, warnings } = generateThemeCss(tokens({ ink: "#c8c0b0" }));
    const text = property(css, "--text-primary-color")!;

    expect(contrastRatio(text, "#f1ebdf")).toBeGreaterThanOrEqual(7);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        token: "color.ink",
        from: "#c8c0b0",
        to: text,
      }),
    );
  });

  it("has nothing to report for a legible theme", () => {
    expect(
      generateThemeCss(tokens({ panel: "#ffffff" })).warnings.filter(
        ({ token }) => token === "color.ink",
      ),
    ).toEqual([]);
  });

  it("stores a dark theme's element colors so dark mode shows them", () => {
    const { css } = generateThemeCss(
      tokens({
        mode: "dark",
        canvas: "#0b0c0e",
        ink: "#ece8e0",
        panel: "#121316",
      }),
    );

    expect(property(css, "--element-stroke-color")).toBe(
      removeDarkModeFilter("#ece8e0"),
    );
  });

  it("warns when the canvas is dark but the mode is light", () => {
    expect(
      generateThemeCss(tokens({ canvas: "#050a06", ink: "#39ff6a" })).warnings,
    ).toContainEqual(expect.objectContaining({ token: MODE }));
  });

  it("warns when dark mode cannot display an element color", () => {
    const { warnings } = generateThemeCss(
      tokens({
        mode: "dark",
        canvas: "#050a06",
        ink: "#39ff6a",
        panel: "#07120a",
      }),
    );

    expect(warnings).toContainEqual(
      expect.objectContaining({ token: "color.ink", from: "#39ff6a" }),
    );
  });

  it("pales a palette wash until ink labels read on it, and says so", () => {
    const ink = "#4a4a4a";
    const { warnings } = generateThemeCss(
      tokens({ ink, palette: ["#000000", "#5a7a6a", "#4f7088", "#a8732f"] }),
    );
    const wash = warnings.find(
      ({ token, reason }) =>
        token === "color.palette.hue-0" && reason.includes("wash"),
    );

    expect(wash).toBeDefined();
    expect(contrastRatio(ink, wash!.from)).toBeLessThan(4.5);
    expect(contrastRatio(ink, wash!.to)).toBeGreaterThanOrEqual(4.5);
  });

  it("is deterministic", () => {
    expect(generateThemeCss(tokens()).css).toBe(generateThemeCss(tokens()).css);
  });
});
