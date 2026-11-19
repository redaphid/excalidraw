import { readFileSync } from "fs";
import path from "path";

// The `--control-*` tokens draw reads, each with a fallback, to style its own
// controls like the radial palette (redaphid/draw #575, #583, #584). A
// renamed or dropped token here leaves draw on its fallback without a sound.
const DRAW_CONTROL_TOKENS = [
  "--control-accent",
  "--control-active-width",
  "--control-font",
  "--control-icon-size",
  "--control-ink",
  "--control-knob-width",
  "--control-motion-duration",
  "--control-motion-easing",
  "--control-radius",
  "--control-rule",
  "--control-rule-width",
  "--control-shadow",
  "--control-surface",
  "--control-surface-active",
  "--control-surface-hover",
  "--control-text",
  "--control-track-width",
];

const themeScss = readFileSync(path.resolve(__dirname, "theme.scss"), "utf8");

/** the custom properties declared directly in the `.excalidraw { }` block */
const declaredOnEditor = () => {
  const block = themeScss.slice(themeScss.indexOf(".excalidraw {"));
  const body = block.slice(0, block.search(/\n {2}&|\n}/));
  return new Set(
    [...body.matchAll(/^\s*(--control-[a-z-]+):/gm)].map((match) => match[1]),
  );
};

describe("the control style tokens", () => {
  it("declares every token draw reads on the editor root", () => {
    const declared = declaredOnEditor();
    expect(
      DRAW_CONTROL_TOKENS.filter((token) => !declared.has(token)),
    ).toEqual([]);
  });
});
