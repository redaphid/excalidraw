import {
  THEME_TOKENS_VENDOR,
  applyDarkModeFilter,
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
  surface?: { border: string; shadow: string };
  note?: { shadow?: string; edge?: string };
  papers?: Record<string, string>;
  noteInk?: string;
};

const tokens = ({
  mode = "light",
  canvas = "#ebe4d6",
  ink = "#1b2129",
  panel = "#f1ebdf",
  palette = ["#9e3a33", "#5a7a6a", "#4f7088", "#a8732f"],
  surface = { border: "hairline", shadow: "none" },
  note,
  papers,
  noteInk,
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
      surface,
      ...(note && { note }),
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
    ...(papers && {
      note: Object.fromEntries(
        Object.entries(papers).map(([name, hex]) => [name, color(hex)]),
      ),
    }),
    ...(noteInk && { noteInk: color(noteInk) }),
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

const picks = (css: string, name: string) => property(css, name)!.split(" ");

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

describe("generateThemeCss sticky notes", () => {
  it.each([
    ["none", "none", "none", "none"],
    ["soft", "hairline", "3 3 rgba(0, 0, 0, 0.16)", "0.5 rgba(0, 0, 0, 0.08)"],
    ["long", "hairline", "6 8 rgba(0, 0, 0, 0.2)", "0.5 rgba(0, 0, 0, 0.08)"],
    ["hard", "bold", "5 5 #1b2129", "2 #1b2129"],
  ])(
    "sits a note on a %s, %s surface the way its panels sit",
    (shadow, border, noteShadow, noteEdge) => {
      const { css } = generateThemeCss(tokens({ surface: { border, shadow } }));

      expect(property(css, "--canvas-sticky-note-shadow")).toBe(noteShadow);
      expect(property(css, "--canvas-sticky-note-edge")).toBe(noteEdge);
    },
  );

  it("takes the extension's note shadow and edge over the surface's", () => {
    const { css, warnings } = generateThemeCss(
      tokens({
        surface: { border: "bold", shadow: "hard" },
        note: { shadow: "lifted", edge: "none" },
      }),
    );

    expect(property(css, "--canvas-sticky-note-shadow")).toBe(
      "6 8 rgba(0, 0, 0, 0.2)",
    );
    expect(property(css, "--canvas-sticky-note-edge")).toBe("none");
    expect(warnings).toEqual([]);
  });

  it("gives notes the background washes and the ink without note tokens", () => {
    const { css } = generateThemeCss(tokens());
    const washes = picks(css, "--color-picks-background").slice(1);

    expect(picks(css, "--color-picks-sticky-note-background")).toEqual(washes);
    expect(property(css, "--sticky-note-background-color")).toBe(washes[0]);
    expect(property(css, "--sticky-note-stroke-color")).toBe(
      property(css, "--element-stroke-color"),
    );
    expect(picks(css, "--color-picks-sticky-note-stroke")).toEqual(
      picks(css, "--color-picks-stroke"),
    );
  });

  it("puts the theme's papers first and its note ink before the line colors", () => {
    const { css, warnings } = generateThemeCss(
      tokens({
        papers: { butter: "#f6e7b0", sky: "#d9e8f5" },
        noteInk: "#2a2018",
      }),
    );
    const washes = picks(css, "--color-picks-background").slice(1);

    expect(property(css, "--sticky-note-background-color")).toBe("#f6e7b0");
    expect(picks(css, "--color-picks-sticky-note-background")).toEqual([
      "#f6e7b0",
      "#d9e8f5",
      ...washes.slice(0, 3),
    ]);
    expect(property(css, "--sticky-note-stroke-color")).toBe("#2a2018");
    expect(picks(css, "--color-picks-sticky-note-stroke")).toEqual([
      "#2a2018",
      ...picks(css, "--color-picks-stroke").slice(1),
    ]);
    expect(warnings).toEqual([]);
  });

  it("pales a paper the note ink cannot be read on, and names its token", () => {
    const { css, warnings } = generateThemeCss(
      tokens({
        papers: { butter: "#f6e7b0", slate: "#555555" },
        noteInk: "#3a3a3a",
      }),
    );
    const paled = warnings.find(({ token }) => token === "color.note.slate");

    expect(paled).toMatchObject({ from: "#555555" });
    expect(contrastRatio("#3a3a3a", paled!.to)).toBeGreaterThanOrEqual(4.5);
    expect(picks(css, "--color-picks-sticky-note-background")[1]).toBe(
      paled!.to,
    );
    expect(warnings.map(({ token }) => token)).not.toContain(
      "color.note.butter",
    );
  });

  it("stores a dark theme's papers and checks them as dark mode shows them", () => {
    const { css, warnings } = generateThemeCss(
      tokens({
        mode: "dark",
        canvas: "#0b0c0e",
        ink: "#ece8e0",
        panel: "#121316",
        papers: { dusk: "#2c3440", clay: "#9a8f80" },
      }),
    );
    const [dusk, clay] = picks(css, "--color-picks-sticky-note-background");
    const ink = applyDarkModeFilter(
      property(css, "--sticky-note-stroke-color")!,
    );

    expect(property(css, "--sticky-note-background-color")).toBe(
      removeDarkModeFilter("#2c3440"),
    );
    expect(dusk).toBe(removeDarkModeFilter("#2c3440"));
    expect(
      contrastRatio(ink, applyDarkModeFilter(dusk)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(ink, applyDarkModeFilter(clay)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(warnings).toContainEqual(
      expect.objectContaining({ token: "color.note.clay", from: "#9a8f80" }),
    );
  });

  it("checks the note ink against its papers only: white type on black cards", () => {
    const { css, warnings } = generateThemeCss(
      tokens({
        canvas: "#f4f4f0",
        papers: { black: "#111111", red: "#d0000d" },
        noteInk: "#ffffff",
      }),
    );

    expect(property(css, "--sticky-note-stroke-color")).toBe("#ffffff");
    expect(picks(css, "--color-picks-sticky-note-background")).toEqual(
      expect.arrayContaining(["#111111", "#d0000d"]),
    );
    expect(
      warnings.filter(({ token }) => token.startsWith("color.note")),
    ).toEqual([]);
  });

  it("keeps dark ink on bright papers in a dark theme, checked as displayed", () => {
    const { css, warnings } = generateThemeCss(
      tokens({
        mode: "dark",
        canvas: "#140a24",
        ink: "#f2e9ff",
        panel: "#1b1030",
        papers: { magenta: "#ff5fd2", orange: "#ff9a3c" },
        noteInk: "#1a0b2e",
      }),
    );
    const ink = applyDarkModeFilter(
      property(css, "--sticky-note-stroke-color")!,
    );
    const [magenta, orange] = picks(css, "--color-picks-sticky-note-background")
      .slice(0, 2)
      .map((paper) => applyDarkModeFilter(paper));

    expect(contrastRatio(ink, "#140a24")).toBeLessThan(2);
    for (const paper of [magenta, orange]) {
      expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(paper, "#140a24")).toBeGreaterThan(4.5);
    }
    expect(warnings.map(({ token }) => token)).not.toContain("color.noteInk");
  });

  it("warns on the note ink when papers had to pale far, and not for a nudge", () => {
    const far = generateThemeCss(
      tokens({ papers: { mud: "#3f3a33", butter: "#f6e7b0" } }),
    ).warnings.find(({ token }) => token === "color.noteInk");
    const nudge = generateThemeCss(
      tokens({ papers: { sage: "#7a8873" } }),
    ).warnings;

    expect(far?.reason).toMatch(/^1 of 2 note papers moved \d+% toward/);
    expect(nudge).toContainEqual(
      expect.objectContaining({ token: "color.note.sage" }),
    );
    expect(nudge.map(({ token }) => token)).not.toContain("color.noteInk");
  });

  it("keeps five papers and says which it left out", () => {
    const papers = Object.fromEntries(
      ["#f6e7b0", "#d9e8f5", "#e3f0d8", "#f5dcd9", "#ebe0f2", "#f0f0f0"].map(
        (hex, i) => [`p${i}`, hex],
      ),
    );
    const { css, warnings } = generateThemeCss(tokens({ papers }));

    expect(picks(css, "--color-picks-sticky-note-background")).toEqual(
      Object.values(papers).slice(0, 5),
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ token: "color.note.p5" }),
    );
  });
});
