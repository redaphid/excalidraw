import { FONT_FAMILY, THEME } from "@excalidraw/common";

import { readCssTheme } from "../cssTheme";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, render } from "./test-utils";

const { h } = window;

const styleOf = (properties: Record<string, string>) => ({
  getPropertyValue: (name: string) => properties[name] ?? "",
});

const THEME_CSS = `:scope {
  --canvas-background: #f4ecd8;
  --canvas-grid-color: rgba(60, 90, 120, 0.12);
  --canvas-grid-bold-color: #9fb3c4;
  --canvas-grid-style: solid;
  --canvas-handle-fill: #f4ecd8;
  --element-stroke-color: #14181f;
  --element-stroke-width: thin;
  --element-roughness: 0;
  --element-roundness: round;
  --element-font-family: "Liberation Sans";
  --element-end-arrowhead: triangle;
  --color-picks-stroke: #14181f #9e3833 #c79e52 #5b7a8f #8c4d80;
}`;

describe("readCssTheme", () => {
  it("parses canvas colors and new-element defaults", () => {
    const theme = readCssTheme(
      styleOf({
        "--canvas-background": " #f4ecd8",
        "--canvas-grid-color": "rgba(0, 0, 0, 0.1)",
        "--canvas-grid-style": "solid",
        "--color-selection": "#c79e52",
        "--element-stroke-color": "#14181f",
        "--element-stroke-width": "thin",
        "--element-roughness": "0",
        "--element-roundness": "sharp",
        "--element-font-family": '"Liberation Sans"',
        "--element-font-size": "16",
        "--element-start-arrowhead": "none",
        "--element-end-arrowhead": "bar",
        "--element-freedraw-variability": "constant",
        "--color-picks-background": "transparent, #e8dcc0, #c9d8e2",
      }),
    );

    expect(theme.canvas).toEqual({
      background: "#f4ecd8",
      gridColor: "rgba(0, 0, 0, 0.1)",
      gridStyle: "solid",
      selectionColor: "#c79e52",
    });
    expect(theme.appState).toEqual({
      currentItemStrokeColor: "#14181f",
      currentItemStrokeWidthKey: "thin",
      currentItemRoughness: 0,
      currentItemRoundness: "sharp",
      currentItemFontFamily: FONT_FAMILY["Liberation Sans"],
      currentItemFontSize: 16,
      currentItemStartArrowhead: null,
      currentItemEndArrowhead: "bar",
      currentItemStrokeVariability: "constant",
      colorTopPicks: {
        elementBackground: ["transparent", "#e8dcc0", "#c9d8e2"],
      },
    });
  });

  it("leaves out malformed values instead of guessing", () => {
    const theme = readCssTheme(
      styleOf({
        "--canvas-grid-style": "wavy",
        "--element-stroke-color": "rgb(1, 2, 3)",
        "--element-roughness": "3",
        "--element-font-family": "Comic Sans MS",
        "--element-font-size": "-4",
        "--element-end-arrowhead": "harpoon",
        "--color-picks-stroke": "#111 not-a-color",
      }),
    );

    expect(theme).toEqual({ canvas: {}, appState: {}, palettes: {} });
  });

  it("parses palettes of single colors and five-shade entries", () => {
    const theme = readCssTheme(
      styleOf({
        "--color-palette-stroke":
          "#1b2129, #ddc5b9 #cea398 #be8177 #ad5c54 #9e3a33",
        "--color-palette-background": "transparent, #f4efe4",
        "--canvas-frame-width": "1",
      }),
    );

    expect(theme.palettes).toEqual({
      elementStroke: {
        "#1b2129": "#1b2129",
        "#ddc5b9": ["#ddc5b9", "#cea398", "#be8177", "#ad5c54", "#9e3a33"],
      },
      elementBackground: { transparent: "transparent", "#f4efe4": "#f4efe4" },
    });
    expect(theme.canvas.frameWidth).toBe(1);
  });

  it("drops a palette with a malformed entry", () => {
    const theme = readCssTheme(
      styleOf({ "--color-palette-stroke": "#111, #222 #333" }),
    );
    expect(theme.palettes).toEqual({});
  });

  it("is empty when no property is set", () => {
    expect(readCssTheme(styleOf({}))).toEqual({
      canvas: {},
      appState: {},
      palettes: {},
    });
  });
});

describe("css prop", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  it("keeps upstream defaults without css", async () => {
    await render(<Excalidraw />);

    expect(h.app.cssTheme.canvas.background).toBeUndefined();
    expect(h.app.cssTheme.canvas.gridColor).toBeUndefined();
    expect(h.app.cssTheme.appState).toEqual({});

    const rectangle = UI.createElement("rectangle", { width: 40, height: 40 });
    expect(rectangle.roughness).toBe(1);
    expect(rectangle.strokeWidth).toBe(2);
    expect(rectangle.strokeColor).toBe("#1e1e1e");
    // the test environment's default
    expect(rectangle.roundness).toBeNull();
  });

  it("reads canvas colors and draws new elements in the theme's style", async () => {
    await render(<Excalidraw css={THEME_CSS} />);

    expect(h.app.cssTheme.canvas).toMatchObject({
      background: "#f4ecd8",
      gridColor: "rgba(60, 90, 120, 0.12)",
      gridBoldColor: "#9fb3c4",
      gridStyle: "solid",
      handleFill: "#f4ecd8",
    });
    expect(h.state.colorTopPicks.elementStroke).toEqual([
      "#14181f",
      "#9e3833",
      "#c79e52",
      "#5b7a8f",
      "#8c4d80",
    ]);

    const rectangle = UI.createElement("rectangle", { width: 40, height: 40 });
    expect(rectangle.roughness).toBe(0);
    expect(rectangle.strokeWidth).toBe(1);
    expect(rectangle.strokeColor).toBe("#14181f");
    expect(rectangle.roundness).not.toBeNull();

    const arrow = UI.createElement("arrow", { width: 80, height: 0 });
    expect(arrow.endArrowhead).toBe("triangle");
  });

  it("leaves existing elements alone", async () => {
    const rectangle = API.createElement({ type: "rectangle", roughness: 2 });
    await render(
      <Excalidraw css={THEME_CSS} initialData={{ elements: [rectangle] }} />,
    );

    expect(h.elements[0].roughness).toBe(2);
    expect(h.elements[0].strokeWidth).toBe(rectangle.strokeWidth);
  });

  it("keeps the user's own picks across a light/dark toggle", async () => {
    const { rerender } = await render(
      <Excalidraw css={THEME_CSS} theme={THEME.LIGHT} />,
    );
    API.setAppState({ currentItemRoughness: 2 });

    rerender(<Excalidraw css={THEME_CSS} theme={THEME.DARK} />);
    await act(async () => {});

    expect(h.state.theme).toBe(THEME.DARK);
    expect(h.state.currentItemRoughness).toBe(2);
  });

  it("shows the theme's palette in the color picker", async () => {
    // radix popovers measure themselves
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    await render(
      <Excalidraw css=":scope { --color-palette-stroke: #1b2129, #9e3a33, #5a7a6a; }" />,
    );
    const rectangle = UI.createElement("rectangle", { width: 40, height: 40 });
    API.setAppState({
      selectedElementIds: { [rectangle.id]: true },
      openPopup: "elementStroke",
    });
    await act(async () => {});

    const swatches = [
      ...document.querySelectorAll<HTMLElement>(".color-picker__button--large"),
    ].map((swatch) => swatch.style.getPropertyValue("--swatch-color"));
    expect(swatches).toEqual(
      expect.arrayContaining(["#1b2129", "#9e3a33", "#5a7a6a"]),
    );
    // upstream's red and blue
    expect(swatches).not.toContain("#e03131");
    expect(swatches).not.toContain("#1971c2");
  });

  it("applies a changed css prop", async () => {
    const { rerender } = await render(<Excalidraw css={THEME_CSS} />);

    rerender(
      <Excalidraw
        css={`
          :scope {
            --element-roughness: 2;
            --canvas-grid-color: #123456;
          }
        `}
      />,
    );
    await act(async () => {});

    expect(h.state.currentItemRoughness).toBe(2);
    expect(h.app.cssTheme.canvas.gridColor).toBe("#123456");
    expect(h.app.cssTheme.canvas.background).toBeUndefined();
  });
});
