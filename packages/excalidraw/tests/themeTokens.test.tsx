import fs from "node:fs";
import path from "node:path";

import {
  FONT_FAMILY,
  THEME_TOKENS_VENDOR,
  generateThemeCss,
} from "@excalidraw/common";

import type { ThemeTokens } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { act, render } from "./test-utils";

const { h } = window;

const tokens: ThemeTokens = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../themes/architect-parchment.tokens.json"),
    "utf8",
  ),
);

describe("a theme generated from tokens", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  it("is what the editor reads back", async () => {
    await render(<Excalidraw css={generateThemeCss(tokens).css} />);

    expect({
      background: h.app.cssTheme.canvas.background,
      gridStyle: h.app.cssTheme.canvas.gridStyle,
      roughness: h.state.currentItemRoughness,
      font: h.state.currentItemFontFamily,
      pen: h.app.cssTheme.pen,
    }).toEqual({
      background: "#ebe4d6",
      gridStyle: "solid",
      roughness: 0,
      font: FONT_FAMILY["Liberation Sans"],
      pen: { thinning: 0.2, taper: 4 },
    });
  });

  it("keeps a backdrop with single quotes and an apostrophe", async () => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><title>Aaron's paper (draft)</title><circle cx='5' cy='5' r='1'/></svg>`;
    const extensions = tokens.$extensions as Record<string, object>;
    const withBackdrop = {
      ...tokens,
      $extensions: {
        [THEME_TOKENS_VENDOR]: {
          ...extensions[THEME_TOKENS_VENDOR],
          backdrop: { image: svg, size: 40 },
        },
      },
    } as ThemeTokens;

    await render(<Excalidraw css={generateThemeCss(withBackdrop).css} />);

    const { backdropImage, backdropSize } = h.app.cssTheme.canvas;
    const [header, data] = backdropImage!.split(",");
    expect({ header, svg: decodeURIComponent(data), backdropSize }).toEqual({
      header: "data:image/svg+xml",
      svg,
      backdropSize: 40,
    });
  });
});
