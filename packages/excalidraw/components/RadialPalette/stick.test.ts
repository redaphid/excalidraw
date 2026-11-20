import { RADIAL_TOOLS } from "./radialPaletteController";
import { STICK_DEAD, STICK_RIM, readStick } from "./stick";

const toward = (degrees: number, reach: number) => {
  const radians = (degrees * Math.PI) / 180;
  return [reach * Math.cos(radians), reach * Math.sin(radians)] as const;
};

/** screen degrees: 0 points right and -90 up */
const UP = -90;
const RECTANGLE = UP + 360 / RADIAL_TOOLS.length;

describe("readStick", () => {
  describe("when the pull is inside the dead zone", () => {
    it("rests", () => {
      expect(
        readStick(...toward(RECTANGLE, STICK_DEAD), RADIAL_TOOLS.length),
      ).toEqual({
        kind: "rest",
      });
    });
  });

  describe("when the pull points up", () => {
    it("aims at the first tool", () => {
      expect(
        readStick(...toward(UP, STICK_DEAD + 1), RADIAL_TOOLS.length),
      ).toEqual({
        kind: "aim",
        index: 0,
      });
    });
  });

  describe("when the pull points at the rectangle inside the rim", () => {
    it("aims at it", () => {
      expect(
        readStick(...toward(RECTANGLE, STICK_RIM - 1), RADIAL_TOOLS.length),
      ).toEqual({
        kind: "aim",
        index: RADIAL_TOOLS.indexOf("rectangle"),
      });
    });
  });

  describe("when the pull passes the rim", () => {
    it("picks what it aims at", () => {
      expect(
        readStick(...toward(RECTANGLE, STICK_RIM + 1), RADIAL_TOOLS.length),
      ).toEqual({
        kind: "pick",
        index: RADIAL_TOOLS.indexOf("rectangle"),
      });
    });
  });

  describe("when the pull is a little off a slice's middle", () => {
    it("still aims at that slice", () => {
      expect(
        readStick(
          ...toward(RECTANGLE + 15, STICK_RIM - 1),
          RADIAL_TOOLS.length,
        ),
      ).toEqual({
        kind: "aim",
        index: RADIAL_TOOLS.indexOf("rectangle"),
      });
    });
  });
});
