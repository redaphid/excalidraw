import type { Drawable, Op } from "roughjs/bin/core";

type Transform = Pick<DOMMatrix, "a" | "b" | "c" | "d" | "e" | "f">;

/**
 * The largest curve, in device px, handed to the canvas. Chromium strokes a
 * cubic in time that grows with its size on screen, not with the part of it
 * on screen: one 1e7 px across takes about 70 ms, one 1e8 px across about 7 s.
 * Zoomed far in, the shapes around the view are that big (#134).
 */
const MAX_CURVE_PX = 65536;

/** past this, a curve is split however far it is, as floats run out */
const MAX_DEPTH = 48;

/**
 * The drawable with every curve the canvas would not show replaced by a
 * straight line to its end, and every huge curve the view shows split until
 * the pieces are small, so the canvas strokes only what lands on it. A curve
 * lies within the hull of its control points, and so does its chord, so a
 * curve whose hull misses the view (grown by the stroke) changes no pixel
 * when its chord stands in for it, filled or stroked. Splitting is exact.
 * A dashed stroke is left as it is: a shorter path would move its dashes.
 * Returns the drawable itself when nothing in it is that large.
 */
export const cullDrawableToView = (
  drawable: Drawable,
  transform: Transform,
  view: { width: number; height: number },
): Drawable => {
  if (drawable.options.strokeLineDash) {
    return drawable;
  }
  const { a, b, c, d, e, f } = transform;
  const toX = (x: number, y: number) => a * x + c * y + e;
  const toY = (x: number, y: number) => b * x + d * y + f;

  const scale = Math.max(Math.hypot(a, b), Math.hypot(c, d));
  const margin =
    (Math.max(drawable.options.strokeWidth, drawable.options.fillWeight ?? 0) +
      1) *
      scale +
    2;
  const left = -margin;
  const top = -margin;
  const right = view.width + margin;
  const bottom = view.height + margin;

  // device-space box of four points
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  const box = (p: readonly number[]) => {
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    for (let i = 0; i < 8; i += 2) {
      const x = toX(p[i], p[i + 1]);
      const y = toY(p[i], p[i + 1]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  };

  let huge = false;
  for (const set of drawable.sets) {
    let at = [0, 0];
    for (const { op, data } of set.ops) {
      if (op === "bcurveTo") {
        box([at[0], at[1], ...data]);
        if (maxX - minX > MAX_CURVE_PX || maxY - minY > MAX_CURVE_PX) {
          huge = true;
          break;
        }
      }
      at = data.slice(-2);
    }
  }
  if (!huge) {
    return drawable;
  }

  const emit = (out: Op[], p: readonly number[], depth: number) => {
    box(p);
    if (maxX < left || minX > right || maxY < top || minY > bottom) {
      out.push({ op: "lineTo", data: [p[6], p[7]] });
      return;
    }
    if (
      depth >= MAX_DEPTH ||
      (maxX - minX <= MAX_CURVE_PX && maxY - minY <= MAX_CURVE_PX)
    ) {
      out.push({ op: "bcurveTo", data: p.slice(2) });
      return;
    }
    // de Casteljau at t = 0.5
    const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
    const ax = (x0 + x1) / 2;
    const ay = (y0 + y1) / 2;
    const bx = (x1 + x2) / 2;
    const by = (y1 + y2) / 2;
    const cx = (x2 + x3) / 2;
    const cy = (y2 + y3) / 2;
    const abx = (ax + bx) / 2;
    const aby = (ay + by) / 2;
    const bcx = (bx + cx) / 2;
    const bcy = (by + cy) / 2;
    const mx = (abx + bcx) / 2;
    const my = (aby + bcy) / 2;
    emit(out, [x0, y0, ax, ay, abx, aby, mx, my], depth + 1);
    emit(out, [mx, my, bcx, bcy, cx, cy, x3, y3], depth + 1);
  };

  return {
    ...drawable,
    sets: drawable.sets.map((set) => {
      const ops: Op[] = [];
      let at = [0, 0];
      for (const op of set.ops) {
        if (op.op === "bcurveTo") {
          emit(ops, [at[0], at[1], ...op.data], 0);
        } else {
          ops.push(op);
        }
        at = op.data.slice(-2);
      }
      return { ...set, ops };
    }),
  };
};
