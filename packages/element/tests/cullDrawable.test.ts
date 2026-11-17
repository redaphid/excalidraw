import { cullDrawableToView } from "../src/cullDrawable";

import type { Drawable, Op } from "roughjs/bin/core";

// the view a 1440×900 canvas shows, at 2 device px a unit
const VIEW = { width: 2880, height: 1800 };

const zoomed = (zoom: number) => ({
  a: 2 * zoom,
  b: 0,
  c: 0,
  d: 2 * zoom,
  e: 0,
  f: 0,
});

const drawable = (ops: Op[], options: Partial<Drawable["options"]> = {}) =>
  ({
    shape: "path",
    options: { strokeWidth: 1, ...options },
    sets: [{ type: "path", ops }],
  } as unknown as Drawable);

// a quarter circle of radius 1000 units around the origin
const quarter: Op[] = [
  { op: "move", data: [1000, 0] },
  { op: "bcurveTo", data: [1000, 552.3, 552.3, 1000, 0, 1000] },
];

const cubicAt = (p: number[], t: number) => {
  const u = 1 - t;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  return [
    u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  ];
};

/** device-px size of the largest curve the culled drawable strokes */
const largestCurve = (culled: Drawable, zoom: number) => {
  let largest = 0;
  let at = [0, 0];
  for (const { op, data } of culled.sets[0].ops) {
    if (op === "bcurveTo") {
      const xs = [at[0], data[0], data[2], data[4]];
      const ys = [at[1], data[1], data[3], data[5]];
      largest = Math.max(
        largest,
        (Math.max(...xs) - Math.min(...xs)) * 2 * zoom,
        (Math.max(...ys) - Math.min(...ys)) * 2 * zoom,
      );
    }
    at = data.slice(-2);
  }
  return largest;
};

describe("cullDrawableToView", () => {
  describe("when the drawable is about the size of the view", () => {
    it("returns it as it is", () => {
      const original = drawable(quarter);
      expect(cullDrawableToView(original, zoomed(1), VIEW)).toBe(original);
    });
  });

  describe("when a huge curve lies wholly off the view", () => {
    it("draws a straight line to its end instead", () => {
      // the arc spans 3e8 px and ends 2e8 px left of the view
      const transform = { ...zoomed(1.5e5), e: -5e8, f: 900 };
      expect(
        cullDrawableToView(drawable(quarter), transform, VIEW).sets[0].ops,
      ).toEqual([
        { op: "move", data: [1000, 0] },
        { op: "lineTo", data: [0, 1000] },
      ]);
    });
  });

  describe("when a huge curve crosses the view", () => {
    // the arc's point at 45 degrees lands on the view's centre
    const zoom = 1.5e5;
    const mid = cubicAt([1000, 0, 1000, 552.3, 552.3, 1000, 0, 1000], 0.5);
    const transform = {
      ...zoomed(zoom),
      e: 1440 - mid[0] * 2 * zoom,
      f: 900 - mid[1] * 2 * zoom,
    };

    it("strokes no curve more than 65,536 device px across", () => {
      const culled = cullDrawableToView(drawable(quarter), transform, VIEW);
      expect(largestCurve(culled, zoom)).toBeLessThanOrEqual(65536);
    });

    it("keeps the piece of the curve that passes through the view", () => {
      const culled = cullDrawableToView(drawable(quarter), transform, VIEW);
      let at = [0, 0];
      let nearest = Infinity;
      for (const { op, data } of culled.sets[0].ops) {
        if (op === "bcurveTo") {
          const piece = [at[0], at[1], ...data];
          for (let t = 0; t <= 1; t += 1 / 64) {
            const [x, y] = cubicAt(piece, t);
            nearest = Math.min(nearest, Math.hypot(x - mid[0], y - mid[1]));
          }
        }
        at = data.slice(-2);
      }
      // within a hundredth of a device pixel of the original curve's point
      expect(nearest * 2 * zoom).toBeLessThan(0.01);
    });
  });

  describe("when the stroke is dashed", () => {
    it("returns it as it is, since a shorter path would shift its dashes", () => {
      const original = drawable(quarter, { strokeLineDash: [8, 9] });
      const transform = { ...zoomed(1.5e5), e: 1440, f: 900 };
      expect(cullDrawableToView(original, transform, VIEW)).toBe(original);
    });
  });
});
