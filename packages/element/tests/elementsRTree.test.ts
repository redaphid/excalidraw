import { arrayToMap, type Bounds } from "@excalidraw/common";
import { pointFrom, type LocalPoint } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { getElementPaintBounds } from "../src/bounds";
import {
  ElementsRTree,
  observeElementsRTreeRebuildTasks,
  REBUILD_SLICE_MS,
  REBUILD_STEP_MS,
} from "../src/elementsRTree";
import { mutateElement, newElementWith } from "../src/mutateElement";
import { getContainerElement } from "../src/textElement";
import { isTextElement } from "../src/typeChecks";

import type { ElementsRTreeRebuildWork } from "../src/elementsRTree";
import type { ElementsMap, ExcalidrawElement } from "../src/types";

const grid = () => {
  const elements: ExcalidrawElement[] = [];
  for (let row = 0; row < 100; row++) {
    for (let column = 0; column < 100; column++) {
      elements.push(
        API.createElement({
          type: "rectangle",
          x: column * 50,
          y: row * 50,
          width: 20,
          height: 20,
          strokeWidth: 0,
          roughness: 0,
        }),
      );
    }
  }
  return elements;
};

const view: Bounds = [1000, 1000, 1200, 1100];

/** what measuring one element costs on the test window's performance clock */
const MEASURE_COST_MS = 0.05;

const testWindow = () => {
  let now = 0;
  let perfNow = 0;
  let nextId = 1;
  /** runs before each read of the performance clock */
  let onRead: (() => void) | null = null;
  /** a browser may round the performance clock, down to this step */
  let resolutionMs = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const idle = new Map<number, IdleRequestCallback>();
  const window = {
    setTimeout: (run: () => void, ms = 0) => {
      timers.set(nextId, { at: now + ms, run });
      return nextId++;
    },
    clearTimeout: (id: number) => timers.delete(id),
    requestIdleCallback: (run: IdleRequestCallback) => {
      idle.set(nextId, run);
      return nextId++;
    },
    cancelIdleCallback: (id: number) => idle.delete(id),
    performance: {
      now: () => {
        onRead?.();
        return resolutionMs
          ? Math.floor(perfNow / resolutionMs) * resolutionMs
          : perfNow;
      },
    },
  } as unknown as Window;
  const tick = (ms: number) => {
    perfNow += ms;
  };
  const elapsed = () => perfNow;
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
  };
  const runIdle = () => {
    const pending = [...idle];
    idle.clear();
    for (const [, run] of pending) {
      run({ didTimeout: false, timeRemaining: () => 50 });
    }
    return pending.length;
  };
  const readsAs = (read: (() => void) | null, resolution = 0) => {
    onRead = read;
    resolutionMs = resolution;
  };
  return { window, advance, runIdle, tick, elapsed, readsAs };
};

const setup = (
  elements: readonly ExcalidrawElement[],
  measureCostMs = MEASURE_COST_MS,
) => {
  let measured = 0;
  const clock = testWindow();
  const index = new ElementsRTree<ExcalidrawElement>(
    (element, elementsMap) => {
      measured++;
      clock.tick(measureCostMs);
      return getElementPaintBounds(element, elementsMap);
    },
    (element, elementsMap) =>
      isTextElement(element) ? getContainerElement(element, elementsMap) : null,
    () => clock.window,
  );
  const maps = new WeakMap<readonly ExcalidrawElement[], ElementsMap>();
  const mapOf = (elements: readonly ExcalidrawElement[]) => {
    let map = maps.get(elements);
    if (!map) {
      map = arrayToMap(elements);
      maps.set(elements, map);
    }
    return map;
  };
  const query = (
    elements: readonly ExcalidrawElement[],
    bounds: Bounds = view,
  ) => {
    measured = 0;
    const result = index.query(elements, mapOf(elements), bounds, null);
    return { result, measured };
  };
  const rebuildWork = (run: () => void) => {
    measured = 0;
    run();
    return measured;
  };
  query(elements);
  index.rebuild();
  return { index, query, clock, rebuildWork };
};

const linear = (
  elements: readonly ExcalidrawElement[],
  [minX, minY, maxX, maxY]: Bounds = view,
) => {
  const elementsMap = arrayToMap(elements);
  return elements.filter((element) => {
    const [x1, y1, x2, y2] = getElementPaintBounds(element, elementsMap);
    return minX <= x2 && minY <= y2 && maxX >= x1 && maxY >= y1;
  });
};

const moveCopies = (
  elements: readonly ExcalidrawElement[],
  count: number,
  dx: number,
) =>
  elements.map((element, i) =>
    i < count ? newElementWith(element, { x: element.x + dx }) : element,
  );

describe("ElementsRTree", () => {
  it("measures nothing for a view over an indexed array", () => {
    const elements = grid();
    const { query } = setup(elements);

    const { result, measured } = query(elements);

    expect(result).toEqual(linear(elements));
    expect(result.length).toBeGreaterThan(0);
    expect(measured).toBe(0);
  });

  it("measures only the appended element when the array is replaced", () => {
    const elements = grid();
    const { query } = setup(elements);
    const added = API.createElement({
      type: "rectangle",
      x: 1100,
      y: 1050,
      width: 10,
      height: 10,
    });
    const next = [...elements, added];

    const { result, measured } = query(next);

    expect(result).toEqual(linear(next));
    expect(result).toContain(added);
    expect(measured).toBe(1);
  });

  it("finds an element replaced by a copy moved into view, in array order", () => {
    const elements = grid();
    const { query } = setup(elements);
    const next = elements.map((element, i) =>
      i === 5 ? newElementWith(element, { x: 1110, y: 1060 }) : element,
    );

    const { result, measured } = query(next);

    expect(result).toEqual(linear(next));
    expect(result).toContain(next[5]);
    expect(measured).toBe(1);
  });

  it("drops a deleted element without measuring anything", () => {
    const elements = grid();
    const { query } = setup(elements);
    const [visible] = linear(elements);
    const next = elements.filter((element) => element !== visible);

    const { result, measured } = query(next);

    expect(result).toEqual(linear(next));
    expect(result).not.toContain(visible);
    expect(measured).toBe(0);
  });

  it("finds an element edited in place at its new place", () => {
    const elements = grid();
    const { query } = setup(elements);
    const moved = elements[0];

    mutateElement(moved, arrayToMap(elements), { x: 1150, y: 1080 });
    const { result } = query(elements);

    expect(result).toEqual(linear(elements));
    expect(result).toContain(moved);
  });

  it("finds an arrow's label when only the arrow moved", () => {
    const arrow = API.createElement({
      type: "arrow",
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
    });
    const label = API.createElement({
      type: "text",
      text: "label",
      width: 50,
      height: 20,
      containerId: arrow.id,
    });
    const elements = [
      { ...arrow, boundElements: [{ id: label.id, type: "text" as const }] },
      label,
      ...grid(),
    ];
    const { query } = setup(elements);
    const next = [
      newElementWith(elements[0], { x: 1080, y: 1050 }),
      ...elements.slice(1),
    ];

    const { result } = query(next);

    expect(result).toContain(label);
    expect(result).toEqual(linear(next));
  });

  it("rebuilds in idle time once edits pause, not when the array changes", () => {
    const elements = grid();
    const { query, clock, rebuildWork } = setup(elements);
    const next = moveCopies(elements, elements.length, 5);

    expect(query(next).measured).toBe(next.length);
    expect(rebuildWork(() => clock.advance(999))).toBe(0);
    expect(query(next).measured).toBe(next.length);

    clock.advance(1);
    let work = 0;
    while (clock.runIdle()) {
      work += 1;
    }
    expect(work).toBeGreaterThan(1);
    const { result, measured } = query(next);
    expect(measured).toBe(0);
    expect(result).toEqual(linear(next));
  });

  it("stops each idle task once its slice is spent, and keeps the old tree until the new one is complete", () => {
    const elements = grid();
    const { query, clock, rebuildWork } = setup(elements);
    const next = moveCopies(elements, elements.length, 5);
    query(next);
    clock.advance(1000);

    const perTask: number[] = [];
    let measuredBetween = next.length;
    while (measuredBetween > 0) {
      perTask.push(
        rebuildWork(() => {
          expect(clock.runIdle()).toBe(1);
        }),
      );
      const between = query(next);
      expect(between.result).toEqual(linear(next));
      measuredBetween = between.measured;
      if (measuredBetween) {
        expect(measuredBetween).toBe(next.length);
      }
      expect(perTask.length).toBeLessThan(1000);
    }
    const perSlice = Math.ceil(
      (REBUILD_SLICE_MS + REBUILD_STEP_MS) / MEASURE_COST_MS,
    );
    expect(Math.max(...perTask)).toBeLessThanOrEqual(perSlice);
    expect(perTask.length).toBeGreaterThanOrEqual(next.length / perSlice);
  });

  // a frame at 60 Hz is 16.7 ms; a slice of 4 ms leaves the frame's own work
  // the rest, so long as no task runs on far past its slice
  it.each([0.05, 0.5, 3])(
    "overruns its slice by at most one step, or one measure when that is longer, when a measure costs %s ms",
    (measureCostMs) => {
      const elements = grid();
      const { query, clock } = setup(elements, measureCostMs);
      const next = moveCopies(elements, elements.length, 5);
      query(next);
      clock.advance(1000);

      const taskMs: number[] = [];
      const observed: number[] = [];
      observeElementsRTreeRebuildTasks((task) => observed.push(task.ms));
      try {
        let started = clock.elapsed();
        while (clock.runIdle()) {
          taskMs.push(clock.elapsed() - started);
          started = clock.elapsed();
        }
      } finally {
        observeElementsRTreeRebuildTasks(null);
      }
      expect(query(next).measured).toBe(0);
      expect(taskMs.length).toBeGreaterThan(1);
      expect(observed).toEqual(taskMs);
      expect(Math.max(...taskMs)).toBeLessThanOrEqual(
        REBUILD_SLICE_MS + Math.max(REBUILD_STEP_MS, measureCostMs) + 1e-9,
      );
    },
  );

  // what each unit of rebuild work costs on a slow device, charged to the
  // clock when the index reads it: the id lookup's `Map` work costs a hundred
  // times a tree write, as it can in a first build
  const costlyLookups: ElementsRTreeRebuildWork = {
    measured: 0.002,
    comparisons: 0.0002,
    writes: 0.0002,
    lookupWrites: 0.02,
  };
  // tree writes cost enough that 8,192 of them take 16 ms
  const costlyWrites: ElementsRTreeRebuildWork = {
    measured: 0.002,
    comparisons: 0.002,
    writes: 0.002,
    lookupWrites: 0.002,
  };
  it.each([
    ["the id lookup costs a hundred times a tree write", costlyLookups, 0],
    ["8,192 tree writes take 16 ms", costlyWrites, 0],
    ["the clock moves in 0.1 ms ticks", costlyWrites, 0.1],
  ])(
    "keeps each idle task within its slice and a step or two when %s",
    (_, cost, resolutionMs) => {
      const elements = grid();
      const { index, query, clock } = setup(elements, 0);
      const next = moveCopies(elements, elements.length, 5);
      query(next);
      clock.advance(1000);

      // charges each read of the clock with the work done since the last
      const internals = index as unknown as {
        rebuildJob: { work: ElementsRTreeRebuildWork } | null;
      };
      let charged: ElementsRTreeRebuildWork | null = null;
      let chargedFor: ElementsRTreeRebuildWork | null = null;
      clock.readsAs(() => {
        const work = internals.rebuildJob?.work ?? chargedFor;
        if (!work) {
          return;
        }
        if (work !== chargedFor) {
          chargedFor = work;
          charged = { measured: 0, comparisons: 0, writes: 0, lookupWrites: 0 };
        }
        for (const unit of Object.keys(cost) as (keyof typeof cost)[]) {
          clock.tick((work[unit] - charged![unit]) * cost[unit]);
          charged![unit] = work[unit];
        }
      }, resolutionMs);

      const taskMs: number[] = [];
      let lookupWrites = 0;
      observeElementsRTreeRebuildTasks((task) => {
        taskMs.push(task.ms);
        lookupWrites += task.lookupWrites;
      });
      try {
        while (clock.runIdle()) {}
      } finally {
        observeElementsRTreeRebuildTasks(null);
      }
      // a step starts small at each phase and grows at most fourfold, so a
      // clock that cannot see it yet lets it reach only a few ticks' time
      expect(Math.max(...taskMs)).toBeLessThanOrEqual(
        REBUILD_SLICE_MS + 2 * REBUILD_STEP_MS + 4 * resolutionMs,
      );
      expect(taskMs.length).toBeGreaterThan(10);
      expect(lookupWrites).toBe(elements.length);
      expect(query(next).measured).toBe(0);
    },
  );

  it("leaves a few changed elements unindexed instead of rebuilding", () => {
    const elements = grid();
    const { query, clock, rebuildWork } = setup(elements);
    const next = moveCopies(elements, 3, 1100);

    expect(query(next).measured).toBe(3);
    expect(
      rebuildWork(() => {
        clock.advance(5000);
        clock.runIdle();
      }),
    ).toBe(0);
    const { result, measured } = query(next);
    expect(measured).toBe(3);
    expect(result).toEqual(linear(next));
  });

  it("rebuilds at once when asked while many elements are unindexed, then measures nothing", () => {
    const elements = grid();
    const { index, query, rebuildWork } = setup(elements);
    const next = moveCopies(elements, 100, 1100);

    expect(query(next).measured).toBe(100);
    expect(rebuildWork(() => index.rebuildIfStale())).toBe(elements.length);
    const { result, measured } = query(next);
    expect(measured).toBe(0);
    expect(result).toEqual(linear(next));
  });

  it("leaves a few changed elements unindexed when asked to rebuild if stale", () => {
    const elements = grid();
    const { index, query, rebuildWork } = setup(elements);
    const next = moveCopies(elements, 3, 1100);

    query(next);
    expect(rebuildWork(() => index.rebuildIfStale())).toBe(0);
    expect(query(next).measured).toBe(3);
  });

  it("does not rebuild during a drag of a thousand elements", () => {
    const elements = grid();
    const { query, clock, rebuildWork } = setup(elements);
    const map = arrayToMap(elements);
    const dragged = elements.slice(0, 1000);

    let rebuilt = 0;
    for (let frame = 0; frame < 120; frame++) {
      for (const element of dragged) {
        mutateElement(element, map, { x: element.x + 3 });
      }
      const { result, measured } = query(elements);
      expect(measured).toBe(dragged.length);
      if (frame % 30 === 0) {
        expect(result).toEqual(linear(elements));
      }
      rebuilt += rebuildWork(() => {
        clock.advance(16);
        clock.runIdle();
      });
    }
    expect(rebuilt).toBe(0);

    clock.advance(1000);
    while (clock.runIdle()) {}
    const { result, measured } = query(elements);
    expect(measured).toBe(0);
    expect(result).toEqual(linear(elements));
  });

  it("pushes the rebuild back while edits keep coming", () => {
    const elements = grid();
    const { query, clock } = setup(elements);
    let next: readonly ExcalidrawElement[] = elements;
    const edit = () => {
      next = moveCopies(next, 40, 1);
      return query(next);
    };

    expect(edit().measured).toBe(40);
    clock.advance(900);
    while (clock.runIdle()) {}
    expect(edit().measured).toBe(40);
    clock.advance(900);
    while (clock.runIdle()) {}
    expect(query(next).measured).toBe(40);

    clock.advance(100);
    while (clock.runIdle()) {}
    const { result, measured } = query(next);
    expect(measured).toBe(0);
    expect(result).toEqual(linear(next));
  });

  it("does not rebuild while the view zooms", () => {
    const elements = grid();
    const { query, clock, rebuildWork } = setup(elements);
    const next = moveCopies(elements, 40, 1);
    query(next);

    let rebuilt = 0;
    for (let frame = 0; frame < 120; frame++) {
      const scale = 1 + frame / 100;
      const [minX, minY, maxX, maxY] = view;
      query(next, [minX, minY, minX + (maxX - minX) * scale, maxY * scale]);
      rebuilt += rebuildWork(() => {
        clock.advance(16);
        clock.runIdle();
      });
    }
    expect(rebuilt).toBe(0);
  });

  it("rewrites only the id lookups whose slot moved, from one rebuild to the next", () => {
    const elements = grid();
    const { query, clock } = setup(elements);
    const rebuildLookupWrites = (next: readonly ExcalidrawElement[]) => {
      query(next);
      clock.advance(1000);
      let lookupWrites = 0;
      observeElementsRTreeRebuildTasks((task) => {
        lookupWrites += task.lookupWrites;
      });
      try {
        while (clock.runIdle()) {}
      } finally {
        observeElementsRTreeRebuildTasks(null);
      }
      expect(query(next).measured).toBe(0);
      return lookupWrites;
    };

    // the first rebuild after the one in `setup` starts from an empty lookup
    let next = moveCopies(elements, elements.length, 5);
    expect(rebuildLookupWrites(next)).toBe(elements.length);

    next = moveCopies(next, elements.length, 5);
    expect(rebuildLookupWrites(next)).toBe(0);

    const added = API.createElement({ type: "rectangle", x: 1100, y: 1050 });
    next = [...moveCopies(next, 100, 5), added];
    expect(rebuildLookupWrites(next)).toBe(1);

    // the spare lookup is two rebuilds old, from before the append: every
    // kept id moves down 100 slots, the added id is new to it, and the 100
    // deleted ids go
    next = next.slice(100);
    expect(rebuildLookupWrites(next)).toBe(elements.length - 100 + 1 + 100);
    expect(query(next).result).toEqual(linear(next));
  });
});

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type IndexInternals = {
  index: {
    slotOf: Map<string, number>;
    slotElements: readonly ExcalidrawElement[];
  };
};

/** what `rebuildSteps` used to build from scratch: each id at its last slot */
const freshSlotOf = (elements: readonly ExcalidrawElement[]) => {
  const slotOf = new Map<string, number>();
  elements.forEach((element, slot) => slotOf.set(element.id, slot));
  return slotOf;
};

const sortedEntries = (slotOf: Map<string, number>) =>
  [...slotOf].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

describe("ElementsRTree rebuilt in idle slices", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "answers as a fresh index would, through random edits and partial rebuilds (seed %i)",
    (seed) => {
      const rng = mulberry32(seed);
      const int = (n: number) => Math.floor(rng() * n);
      const shape = () =>
        API.createElement({
          type: rng() < 0.5 ? "rectangle" : "ellipse",
          x: int(3000),
          y: int(2000),
          width: 5 + int(200),
          height: 5 + int(200),
          angle: (rng() < 0.3 ? rng() * 6 : 0) as ExcalidrawElement["angle"],
          strokeWidth: 0,
          roughness: 0,
        });
      let elements: readonly ExcalidrawElement[] = Array.from(
        { length: seed % 2 ? 300 : 1500 },
        shape,
      );
      const deleted: ExcalidrawElement[] = [];
      const measureCostMs = [0.01, 0.2, 2][seed % 3];
      const { index, query, clock } = setup(elements, measureCostMs);
      const internals = index as unknown as IndexInternals;
      let installed = internals.index;
      let checkedInstalls = 0;
      const taskMs: number[] = [];
      observeElementsRTreeRebuildTasks((task) => taskMs.push(task.ms));

      const edits = [
        // appended
        () => [...elements, ...Array.from({ length: 1 + int(40) }, shape)],
        // deleted
        () => {
          const next = [...elements];
          for (let k = int(40); k >= 0 && next.length > 1; k--) {
            deleted.push(...next.splice(int(next.length), 1));
          }
          return next;
        },
        // a run moved elsewhere in z-order
        () => {
          const next = [...elements];
          const run = next.splice(int(next.length), 1 + int(200));
          next.splice(int(next.length + 1), 0, ...run);
          return next;
        },
        // copies moved, in place in the array
        () =>
          elements.map((element) =>
            rng() < 0.2
              ? newElementWith(element, { x: element.x + int(300) - 150 })
              : element,
          ),
        // edited in place, same array
        () => {
          const map = arrayToMap(elements);
          for (let k = int(30); k >= 0; k--) {
            const element = elements[int(elements.length)];
            mutateElement(element, map, { y: element.y + int(100) - 50 });
          }
          return elements;
        },
        // brought back, as undo would
        () => {
          const back = deleted.splice(int(deleted.length), 1 + int(20));
          const next = [...elements];
          for (const element of back) {
            next.splice(int(next.length + 1), 0, element);
          }
          return next;
        },
        // a copy that keeps its id, as a bad merge could leave
        () => {
          const next = [...elements];
          const twin = newElementWith(next[int(next.length)], { x: int(3000) });
          next.splice(int(next.length + 1), 0, twin);
          return next;
        },
        // a duplicate dropped again
        () => {
          const seen = new Set<string>();
          return elements.filter((element) => {
            const twin = seen.has(element.id) && rng() < 0.8;
            seen.add(element.id);
            return !twin;
          });
        },
      ];

      try {
        for (let step = 0; step < 60; step++) {
          elements = edits[int(edits.length)]();
          const x = int(3000);
          const y = int(2000);
          const bounds: Bounds = [x, y, x + int(1500), y + int(1000)];
          expect(query(elements, bounds).result).toEqual(
            linear(elements, bounds),
          );

          const progress = rng();
          if (progress < 0.25) {
            index.rebuild();
          } else if (progress < 0.75) {
            clock.advance(1000);
            for (let task = int(12); task > 0 && clock.runIdle(); task--) {}
          }

          if (internals.index !== installed) {
            installed = internals.index;
            checkedInstalls++;
            expect(sortedEntries(installed.slotOf)).toEqual(
              sortedEntries(freshSlotOf(installed.slotElements)),
            );
          }
          expect(query(elements, bounds).result).toEqual(
            linear(elements, bounds),
          );
        }
      } finally {
        observeElementsRTreeRebuildTasks(null);
      }
      expect(checkedInstalls).toBeGreaterThan(10);
      expect(Math.max(...taskMs)).toBeLessThanOrEqual(
        REBUILD_SLICE_MS + Math.max(REBUILD_STEP_MS, measureCostMs) + 1e-9,
      );
    },
  );
});
