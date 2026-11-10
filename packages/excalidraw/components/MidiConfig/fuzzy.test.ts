import { fuzzyFilter, fuzzyScore } from "./fuzzy";

const rows = [
  "style.strokeWidth Stroke width",
  "style.opacity Opacity",
  "colour.backgroundHue Background hue",
  "colour.backgroundLightness Background lightness",
  "colour.strokeLightness Stroke lightness",
  "edit.layer Layer",
  "view.zoom Zoom",
];

describe("fuzzyScore", () => {
  it("matches letters in order, with gaps", () => {
    expect(fuzzyScore("opa", "style.opacity")).not.toBeNull();
    expect(fuzzyScore("sty", "style.opacity")).not.toBeNull();
    expect(fuzzyScore("apo", "style.opacity")).toBeNull();
  });

  it("skips within a word but only jumps to the start of the next", () => {
    expect(fuzzyScore("bg", "Background hue")).not.toBeNull();
    expect(fuzzyScore("bgl", "backgroundLightness")).not.toBeNull();
    // scattered over a sentence, it isn't a match
    expect(
      fuzzyScore(
        "accel",
        "How see-through the selection (or the next shape) is",
      ),
    ).toBeNull();
  });

  it("needs every word", () => {
    expect(fuzzyScore("bg light", rows[3])).not.toBeNull();
    expect(fuzzyScore("bg light zoom", rows[3])).toBeNull();
  });

  it("matches anything with no query", () => {
    expect(fuzzyScore("  ", "whatever")).toBe(0);
  });
});

describe("fuzzyFilter", () => {
  const find = (query: string) => fuzzyFilter(query, rows, (row) => row);

  it("ranks the tight match first", () => {
    expect(find("opa")[0]).toBe("style.opacity Opacity");
    expect(find("zoom")[0]).toBe("view.zoom Zoom");
  });

  it("reads word starts, so an abbreviation finds its property", () => {
    expect(find("bgl")[0]).toBe(
      "colour.backgroundLightness Background lightness",
    );
    expect(find("sw")[0]).toBe("style.strokeWidth Stroke width");
    expect(find("stroke light")[0]).toBe(
      "colour.strokeLightness Stroke lightness",
    );
  });

  it("leaves the order alone with no query", () => {
    expect(find("")).toEqual(rows);
  });

  it("drops what doesn't match", () => {
    expect(find("tempo")).toEqual([]);
  });
});
