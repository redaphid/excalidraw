import {
  MAX_ZOOM,
  MIN_ZOOM,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { clamp, round } from "@excalidraw/math";

import { getDefaultAppState } from "../appState";
import { getNormalizedZoom } from "../scene";
import { getViewportForZoomWithScrollConstraints } from "../viewport";

import type { AppState, NormalizedZoomValue } from "../types";

/** a deterministic PRNG (mulberry32), so a failure reproduces */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** `count` log-spaced values over [from, to] */
const sweep = (from: number, to: number, count: number) =>
  Array.from(
    { length: count },
    (_, i) => from * (to / from) ** (i / (count - 1)),
  );

/** `count` seeded log-uniform values over [from, to] */
const randomZooms = (from: number, to: number, count: number, seed = 1) => {
  const random = seeded(seed);
  return Array.from({ length: count }, () => from * (to / from) ** random());
};

/** one wheel notch: the largest step App.wheel takes, e^0.1 */
const WHEEL = Math.exp(0.1);
/** one zoom button press */
const BUTTON = 1.1;

const SCREEN = { width: 1000, height: 600 };

const viewState = (scrollX: number, scrollY: number, zoom: number) =>
  ({
    ...getDefaultAppState(),
    ...SCREEN,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX,
    scrollY,
    zoom: { value: zoom as NormalizedZoomValue },
  } as AppState);

/** zooms as the wheel and buttons do: normalized, about a screen point */
const zoomAbout = (
  state: AppState,
  factor: number,
  [viewportX, viewportY]: readonly [number, number],
): AppState => ({
  ...state,
  ...getViewportForZoomWithScrollConstraints(
    {
      viewportX,
      viewportY,
      nextZoom: getNormalizedZoom(state.zoom.value * factor),
    },
    state,
  ),
});

const toScene = (
  state: AppState,
  [clientX, clientY]: readonly [number, number],
) => viewportCoordsToSceneCoords({ clientX, clientY }, state);

const toScreen = (state: AppState, { x, y }: { x: number; y: number }) =>
  sceneCoordsToViewportCoords({ sceneX: x, sceneY: y }, state);

describe("getNormalizedZoom", () => {
  const ZOOMS = [
    ...sweep(MIN_ZOOM, MAX_ZOOM, 2000),
    // past both ends too, to see the clamp
    ...randomZooms(MIN_ZOOM / 100, MAX_ZOOM * 100, 2000),
  ];

  it("is never NaN or 0, and stays within [MIN_ZOOM, MAX_ZOOM]", () => {
    const bad = ZOOMS.filter((zoom) => {
      const normalized = getNormalizedZoom(zoom);
      return !(normalized >= MIN_ZOOM && normalized <= MAX_ZOOM);
    });
    expect(bad).toEqual([]);
  });

  it("is idempotent", () => {
    const moved = ZOOMS.filter(
      (zoom) =>
        getNormalizedZoom(getNormalizedZoom(zoom)) !== getNormalizedZoom(zoom),
    );
    expect(moved).toEqual([]);
  });

  it("is monotonic", () => {
    const sorted = [...ZOOMS].sort((a, b) => a - b).map(getNormalizedZoom);
    const backwards = sorted.filter((zoom, i) => i && zoom < sorted[i - 1]);
    expect(backwards).toEqual([]);
  });

  /** the most getNormalizedZoom moves a zoom in [from, to), relatively */
  const worstMove = (from: number, to: number) =>
    Math.max(
      ...ZOOMS.filter((zoom) => zoom >= from && zoom < to).map((zoom) => {
        const clamped = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
        return Math.abs(getNormalizedZoom(zoom) - clamped) / clamped;
      }),
    );

  it("moves a zoom by at most 5e-7 of itself, but in [0.1, 1)", () => {
    expect(worstMove(0, 0.1)).toBeLessThanOrEqual(5e-7);
    expect(worstMove(1, Infinity)).toBeLessThanOrEqual(5e-7);
  });

  it("moves a zoom in [0.1, 1) by at most 5e-6 of itself, as master", () => {
    // six decimals of 0.1 are five significant figures
    expect(worstMove(0.1, 1)).toBeLessThanOrEqual(5e-6);
  });

  it("returns exactly master's zoom for every zoom from 0.1 up", () => {
    // master: MIN_ZOOM 0.1, rounded to six decimals, then clamped
    const master = (zoom: number) => clamp(round(zoom, 6), 0.1, MAX_ZOOM);
    const differ = ZOOMS.filter(
      (zoom) => zoom >= 0.1 && getNormalizedZoom(zoom) !== master(zoom),
    );
    expect(differ).toEqual([]);
  });
});

describe("zoom round trips", () => {
  /** relative drift after `steps` zooms out by `factor` and as many back */
  const roundTrip = (start: number, factor: number, steps: number) => {
    let zoom = start;
    for (let i = 0; i < steps; i++) {
      zoom = getNormalizedZoom(zoom / factor);
    }
    for (let i = 0; i < steps; i++) {
      zoom = getNormalizedZoom(zoom * factor);
    }
    return Math.abs(zoom - start) / start;
  };

  /** the steps from `start` out to just short of the floor */
  const stepsToFloor = (start: number, factor: number) =>
    Math.floor(Math.log(start / MIN_ZOOM) / Math.log(factor));

  // Not exactly: each step rounds. Master's own trip from 1x to 0.1 and
  // back drifts 7e-6; the worst here is 2.0e-5, by buttons from 1x
  it.each([
    ["wheel notches", WHEEL],
    ["button presses", BUTTON],
  ] as const)(
    "%s out to the floor and back land within 3e-5 of where they began",
    (_, factor) => {
      const drifts = [1, 1e3].map((start) => ({
        start,
        drift: roundTrip(start, factor, stepsToFloor(start, factor)),
      }));
      expect(drifts.filter(({ drift }) => drift > 3e-5)).toEqual([]);
    },
  );

  it.each([
    ["wheel notches", WHEEL],
    ["button presses", BUTTON],
  ] as const)(
    "%s from 1e-3 to the floor and back, all under 0.1, land within 2e-6",
    (_, factor) => {
      expect(
        roundTrip(1e-3, factor, stepsToFloor(1e-3, factor)),
      ).toBeLessThanOrEqual(2e-6);
    },
  );
});

describe("zooming about the pointer", () => {
  const POINTER = [737.25, 211.5] as const;

  /** px the point under the pointer moves at each wheel notch, from 1x out
   * to the floor and in to MAX_ZOOM */
  const journey = (scrollX: number, scrollY: number) => {
    const misses: { zoom: number; px: number }[] = [];
    let state = viewState(scrollX, scrollY, 1);
    const notch = (factor: number) => {
      const under = toScene(state, POINTER);
      state = zoomAbout(state, factor, POINTER);
      const { x, y } = toScreen(state, under);
      misses.push({
        zoom: state.zoom.value,
        px: Math.hypot(x - POINTER[0], y - POINTER[1]),
      });
    };
    // (capped: a zoom that rounds back to itself would never get there)
    while (state.zoom.value > MIN_ZOOM && misses.length < 1000) {
      notch(1 / WHEEL);
    }
    while (state.zoom.value < MAX_ZOOM && misses.length < 2000) {
      notch(WHEEL);
    }
    return misses;
  };

  it.each([
    [0, 0],
    [-123_456.75, 98_765.25],
    [-5e8, 3e8],
  ])(
    "keeps the point under it within 0.5 px at every notch, scrolled to %s, %s",
    (scrollX, scrollY) => {
      const misses = journey(scrollX, scrollY);
      expect(misses.length).toBeGreaterThan(400);
      expect(misses.at(-1)?.zoom).toBe(MAX_ZOOM);
      expect(misses.filter(({ px }) => px > 0.5)).toEqual([]);
    },
  );
});

describe("screen and scene coordinates", () => {
  const ZOOMS = sweep(MIN_ZOOM, MAX_ZOOM, 2000);
  const random = seeded(7);
  const POINTS = Array.from(
    { length: 4 },
    () => [random() * SCREEN.width, random() * SCREEN.height] as const,
  );

  /** at 0, scrolled by whole screens at this zoom, and a fixed distance */
  const scrolls = (zoom: number) => [
    [0, 0],
    [(-1e4 * SCREEN.width) / zoom, (5e3 * SCREEN.height) / zoom],
    [-1e6, 1e6],
  ];

  /** the worst of `miss` over every zoom, scroll and point */
  const worst = (
    miss: (state: AppState, point: readonly [number, number]) => number,
  ) =>
    Math.max(
      ...ZOOMS.flatMap((zoom) =>
        scrolls(zoom).flatMap(([scrollX, scrollY]) => {
          const state = viewState(scrollX, scrollY, zoom);
          return POINTS.map((point) => miss(state, point));
        }),
      ),
    );

  it("takes a screen point to the scene and back within 0.5 px", () => {
    expect(
      worst((state, point) => {
        const { x, y } = toScreen(state, toScene(state, point));
        return Math.hypot(x - point[0], y - point[1]);
      }),
    ).toBeLessThan(0.5);
  });

  it("takes a scene point to the screen and back within 0.5 px of it", () => {
    expect(
      worst((state, point) => {
        const scene = toScene(state, point);
        const { x, y } = toScreen(state, scene);
        const back = toScene(state, [x, y]);
        // scene units, in px at this zoom
        return (
          Math.hypot(back.x - scene.x, back.y - scene.y) * state.zoom.value
        );
      }),
    ).toBeLessThan(0.5);
  });
});

describe("panning far at the zoom floor, then zooming all the way in", () => {
  /** the most a point picked on screen at the floor, after panning `screens`
   * screens there, misses its place once wheeled in to MAX_ZOOM about it */
  const farMiss = (screens: number) =>
    Math.max(
      ...Array.from({ length: 20 }, (_, k) => {
        const pointer = [100 + 37.3 * k, 50 + 23.1 * k] as const;
        let state = viewState(
          (-screens * SCREEN.width) / MIN_ZOOM - 1234.5 * k,
          0,
          MIN_ZOOM,
        );
        const picked = toScene(state, pointer);
        for (let i = 0; state.zoom.value < MAX_ZOOM && i < 1000; i++) {
          state = zoomAbout(state, WHEEL, pointer);
        }
        const { x, y } = toScreen(state, picked);
        return Math.hypot(x - pointer[0], y - pointer[1]);
      }),
    );

  // A floor screen is 1e9 scene units, where a double's step is about
  // 1e-7 units: 0.1 px at MAX_ZOOM. Measured: 0.37 px at 1 screen, 0.72 at
  // 2, 1.4 at 4, 107 at 1,024. A floating origin would lift this limit
  it("lands within 0.5 px after panning up to a screen", () => {
    expect(farMiss(1)).toBeLessThan(0.5);
  });

  it("misses by more than 0.5 px after panning 2 screens (the limit)", () => {
    expect(farMiss(2)).toBeGreaterThan(0.5);
  });
});
