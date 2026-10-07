import {
  THEME_TOKENS_VENDOR,
  contrastRatio,
  generateThemeCss,
} from "@excalidraw/common";

const property = (css: string, name: string) =>
  css.match(new RegExp(`\n  ${name}: ([^;]+);`))?.[1];

/**
 * What a designer exports from Tokens Studio or Style Dictionary: colors and
 * typography in their own names, with aliases, and nothing of this profile.
 */
const DESIGNER_EXPORT = {
  color: {
    $type: "color",
    neutral: {
      "0": { $value: "#fbfaf7" },
      "900": { $value: "#1c1b19" },
      "500": { $value: "#7a766f" },
    },
    background: { $value: "{color.neutral.0}" },
    text: { $value: "{color.neutral.900}" },
    brand: { primary: { $value: "#0f62fe" } },
    red: { $value: "#da1e28" },
    green: { $value: "#24a148" },
    yellow: { $value: "#f1c21b" },
    purple: { $value: "#8a3ffc" },
  },
  font: {
    family: {
      sans: {
        $type: "fontFamily",
        $value: ["Inter", "Helvetica", "sans-serif"],
      },
      mono: { $type: "fontFamily", $value: "IBM Plex Mono" },
    },
    size: {
      body: { $type: "dimension", $value: { value: 1, unit: "rem" } },
    },
  },
  typography: {
    body: {
      $type: "typography",
      $value: {
        fontFamily: "{font.family.sans}",
        fontSize: "{font.size.body}",
        fontWeight: 400,
        lineHeight: 1.5,
      },
    },
  },
};

describe("a designer's design tokens export", () => {
  const { css, warnings } = generateThemeCss(DESIGNER_EXPORT);

  it("paints the canvas its background color, through the alias", () => {
    expect(property(css, "--canvas-background")).toBe("#fbfaf7");
  });

  it("selects in its brand color", () => {
    expect(property(css, "--color-selection")).toBe("#0f62fe");
  });

  it("keeps UI text legible", () => {
    expect(
      contrastRatio(
        property(css, "--text-primary-color")!,
        property(css, "--island-bg-color")!,
      ),
    ).toBeGreaterThanOrEqual(7);
  });

  it("uses its UI fonts, with the generic family unquoted", () => {
    expect(property(css, "--ui-font")).toBe(
      '"Inter", "Helvetica", sans-serif, system-ui, sans-serif',
    );
  });

  it("draws text in the first of its fonts the editor has, at its size", () => {
    expect({
      family: property(css, "--element-font-family"),
      size: property(css, "--element-font-size"),
    }).toEqual({ family: '"Helvetica"', size: "16" });
  });

  it("takes its other colors as the palette, in order, without canvas or ink", () => {
    expect(
      property(css, "--color-picks-stroke")?.split(" ").slice(0, 4),
    ).toEqual(["#1c1b19", "#7a766f", "#da1e28", "#24a148"]);
  });

  it("follows its light background into light mode", () => {
    expect(css.startsWith("/* Design tokens. mode: light */")).toBe(true);
  });

  it("reports how each role was read, by token path", () => {
    expect(warnings.map(({ token }) => token)).toEqual(
      expect.arrayContaining([
        "color.background",
        "color.text",
        "color.brand.primary",
        "color.palette",
        "font.family.sans",
      ]),
    );
  });

  it("names a token path in every warning", () => {
    expect(
      warnings.filter(({ token }) => !/^(color|font)\./.test(token)),
    ).toEqual([]);
  });
});

describe("reading design tokens", () => {
  const theme = (color: Record<string, unknown>) =>
    generateThemeCss({
      color: { $type: "color", ...color },
      $extensions: { [THEME_TOKENS_VENDOR]: { name: "Probe" } },
    });

  it("resolves aliases in chains and JSON pointer references", () => {
    const { css } = theme({
      canvas: { $value: "#ffffff" },
      ink: { $value: "#222222" },
      base: { $value: "#0f62fe" },
      brand: { $value: "{color.base}" },
      accent: { $ref: "#/color/brand/$value" },
    });

    expect(property(css, "--color-selection")).toBe("#0f62fe");
  });

  it("reports a circular alias and falls back", () => {
    const { warnings } = theme({
      canvas: { $value: "#ffffff" },
      ink: { $value: "{color.accent}" },
      accent: { $value: "{color.ink}" },
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({
        token: "color.ink",
        reason: expect.stringContaining("circular"),
      }),
    );
  });

  it("reads another color space through its hex fallback", () => {
    const { css } = theme({
      canvas: {
        $value: {
          colorSpace: "oklch",
          components: [0.98, 0.01, 90],
          hex: "#faf8f2",
        },
      },
    });

    expect(property(css, "--canvas-background")).toBe("#faf8f2");
  });

  it("reports a color it cannot read and uses Excalidraw's", () => {
    const { css, warnings } = theme({
      canvas: { $value: { colorSpace: "oklch", components: [0.98, 0.01, 90] } },
    });

    expect({
      background: property(css, "--canvas-background"),
      warned: warnings.some(({ token }) => token === "color.canvas"),
    }).toEqual({ background: "#ffffff", warned: true });
  });

  it("goes dark on a dark canvas when no mode is set", () => {
    const { css, warnings } = theme({
      canvas: { $value: "#0b0c0e" },
      ink: { $value: "#ece8e0" },
    });

    expect({
      header: css.split("\n")[0],
      modeWarnings: warnings.filter(({ token }) => token.endsWith(".mode")),
    }).toEqual({ header: "/* Probe. mode: dark */", modeWarnings: [] });
  });

  it("rejects a document that is not an object", () => {
    expect(() => generateThemeCss([] as never)).toThrow(TypeError);
  });
});
