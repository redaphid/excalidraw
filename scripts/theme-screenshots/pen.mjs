// Pen strokes for the pen captures: cursive loops, a quick underline, a
// spiral, hatching and a pressure ramp. Each point is { x, y, pressure, dt }
// in a 560x250 box; `dt` (ms) is the time since the previous point, so slow
// and fast strokes replay at their own speed.

const ramp = (t) => Math.min(1, t / 0.12, (1 - t) / 0.12);

const cursive = () => {
  const points = [];
  const turns = 5;
  for (let i = 0; i <= 220; i++) {
    const theta = (i / 220) * turns * 2 * Math.PI;
    const t = i / 220;
    points.push({
      x: 10 + 9.5 * theta - 20 * Math.sin(theta),
      y: 50 - 26 * Math.cos(theta) + 6 * Math.sin(t * Math.PI),
      pressure: 0.25 + 0.55 * ramp(t) * (0.6 + 0.4 * Math.abs(Math.sin(theta))),
      dt: 7,
    });
  }
  return points;
};

const underline = () => {
  const points = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    points.push({
      x: 0 + t * 320,
      y: 100 - 10 * Math.sin(t * Math.PI) + t * -6,
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
      y: 190 + 16 * Math.sin(t * 4 * Math.PI),
      pressure: 0.05 + 0.95 * t,
      dt: 9,
    });
  }
  return points;
};

export const PEN_BOX = { width: 560, height: 250 };

export const penStrokes = () => [
  cursive(),
  underline(),
  spiral(),
  ...hatching(),
  pressureRamp(),
];
