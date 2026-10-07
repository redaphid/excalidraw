// Pen strokes for the pen captures: a handwritten word, a quick underline, a
// spiral, hatching and a pressure ramp. Each point is { x, y, pressure, dt }
// in a 560x250 box; `dt` (ms) is the time since the previous point, so slow
// and fast strokes replay at their own speed.

const ramp = (t) => Math.min(1, t / 0.12, (1 - t) / 0.12);

// "hello" in a joined hand, as control points (baseline 0, up is negative),
// smoothed with Catmull-Rom. Downstrokes press harder, like a real pen.
const HELLO = [
  [0, 0],
  [8, -10],
  [14, -40],
  [12, -52],
  [6, -48],
  [6, -30],
  [8, 0],
  [10, -14],
  [18, -20],
  [24, -14],
  [26, 0],
  [30, -4],
  [38, -12],
  [40, -18],
  [34, -20],
  [30, -12],
  [34, -2],
  [42, 0],
  [48, -10],
  [54, -40],
  [52, -52],
  [46, -48],
  [46, -28],
  [50, 0],
  [56, -10],
  [62, -40],
  [60, -52],
  [54, -48],
  [54, -28],
  [58, 0],
  [64, -6],
  [66, -18],
  [74, -20],
  [78, -12],
  [74, -2],
  [66, -2],
  [66, -12],
  [74, -18],
  [86, -16],
];

const catmullRom = (points, samples) => {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [
      points[Math.max(0, i - 1)],
      points[i],
      points[i + 1],
      points[Math.min(points.length - 1, i + 2)],
    ];
    for (let k = 0; k < samples; k++) {
      const t = k / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        [0, 1].map(
          (axis) =>
            0.5 *
            (2 * p1[axis] +
              (-p0[axis] + p2[axis]) * t +
              (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
              (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3),
        ),
      );
    }
  }
  out.push(points[points.length - 1]);
  return out;
};

const handwriting = () => {
  const path = catmullRom(HELLO, 8);
  return path.map(([x, y], i) => {
    const t = i / (path.length - 1);
    const dy = i ? y - path[i - 1][1] : 0;
    return {
      x: 10 + x * 2.6,
      y: 140 + y * 2.6,
      pressure:
        (0.3 + 0.5 * Math.min(1, Math.max(0, dy) / 1.2)) *
        (0.4 + 0.6 * ramp(t)),
      dt: 6,
    };
  });
};

const underline = () => {
  const points = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    points.push({
      x: 0 + t * 250,
      y: 170 - 8 * Math.sin(t * Math.PI) + t * -4,
      pressure: 0.15 + 0.75 * Math.sin(t * Math.PI),
      dt: 4,
    });
  }
  return points;
};

const spiral = () => {
  const points = [];
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    const angle = t * 3 * 2 * Math.PI;
    const radius = 6 + 52 * t;
    points.push({
      x: 450 + radius * Math.cos(angle),
      y: 62 + radius * Math.sin(angle),
      pressure: 0.55 + 0.25 * Math.sin(t * Math.PI),
      dt: 6,
    });
  }
  return points;
};

const hatching = () =>
  Array.from({ length: 9 }, (_, line) => {
    const x0 = 370 + line * 14;
    return Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      return {
        x: x0 + t * 46,
        y: 230 - t * 70,
        pressure: 0.7 - 0.4 * t,
        dt: 5,
      };
    });
  });

const pressureRamp = () => {
  const points = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    points.push({
      x: t * 320,
      y: 218 + 12 * Math.sin(t * 4 * Math.PI),
      pressure: 0.05 + 0.95 * t,
      dt: 9,
    });
  }
  return points;
};

export const PEN_BOX = { width: 560, height: 250 };

export const penStrokes = () => [
  handwriting(),
  underline(),
  spiral(),
  ...hatching(),
  pressureRamp(),
];
