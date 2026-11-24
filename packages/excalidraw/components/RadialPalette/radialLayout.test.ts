import {
  HUB_RADIUS,
  MAX_SLOTS,
  MIDDLE_BAND,
  MIN_RING_SCALE,
  OPACITY_SLIDER,
  OUTER_BAND,
  RING_RADIUS,
  SIZE_SLIDER,
  SLOT_SIZE,
  TOOLS_BAND,
  getRingLayout,
  hitTest,
  placeRing,
  polar,
  sectorMiddle,
  sliderValue,
  slotCenters,
  slotsToward,
  toPolar,
} from "./radialLayout";

import type { RingLayout } from "./radialLayout";

const COUNTS = { tools: 10, pens: 6, colors: 12 };

const middleOf = (band: { inner: number; outer: number }) =>
  (band.inner + band.outer) / 2;

describe("radialLayout", () => {
  let layout: RingLayout;

  beforeEach(() => {
    layout = getRingLayout(COUNTS);
  });

  describe("when a pointer lands in the hub", () => {
    it("hits the hub", () => {
      expect(hitTest(layout, 0, HUB_RADIUS - 1)).toEqual({ kind: "hub" });
    });
  });

  describe("when a pointer lands straight above the center in the tools band", () => {
    it("hits the first tool", () => {
      expect(hitTest(layout, 0, -middleOf(TOOLS_BAND))).toEqual({
        kind: "tool",
        index: 0,
      });
    });
  });

  describe.each([
    ["tool", TOOLS_BAND, "tools"],
    ["pen", MIDDLE_BAND, "pens"],
    ["color", OUTER_BAND, "colors"],
  ] as const)(
    "when a pointer lands in the middle of each %s",
    (kind, band, sectors) => {
      it("hits that one", () => {
        layout[sectors].forEach((sector, index) => {
          const { x, y } = polar(middleOf(band), sectorMiddle(sector));
          expect(hitTest(layout, x, y)).toEqual({ kind, index });
        });
      });
    },
  );

  describe("when a pointer lands straight below the center in the pens band", () => {
    it("hits a pen, all the way round", () => {
      expect(hitTest(layout, 0, middleOf(MIDDLE_BAND))).toEqual({
        kind: "pen",
        index: COUNTS.pens / 2,
      });
    });
  });

  describe("when a pointer lands past the ring", () => {
    it("hits nothing", () => {
      expect(hitTest(layout, RING_RADIUS + 5, 0)).toBeNull();
    });
  });

  describe("when a pointer lands on the size arc", () => {
    describe("with the size arc shown", () => {
      it("hits the size slider", () => {
        const { x, y } = polar(middleOf(OUTER_BAND), 135);
        expect(hitTest(layout, x, y)).toMatchObject({ kind: "size" });
      });
    });

    describe("with the size arc hidden", () => {
      it("hits nothing", () => {
        const { x, y } = polar(middleOf(OUTER_BAND), 135);
        expect(hitTest(layout, x, y, { size: false })).toBeNull();
      });
    });
  });

  describe.each([
    ["size", SIZE_SLIDER],
    ["opacity", OPACITY_SLIDER],
  ] as const)("the %s slider", (_, slider) => {
    it("is 0 at its start", () => {
      expect(sliderValue(slider, slider.from)).toBeCloseTo(0, 9);
    });

    it("is 1 at its end", () => {
      expect(sliderValue(slider, slider.to)).toBeCloseTo(1, 9);
    });

    it("is a half at its middle", () => {
      expect(sliderValue(slider, (slider.from + slider.to) / 2)).toBeCloseTo(
        0.5,
        9,
      );
    });

    it("clamps past its end to 1", () => {
      expect(
        sliderValue(
          slider,
          slider.to + Math.sign(slider.to - slider.from) * 20,
        ),
      ).toBe(1);
    });

    it("clamps past its start to 0", () => {
      expect(
        sliderValue(
          slider,
          slider.from + Math.sign(slider.from - slider.to) * 20,
        ),
      ).toBe(0);
    });
  });

  describe("placeRing", () => {
    describe("when the anchor leaves room for the ring", () => {
      it("centers the ring on the anchor at full size", () => {
        expect(
          placeRing({ x: 500, y: 400 }, { width: 1000, height: 800 }),
        ).toEqual({ x: 500, y: 400, scale: 1 });
      });
    });

    describe("when the anchor sits in a corner", () => {
      it("moves the ring just inside the editor", () => {
        expect(
          placeRing({ x: 990, y: 790 }, { width: 1000, height: 800 }, 8),
        ).toEqual({
          x: 1000 - RING_RADIUS - 8,
          y: 800 - RING_RADIUS - 8,
          scale: 1,
        });
      });
    });

    describe("when the person has scaled the ring up", () => {
      it("draws it at their size where it fits", () => {
        expect(
          placeRing({ x: 500, y: 400 }, { width: 1000, height: 800 }, 8, 1.4)
            .scale,
        ).toBe(1.4);
      });

      it("draws it no bigger than the editor holds", () => {
        expect(
          placeRing({ x: 200, y: 200 }, { width: 400, height: 400 }, 8, 1.6)
            .scale,
        ).toBe((200 - 8) / RING_RADIUS);
      });
    });

    describe("when the editor has no size yet", () => {
      it("keeps the ring at its smallest usable size", () => {
        expect(placeRing({ x: 0, y: 0 }, { width: 0, height: 0 }).scale).toBe(
          MIN_RING_SCALE,
        );
      });
    });

    describe("when the editor is narrower than the ring", () => {
      it("shrinks the ring to fit its width", () => {
        const { x, scale } = placeRing(
          { x: 300, y: 400 },
          { width: 300, height: 800 },
          8,
        );
        expect(x - RING_RADIUS * scale).toBeCloseTo(8, 9);
        expect(x + RING_RADIUS * scale).toBeCloseTo(300 - 8, 9);
      });
    });
  });
});

describe("slotCenters", () => {
  const angleOf = ({ x, y }: { x: number; y: number }) =>
    Math.round(toPolar(x, y).angle);

  it("centers the slots on the top of the ring, left to right", () => {
    const angles = slotCenters(3).map(angleOf);
    expect(angles[1]).toBe(270);
    expect(angles[0]).toBeLessThan(angles[1]);
    expect(angles[2]).toBeGreaterThan(angles[1]);
  });

  it("puts them just outside the ring, clear of each other", () => {
    const centers = slotCenters(MAX_SLOTS);
    for (const { x, y } of centers) {
      expect(Math.hypot(x, y) - SLOT_SIZE / 2).toBeGreaterThan(RING_RADIUS);
    }
    for (let index = 1; index < centers.length; index++) {
      const a = centers[index - 1];
      const b = centers[index];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(SLOT_SIZE);
    }
  });

  it("centers them on the angle they fan out at", () => {
    expect(slotCenters(1, 90).map(angleOf)).toEqual([90]);
  });
});

describe("slotsToward", () => {
  const bounds = { width: 1200, height: 800 };

  it("fans the slots up from a ring near the middle", () => {
    expect(slotsToward({ x: 600, y: 420 }, bounds)).toBe(270);
  });

  it("fans them toward the middle from a ring in a corner", () => {
    expect(Math.round(slotsToward({ x: 1000, y: 600 }, bounds))).toBe(207);
  });

  it("fans them down from a ring at the top", () => {
    expect(slotsToward({ x: 600, y: 160 }, bounds)).toBe(90);
  });

  it("shows at most MAX_SLOTS", () => {
    expect(slotCenters(MAX_SLOTS + 3)).toHaveLength(MAX_SLOTS);
  });
});
