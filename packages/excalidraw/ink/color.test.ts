import { applyDarkModeFilter } from "@excalidraw/common";
import { beforeEach, describe, expect, it } from "vitest";

import { inkColor, parseHex, type Rgba } from "./color";

describe("parseHex", () => {
  describe("when the colour is Excalidraw’s default ink", () => {
    let result: Rgba | null;

    beforeEach(() => {
      result = parseHex("#1e1e1e");
    });

    it("should read its channels", () => {
      expect(result).toEqual([30 / 255, 30 / 255, 30 / 255, 1]);
    });
  });

  describe("when the colour is written short, with alpha", () => {
    let result: Rgba | null;

    beforeEach(() => {
      result = parseHex("#f008");
    });

    it("should expand each digit", () => {
      expect(result).toEqual([1, 0, 0, 0x88 / 255]);
    });
  });

  describe("when the colour is a name", () => {
    let result: Rgba | null;

    beforeEach(() => {
      result = parseHex("seagreen");
    });

    it("should leave it to the browser", () => {
      expect(result).toBeNull();
    });
  });
});

describe("inkColor", () => {
  describe("when the keeper draws in the lamp-room red", () => {
    const resolve = () => [0, 0, 0, 1] as Rgba;

    describe("when the board is light and the ink opaque", () => {
      let result: Rgba;

      beforeEach(() => {
        result = inkColor("#e03131", { dark: false, opacity: 100, resolve });
      });

      it("should draw it as it is", () => {
        expect(result).toEqual([0xe0 / 255, 0x31 / 255, 0x31 / 255, 1]);
      });
    });

    describe("when the ink is at half opacity", () => {
      let result: Rgba;

      beforeEach(() => {
        result = inkColor("#ffffff", { dark: false, opacity: 50, resolve });
      });

      it("should premultiply it", () => {
        expect(result).toEqual([0.5, 0.5, 0.5, 0.5]);
      });
    });

    describe("when the board is dark", () => {
      let result: Rgba;

      beforeEach(() => {
        result = inkColor("#e03131", { dark: true, opacity: 100, resolve });
      });

      it("should paint it as Excalidraw paints the committed stroke", () => {
        expect(result).toEqual(parseHex(applyDarkModeFilter("#e03131")));
      });
    });

    describe("when the board is dark and the ink is Excalidraw’s default", () => {
      let result: Rgba;

      beforeEach(() => {
        result = inkColor("#1e1e1e", { dark: true, opacity: 100, resolve });
      });

      it("should come out light, as Excalidraw rounds it", () => {
        expect(result).toEqual([211 / 255, 211 / 255, 211 / 255, 1]);
      });
    });

    describe("when the colour is a name", () => {
      let result: Rgba;

      beforeEach(() => {
        result = inkColor("seagreen", {
          dark: false,
          opacity: 100,
          resolve: () => [0.18, 0.55, 0.34, 1],
        });
      });

      it("should ask the browser what it is", () => {
        expect(result).toEqual([0.18, 0.55, 0.34, 1]);
      });
    });

    describe("when the colour is a name and the board is dark", () => {
      let result: Rgba;

      beforeEach(() => {
        result = inkColor("seagreen", { dark: true, opacity: 100, resolve });
      });

      it("should paint it as Excalidraw paints the committed stroke", () => {
        expect(result).toEqual(parseHex(applyDarkModeFilter("seagreen")));
      });
    });
  });
});
