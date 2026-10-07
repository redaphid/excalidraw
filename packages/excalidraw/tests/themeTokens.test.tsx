import fs from "node:fs";
import path from "node:path";

import { FONT_FAMILY, generateThemeCss } from "@excalidraw/common";

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
});
