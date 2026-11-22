import {
  MAX_RING_SCALE,
  RING_SCALE_STORAGE_KEY,
  clampRingScale,
  loadRingScale,
  saveRingScale,
} from "./ringScale";
import { MIN_RING_SCALE } from "./radialLayout";

describe("ringScale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("when nothing is kept", () => {
    it("draws the ring at its own size", () => {
      expect(loadRingScale(window)).toBe(1);
    });
  });

  describe("when a size is kept", () => {
    beforeEach(() => {
      saveRingScale(window, 1.3);
    });

    it("draws the ring at that size", () => {
      expect(loadRingScale(window)).toBe(1.3);
    });
  });

  describe("when what is kept is not a size", () => {
    beforeEach(() => {
      localStorage.setItem(RING_SCALE_STORAGE_KEY, '"huge"');
    });

    it("draws the ring at its own size", () => {
      expect(loadRingScale(window)).toBe(1);
    });
  });

  describe("clampRingScale", () => {
    it("keeps a size between the smallest and the largest", () => {
      expect(clampRingScale(1.25)).toBe(1.25);
    });

    it("stops at the largest size", () => {
      expect(clampRingScale(10)).toBe(MAX_RING_SCALE);
    });

    it("stops at the smallest size", () => {
      expect(clampRingScale(0.1)).toBe(MIN_RING_SCALE);
    });
  });
});
