import { MIN_ZOOM } from "@excalidraw/common";

import { flightPath } from "./viewportFlight";

import type { NormalizedZoomValue } from "./types";

const screen = { width: 1000, height: 600 };

const viewport = (scrollX: number, scrollY: number, zoom: number) => ({
  scrollX,
  scrollY,
  zoom: { value: zoom as NormalizedZoomValue },
});

/** The scene point at the center of the screen. */
const centerOf = (v: ReturnType<typeof viewport>) => ({
  x: screen.width / 2 / v.zoom.value - v.scrollX,
  y: screen.height / 2 / v.zoom.value - v.scrollY,
});

const samples = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("flightPath", () => {
  describe("between two frames 50 views apart at 4x", () => {
    // at 4x a view is 250 scene units wide
    const from = viewport(0, 0, 4);
    const target = viewport(-12_500, -3_000, 4);
    const path = flightPath(from, target, screen);

    it("starts exactly on the first viewport", () => {
      expect(path.at(0)).toEqual(from);
    });

    it("lands exactly on the target", () => {
      expect(path.at(1)).toEqual(target);
    });

    it("zooms out on the way", () => {
      const lowest = Math.min(...samples(50).map((f) => path.at(f).zoom.value));
      expect(lowest).toBeLessThan(4 / 10);
    });

    it("moves the view center monotonically toward the target", () => {
      const end = centerOf(target);
      const distances = samples(50).map((f) => {
        const c = centerOf(path.at(f));
        return Math.hypot(end.x - c.x, end.y - c.y);
      });
      const increases = distances.filter((d, i) => i && d > distances[i - 1]);
      expect(increases).toEqual([]);
    });

    it("is longer, in the paper's metric, than a hop of one view", () => {
      const hop = flightPath(from, viewport(-250, 0, 4), screen);
      expect(path.length).toBeGreaterThan(hop.length);
    });
  });

  describe("zooming in 8x without moving the center", () => {
    const from = viewport(0, 0, 1);
    const target = viewport(-437.5, -262.5, 8);
    const path = flightPath(from, target, screen);

    it("keeps the center still", () => {
      const c = centerOf(path.at(0.5));
      expect([c.x, c.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
        500, 300,
      ]);
    });

    it("is halfway, geometrically, halfway through", () => {
      expect(path.at(0.5).zoom.value).toBeCloseTo(Math.sqrt(8), 9);
    });
  });

  describe("between two views at 1x, 400 views apart", () => {
    // the optimal path zooms out to about 0.0024x
    const from = viewport(0, 0, 1);
    const target = viewport(-400_000, -100_000, 1);
    const path = flightPath(from, target, screen);
    const zooms = samples(4000).map((f) => path.at(f).zoom.value);

    it("zooms out past 10% on the way, as the optimal path does", () => {
      expect(Math.min(...zooms)).toBeLessThan(0.1);
      expect(Math.min(...zooms)).toBeGreaterThan(MIN_ZOOM);
    });

    it("starts and lands exactly on its endpoints", () => {
      expect(path.at(0)).toEqual(from);
      expect(path.at(1)).toEqual(target);
    });
  });

  describe("between two views at 1x, ten million views apart", () => {
    // uncapped, this path would zoom out to about 0.0000001x
    const from = viewport(0, 0, 1);
    const target = viewport(-10_000_000_000, -2_500_000_000, 1);
    const path = flightPath(from, target, screen);
    const views = samples(4000).map((f) => path.at(f));
    const zooms = views.map((v) => v.zoom.value);

    it("never zooms out past MIN_ZOOM", () => {
      expect(Math.min(...zooms)).toBeGreaterThanOrEqual(MIN_ZOOM * (1 - 1e-12));
    });

    it("pans across at MIN_ZOOM", () => {
      expect(Math.min(...zooms)).toBeCloseTo(MIN_ZOOM, 12);
    });

    it("starts and lands exactly on its endpoints", () => {
      expect(path.at(0)).toEqual(from);
      expect(path.at(1)).toEqual(target);
    });

    it("moves the view center monotonically toward the target", () => {
      const end = centerOf(target);
      const distances = views.map((v) => {
        const c = centerOf(v);
        return Math.hypot(end.x - c.x, end.y - c.y);
      });
      const increases = distances.filter((d, i) => i && d > distances[i - 1]);
      expect(increases).toEqual([]);
    });

    it("keeps an even pace, with no jump where the pan meets the zooms", () => {
      // each step's change in screen terms: the pan in view widths and the
      // zoom in log units
      const steps = views.slice(1).map((v, i) => {
        const [a, b] = [centerOf(views[i]), centerOf(v)];
        return (
          (Math.hypot(b.x - a.x, b.y - a.y) * v.zoom.value) / screen.width +
          Math.abs(Math.log(v.zoom.value / views[i].zoom.value))
        );
      });
      const jumps = steps.filter(
        (d, i) => i && (d > steps[i - 1] * 1.1 || d < steps[i - 1] / 1.1),
      );
      expect(jumps).toEqual([]);
    });
  });
});

describe("flightPath precision", () => {
  // 1000 px at 1x: a view is 1000 units. Up to 1e9 views (1e12 units): past
  // about 4.5e12 units a double cannot hold the target's scroll to 0.001 px
  const VIEWS = Array.from({ length: 23 }, (_, i) => 10 ** (i / 2.5));
  // a view at the zoom floor is a million views at 1x
  const FAR_VIEWS = [1e9, 1e10, 1e11, 1e12];

  /** px between where the path is just before landing and the target */
  const landingMiss = (views: number) => {
    const from = viewport(0, 0, 1);
    const target = viewport(-views * 1000 * 0.8, -views * 1000 * 0.6, 1);
    const path = flightPath(from, target, screen);
    const [a, b] = [centerOf(path.at(1 - 1e-9)), centerOf(target)];
    return Math.hypot(a.x - b.x, a.y - b.y) * target.zoom.value;
  };

  it.each(VIEWS)("lands within 0.001 px from %s views away", (views) => {
    expect(landingMiss(views)).toBeLessThan(0.001);
  });

  // past 1e9 views a flight cruises at the floor for so long that 10,000
  // samples step a whole view each, so smoothness is checked up to there
  it.each(VIEWS)(
    "stays finite and moves smoothly from %s views away",
    (views) => {
      const from = viewport(0, 0, 1);
      const target = viewport(-views * 1000 * 0.8, -views * 1000 * 0.6, 1);
      const path = flightPath(from, target, screen);
      const views_ = samples(10_000).map((f) => path.at(f));
      for (const v of views_) {
        expect(Number.isFinite(v.scrollX + v.scrollY + v.zoom.value)).toBe(
          true,
        );
      }
      // each 1e-4 of the path moves the view by less than its own width and
      // changes the zoom by less than e (the whole path is under 50 view
      // widths of the paper's metric)
      const jumps = views_.slice(1).filter((v, i) => {
        const [a, b] = [centerOf(views_[i]), centerOf(v)];
        const pan =
          (Math.hypot(b.x - a.x, b.y - a.y) *
            Math.min(v.zoom.value, views_[i].zoom.value)) /
          screen.width;
        return (
          pan > 1 || Math.abs(Math.log(v.zoom.value / views_[i].zoom.value)) > 1
        );
      });
      expect(jumps).toEqual([]);
    },
  );
  it.each([...VIEWS, ...FAR_VIEWS])(
    "is finite just before landing from %s views away",
    (views) => {
      const target = viewport(-views * 1000 * 0.8, -views * 1000 * 0.6, 1);
      const path = flightPath(viewport(0, 0, 1), target, screen);
      const v = path.at(1 - 1e-9);
      expect(Number.isFinite(v.scrollX + v.scrollY + v.zoom.value)).toBe(true);
    },
  );
});
