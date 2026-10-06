import {
  getFreedrawOutlinePoints,
  newFreeDrawElement,
} from "@excalidraw/element";

import { freedrawThrough } from "./element";
import { createStroke, type Dab, type Input, type Sample } from "./stroke";

const PEN: Input = { simulatePressure: false, streamline: 0.2 };
const MOUSE: Input = { simulatePressure: true, streamline: 0.5 };

type Point = readonly [number, number];

/** The element committed for `samples`, as the editor's freedraw path makes it. */
const committed = (
  samples: readonly Sample[],
  strokeWidth: number,
  { simulatePressure, streamline }: Input,
) =>
  freedrawThrough(
    newFreeDrawElement({
      type: "freedraw",
      x: samples[0].x,
      y: samples[0].y,
      strokeWidth,
      simulatePressure,
      strokeOptions: { variability: "variable", streamline },
    }),
    samples,
  );

const wave = (scale: number): Sample[] =>
  Array.from({ length: 60 }, (_, i) => ({
    x: 300 + i * 3 * scale,
    y: 200 + Math.sin(i / 9) * 40 * scale,
    pressure: 0.3 + 0.6 * Math.sin((i / 59) * Math.PI),
  }));

const zigzag = (): Sample[] =>
  Array.from({ length: 40 }, (_, i) => ({
    x: 50 + i * 4,
    y: 80 + (Math.floor(i / 5) % 2 ? 5 - (i % 5) : i % 5) * 6,
    pressure: 0.5 + 0.4 * Math.cos(i / 4),
  }));

const flick = (): Sample[] => [
  { x: 10, y: 10, pressure: 0.6 },
  { x: 11, y: 10.5, pressure: 0.7 },
  { x: 12.5, y: 11, pressure: 0.5 },
];

/** The ink layer's last frame before pointerup: its settled dabs, then the tip at the newest sample. */
const inkAtHandOff = (
  samples: readonly Sample[],
  strokeWidth: number,
  pen: Input,
) => {
  const stroke = createStroke({ strokeWidth, ...pen });
  const dabs: Dab[] = [];
  for (const s of samples) {
    const dab = stroke.add(s);
    if (dab) {
      dabs.push(dab);
    }
  }
  const newest = samples.at(-1);
  if (newest) {
    dabs.push(stroke.tip(newest));
  }
  return dabs;
};

const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq
    ? Math.min(
        1,
        Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq),
      )
    : 0;
  return { t, d: Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)) };
};

/** Signed distance to the ink's tapered capsules (gl.ts), negative inside. */
const inkDistance = (dabs: readonly Dab[], p: Point) => {
  let best = Infinity;
  dabs.forEach((a, i) => {
    const b = dabs[i + 1] ?? a;
    const { t, d } = toSegment(p, [a.x, a.y], [b.x, b.y]);
    best = Math.min(best, d - (a.r + (b.r - a.r) * t));
  });
  return best;
};

/** Canvas's nonzero fill rule, which Excalidraw fills the outline with. */
const insideOutline = (outline: readonly Point[], [x, y]: Point) => {
  let winding = 0;
  outline.forEach(([x1, y1], i) => {
    const [x2, y2] = outline[(i + 1) % outline.length]!;
    const side = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
    if (y1 <= y && y2 > y && side > 0) {
      winding++;
    }
    if (y1 > y && y2 <= y && side < 0) {
      winding--;
    }
  });
  return winding !== 0;
};

const outlineDistance = (outline: readonly Point[], p: Point) =>
  Math.min(
    ...outline.map(
      (a, i) => toSegment(p, a, outline[(i + 1) % outline.length]!).d,
    ),
  );

/** Points along a closed polygon, `spacing` apart. */
const alongOutline = (outline: readonly Point[], spacing: number) =>
  outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing),
    );
    return Array.from(
      { length: n },
      (_, k) =>
        [
          a[0] + ((b[0] - a[0]) * k) / n,
          a[1] + ((b[1] - a[1]) * k) / n,
        ] as const,
    );
  });

/** Points around every dab, of which those on no other capsule are the ink's edge. */
const aroundDabs = (dabs: readonly Dab[], spacing: number) =>
  dabs.flatMap((d) => {
    const n = Math.min(
      512,
      Math.max(16, Math.ceil((2 * Math.PI * d.r) / spacing)),
    );
    return Array.from(
      { length: n },
      (_, k) =>
        [
          d.x + d.r * Math.cos((2 * Math.PI * k) / n),
          d.y + d.r * Math.sin((2 * Math.PI * k) / n),
        ] as const,
    );
  });

/**
 * The Hausdorff distance between the ink on screen and the stroke Excalidraw
 * draws in its place, in stroke widths: how far the committed edge lies
 * outside the ink, or the ink's edge outside the committed stroke.
 */
const handOffJump = (
  samples: readonly Sample[],
  strokeWidth: number,
  pen: Input,
) => {
  const dabs = inkAtHandOff(samples, strokeWidth, pen);
  const element = committed(samples, strokeWidth, pen);
  const outline = getFreedrawOutlinePoints(element).map(
    ([x, y]) => [element.x + x, element.y + y] as const,
  );
  const spacing = strokeWidth / 10;
  const committedOutsideInk = alongOutline(outline, spacing).map((p) =>
    inkDistance(dabs, p),
  );
  const inkOutsideCommitted = aroundDabs(dabs, spacing)
    .filter((p) => !insideOutline(outline, p))
    .map((p) => outlineDistance(outline, p));
  return (
    Math.max(0, ...committedOutsideInk, ...inkOutsideCommitted) / strokeWidth
  );
};

type Case = {
  when: string;
  samples: Sample[];
  strokeWidth: number;
  pen: Input;
  should: string;
  within: number;
};

const cases: Case[] = [
  {
    when: "a thin pen signs a wave at 1x",
    samples: wave(1),
    strokeWidth: 1,
    pen: PEN,
    should: "should commit the stroke the ink drew",
    within: 0.06,
  },
  {
    when: "a thin pen signs a wave at 100,000x",
    samples: wave(1 / 100_000),
    strokeWidth: 1 / 100_000,
    pen: PEN,
    should: "should commit the stroke the ink drew",
    within: 0.06,
  },
  {
    when: "a pen flicks a stroke shorter than its nib",
    samples: flick(),
    strokeWidth: 2,
    pen: PEN,
    should: "should commit the stroke the ink drew",
    within: 0.08,
  },
  {
    when: "a bold pen signs a wave at 1x",
    samples: wave(1),
    strokeWidth: 4,
    pen: PEN,
    should:
      "should differ only where the outline cuts across the inside of a tight curve",
    within: 0.33,
  },
  {
    when: "a mouse signs a wave",
    samples: wave(1),
    strokeWidth: 2,
    pen: MOUSE,
    should:
      "should differ only in the pressure perfect-freehand averages over the first points",
    within: 0.4,
  },
  {
    when: "a pen signs a wave with the mouse streamline",
    samples: wave(1),
    strokeWidth: 1,
    pen: { simulatePressure: false, streamline: 0.5 },
    should: "should commit the stroke the ink drew",
    within: 0.06,
  },
  {
    when: "a pen scribbles a zigzag",
    samples: zigzag(),
    strokeWidth: 2,
    pen: PEN,
    should:
      "should differ only in the notches the outline cuts at sharp corners",
    within: 1.6,
  },
];

describe("the hand-off from the ink layer to the committed stroke", () => {
  for (const c of cases) {
    describe(`when ${c.when}`, () => {
      let result: number;

      beforeEach(() => {
        result = handOffJump(c.samples, c.strokeWidth, c.pen);
      });

      it(c.should, () => {
        expect(result).toBeLessThan(c.within);
      });
    });
  }
});
