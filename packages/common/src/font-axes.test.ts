import {
  FONT_FAMILY,
  getFontAxisRanges,
  getFontInstanceFamily,
  getFontString,
  getFontVariationSettings,
  normalizeFontAxes,
} from "@excalidraw/common";

const SHANTELL = FONT_FAMILY["Shantell Sans"];

describe("font axes", () => {
  describe("the registry", () => {
    it("knows the axes of a variable family", () => {
      expect(Object.keys(getFontAxisRanges(SHANTELL)!)).toEqual([
        "wght",
        "INFM",
        "BNCE",
        "SPAC",
      ]);
    });

    it("keeps every default inside its axis", () => {
      for (const { min, default: regular, max } of Object.values(
        getFontAxisRanges(SHANTELL)!,
      )) {
        expect(min <= regular && regular <= max).toBe(true);
      }
    });

    it("has no axes for a family with one instance", () => {
      expect(getFontAxisRanges(FONT_FAMILY.Excalifont)).toBeUndefined();
    });
  });

  describe("normalizeFontAxes", () => {
    it("keeps values inside their axes as they are", () => {
      expect(normalizeFontAxes(SHANTELL, { wght: 650, BNCE: -40 })).toEqual({
        wght: 650,
        BNCE: -40,
      });
    });

    it("clamps a value to its axis", () => {
      expect(
        normalizeFontAxes(SHANTELL, { wght: 1000, BNCE: -250, SPAC: -1 }),
      ).toEqual({ wght: 800, BNCE: -100, SPAC: 0 });
    });

    it("rounds a value to whole units", () => {
      expect(normalizeFontAxes(SHANTELL, { wght: 512.4 })).toEqual({
        wght: 512,
      });
    });

    it("drops a tag the family does not have", () => {
      expect(normalizeFontAxes(SHANTELL, { wght: 500, slnt: -10 })).toEqual({
        wght: 500,
      });
    });

    it("drops a value that is not a finite number", () => {
      expect(
        normalizeFontAxes(SHANTELL, { wght: "bold", BNCE: NaN, INFM: 30 }),
      ).toEqual({ INFM: 30 });
    });

    it("gives nothing when nothing is left", () => {
      expect(normalizeFontAxes(SHANTELL, { slnt: -10 })).toBeUndefined();
    });

    it("gives nothing for a family without axes", () => {
      expect(
        normalizeFontAxes(FONT_FAMILY.Excalifont, { wght: 700 }),
      ).toBeUndefined();
    });

    it("gives nothing for what is not an object", () => {
      expect(normalizeFontAxes(SHANTELL, "wght 700")).toBeUndefined();
    });
  });

  describe("getFontInstanceFamily", () => {
    it("names the axes that are off their defaults, in the family's order", () => {
      expect(
        getFontInstanceFamily(SHANTELL, { BNCE: -40, wght: 650, INFM: 0 }),
      ).toBe("Shantell Sans wght650 BNCE-40");
    });

    it("names the same family for values that clamp to the same instance", () => {
      expect(getFontInstanceFamily(SHANTELL, { wght: 9000 })).toBe(
        getFontInstanceFamily(SHANTELL, { wght: 800 }),
      );
    });

    it("is nothing for the regular instance", () => {
      expect(getFontInstanceFamily(SHANTELL, { wght: 400 })).toBeUndefined();
    });

    it("is nothing without axes", () => {
      expect(getFontInstanceFamily(SHANTELL, undefined)).toBeUndefined();
    });

    it("is nothing for a family without axes", () => {
      expect(
        getFontInstanceFamily(FONT_FAMILY.Excalifont, { wght: 700 }),
      ).toBeUndefined();
    });
  });

  describe("getFontVariationSettings", () => {
    it("names every axis of the family, defaults included", () => {
      expect(getFontVariationSettings(SHANTELL, { wght: 650, BNCE: -40 })).toBe(
        '"wght" 650, "INFM" 0, "BNCE" -40, "SPAC" 0',
      );
    });

    it("is the regular instance's without axes", () => {
      expect(getFontVariationSettings(SHANTELL)).toBe(
        '"wght" 400, "INFM" 0, "BNCE" 0, "SPAC" 0',
      );
    });

    it("is nothing for a family without axes", () => {
      expect(
        getFontVariationSettings(FONT_FAMILY.Excalifont, { wght: 700 }),
      ).toBeUndefined();
    });
  });

  describe("getFontString", () => {
    it("names the instance's family before the family itself", () => {
      expect(
        getFontString({
          fontSize: 96,
          fontFamily: SHANTELL,
          fontAxes: { wght: 650, BNCE: 40 },
        }),
      ).toBe(
        '96px "Shantell Sans wght650 BNCE40", Shantell Sans, sans-serif, Segoe UI Emoji',
      );
    });

    it("names the family alone for the regular instance", () => {
      expect(getFontString({ fontSize: 96, fontFamily: SHANTELL })).toBe(
        "96px Shantell Sans, sans-serif, Segoe UI Emoji",
      );
    });

    it("leaves a family without axes as it was", () => {
      expect(
        getFontString({
          fontSize: 20,
          fontFamily: FONT_FAMILY.Nunito,
          fontAxes: { wght: 700 },
        }),
      ).toBe("20px Nunito, sans-serif, Segoe UI Emoji");
    });
  });
});
