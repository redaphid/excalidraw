import { applyDarkModeFilter } from "@excalidraw/common";
import {
  getFreedrawOutlinePoints,
  getFreedrawStrokeCenterPoints,
} from "@excalidraw/element";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";
import { API } from "../tests/helpers/api";
import { UI } from "../tests/helpers/ui";
import {
  installWebGL2,
  sendPointer,
  sendStroke,
  uninstallWebGL2,
} from "../tests/helpers/webgl";
import { act, render } from "../tests/test-utils";

import type { DrawnDab, FakeGPU, InkFrame } from "../tests/helpers/webgl";

// What the ink layer draws while the pen is down, against the stroke the
// editor draws in its place once it lifts: the hand-off must not jump.

const { h } = window;

type Point = readonly [number, number];
type Sample = { x: number; y: number; pressure: number };

let gpu: FakeGPU;

const setup = async (strokeWidth: number, zoom = 1) => {
  await render(
    <Excalidraw
      freedrawRenderer="webgl"
      authoringUnits="screen"
      freedrawStrokeWidth={strokeWidth}
    />,
  );
  API.setAppState({
    currentItemStrokeVariability: "variable",
    zoom: { value: getNormalizedZoom(zoom) },
  });
  UI.clickTool("freedraw");
};

/** Draws `samples` (in scene units) with a pen or a mouse. */
const draw = (
  samples: readonly Sample[],
  pointerType: "pen" | "mouse",
  zoom = 1,
) =>
  sendStroke(
    samples.map((s) => [s.x * zoom, s.y * zoom] as const),
    { pointerType },
    { pressures: samples.map((s) => s.pressure) },
  );

const committed = () =>
  h.elements.find(
    (e): e is ExcalidrawFreeDrawElement => e.type === "freedraw",
  )!;

/** The ink's last frame before the lift: its settled dabs, then the tip. */
const lastFrame = (): InkFrame => gpu.gl.frames.at(-1)!;

const wave = (scale: number): Sample[] =>
  Array.from({ length: 60 }, (_, i) => ({
    x: (300 + i * 3) * scale,
    y: (200 + Math.sin(i / 9) * 40) * scale,
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

/** Signed distance to the ink's tapered capsules, negative inside. */
const inkDistance = (dabs: readonly DrawnDab[], p: Point) => {
  let best = Infinity;
  dabs.forEach((a, i) => {
    const b = dabs[i + 1] ?? a;
    const { t, d } = toSegment(p, [a.x, a.y], [b.x, b.y]);
    best = Math.min(best, d - (a.r + (b.r - a.r) * t));
  });
  return best;
};

/** Canvas's nonzero fill rule, which the editor fills the outline with. */
const insideOutline = (outline: readonly Point[], [x, y]: Point) => {
  let winding = 0;
  outline.forEach(([x1, y1], i) => {
    const [x2, y2] = outline[(i + 1) % outline.length];
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
      (a, i) => toSegment(p, a, outline[(i + 1) % outline.length]).d,
    ),
  );

/** Points along a closed polygon, `spacing` apart. */
const alongOutline = (outline: readonly Point[], spacing: number) =>
  outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length];
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
const aroundDabs = (dabs: readonly DrawnDab[], spacing: number) =>
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
 * The Hausdorff distance between the ink on screen and the stroke the editor
 * draws in its place, in stroke widths.
 */
const handOffJump = () => {
  const { dabs } = lastFrame();
  const element = committed();
  const outline = getFreedrawOutlinePoints(element).map(
    ([x, y]) => [element.x + x, element.y + y] as const,
  );
  const spacing = element.strokeWidth / 10;
  const committedOutsideInk = alongOutline(outline, spacing).map((p) =>
    inkDistance(dabs, p),
  );
  const inkOutsideCommitted = aroundDabs(dabs, spacing)
    .filter((p) => !insideOutline(outline, p))
    .map((p) => outlineDistance(outline, p));
  return (
    Math.max(0, ...committedOutsideInk, ...inkOutsideCommitted) /
    element.strokeWidth
  );
};

beforeEach(() => {
  gpu = installWebGL2();
});

afterEach(async () => {
  await act(async () => {});
  uninstallWebGL2();
});

type Case = {
  when: string;
  samples: () => Sample[];
  strokeWidth: number;
  zoom?: number;
  pointerType: "pen" | "mouse";
  should: string;
  within: number;
};

const cases: Case[] = [
  {
    when: "a thin pen signs a wave at 1x",
    samples: () => wave(1),
    strokeWidth: 1,
    pointerType: "pen",
    should: "should commit the stroke the ink drew",
    within: 0.06,
  },
  {
    when: "a thin pen signs a wave at 100,000x",
    samples: () => wave(1 / 100_000),
    strokeWidth: 1,
    zoom: 100_000,
    pointerType: "pen",
    should: "should commit the stroke the ink drew",
    within: 0.06,
  },
  {
    when: "a pen flicks a stroke shorter than its nib",
    samples: flick,
    strokeWidth: 2,
    pointerType: "pen",
    should: "should commit the stroke the ink drew",
    within: 0.08,
  },
  {
    when: "a bold pen signs a wave at 1x",
    samples: () => wave(1),
    strokeWidth: 4,
    pointerType: "pen",
    should:
      "should differ only where the outline cuts across the inside of a tight curve",
    within: 0.33,
  },
  {
    when: "a mouse signs a wave",
    samples: () => wave(1),
    strokeWidth: 2,
    pointerType: "mouse",
    should:
      "should differ only in the pressure perfect-freehand averages over the first points",
    within: 0.4,
  },
  {
    when: "a pen scribbles a zigzag",
    samples: zigzag,
    strokeWidth: 2,
    pointerType: "pen",
    should:
      "should differ only in the notches the outline cuts at sharp corners",
    within: 1.6,
  },
];

describe("the hand-off from the ink layer to the committed stroke", () => {
  for (const c of cases) {
    describe(`when ${c.when}`, () => {
      let result: number;

      beforeEach(async () => {
        await setup(c.strokeWidth, c.zoom);
        draw(c.samples(), c.pointerType, c.zoom);
        result = handOffJump();
      });

      it(c.should, () => {
        expect(result).toBeLessThan(c.within);
      });
    });
  }
});

describe("the ink's line", () => {
  describe("when a pen signs a wave", () => {
    let settled: DrawnDab[];
    let centerline: Point[];

    beforeEach(async () => {
      await setup(1);
      draw(wave(1), "pen");
      settled = lastFrame().dabs.slice(0, -1);
      const element = committed();
      centerline = getFreedrawStrokeCenterPoints(element).map(
        ([x, y]) => [element.x + x, element.y + y] as const,
      );
    });

    // The outline puts its last point exactly at the pen; the ink's tip does.
    it("should settle every dab on the centerline the committed stroke is outlined around", () => {
      const misses = centerline
        .slice(0, -1)
        .map((_, i) =>
          Math.hypot(
            settled[i].x - centerline[i][0],
            settled[i].y - centerline[i][1],
          ),
        );
      expect(misses.length).toBeGreaterThan(50);
      expect(Math.max(...misses)).toBeLessThan(1e-3);
    });
  });

  describe("when a thin pen lands", () => {
    const firstDab = async (pressure: number) => {
      await setup(1);
      sendPointer("pointerdown", 100, 100, { pointerType: "pen", pressure });
      return lastFrame().dabs[0].r;
    };

    it("should be as wide as perfect-freehand draws a full press", async () => {
      expect(await firstDab(1)).toBeCloseTo(4.042, 3);
    });

    it("should thin the line to under a third of that at the lightest touch", async () => {
      expect(await firstDab(0)).toBeCloseTo(1.313, 3);
    });
  });

  describe("when a mouse presses, so pressure is simulated", () => {
    let first: number;
    let flicked: number;

    beforeEach(async () => {
      await setup(1);
      sendPointer("pointerdown", 0, 0, { pointerType: "mouse" });
      first = lastFrame().dabs[0].r;
      sendPointer("pointermove", 40, 0, { pointerType: "mouse" });
      sendPointer("pointermove", 80, 0, { pointerType: "mouse" });
      flicked = lastFrame().dabs[1].r;
    });

    it("should start as thin as perfect-freehand starts a mouse line", () => {
      expect(first).toBeCloseTo(2.2207, 3);
    });

    it("should thin the line as the mouse flicks away", () => {
      expect(flicked).toBeLessThan(first);
    });
  });

  describe("when the pen jitters by less than half a pixel", () => {
    beforeEach(async () => {
      await setup(1);
      sendStroke(
        [
          [100, 100],
          [100.2, 100.2],
          [100.3, 100.1],
          [130, 100],
        ],
        { pointerType: "pen" },
      );
    });

    it("should keep only the samples that moved", () => {
      expect(committed().points).toHaveLength(2);
    });
  });
});

describe("the ink's colour", () => {
  const firstColor = async (
    color: string,
    {
      opacity = 100,
      theme = "light",
    }: { opacity?: number; theme?: "light" | "dark" } = {},
  ) => {
    await render(<Excalidraw freedrawRenderer="webgl" theme={theme} />);
    API.setAppState({
      currentItemStrokeVariability: "variable",
      currentItemStrokeColor: color,
      currentItemOpacity: opacity,
    });
    UI.clickTool("freedraw");
    sendPointer("pointerdown", 100, 100, { pointerType: "pen" });
    return lastFrame().color;
  };

  const channels = (hex: string) =>
    hex
      .slice(1)
      .match(/../g)!
      .map((d) => Number.parseInt(d, 16) / 255);

  it("should draw the lamp-room red as it is on a light scene", async () => {
    expect(await firstColor("#e03131")).toEqual([...channels("#e03131"), 1]);
  });

  it("should premultiply it by the opacity, as the canvas blends", async () => {
    const [r, g, b] = channels("#e03131");
    expect(await firstColor("#e03131", { opacity: 50 })).toEqual([
      r * 0.5,
      g * 0.5,
      b * 0.5,
      0.5,
    ]);
  });

  it("should paint it as the editor paints the committed stroke in the dark", async () => {
    expect(await firstColor("#1e1e1e", { theme: "dark" })).toEqual([
      ...channels(applyDarkModeFilter("#1e1e1e", true)),
      1,
    ]);
  });
});
