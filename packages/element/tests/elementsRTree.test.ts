import { arrayToMap, type Bounds } from "@excalidraw/common";
import { pointFrom, type LocalPoint } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { getElementPaintBounds } from "../src/bounds";
import { ElementsRTree } from "../src/elementsRTree";
import { mutateElement, newElementWith } from "../src/mutateElement";
import { getContainerElement } from "../src/textElement";
import { isTextElement } from "../src/typeChecks";

import type { ElementsMap, ExcalidrawElement } from "../src/types";

/** a 100x100 grid of 20x20 rectangles, 50 units apart */
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

/** a window whose clock and idle periods move only when the test says */
const testWindow = () => {
  let now = 0;
  let nextId = 1;
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
  } as unknown as Window;
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
  };
  /** runs the idle callbacks pending now, each with a long idle period */
  const runIdle = () => {
    const pending = [...idle];
    idle.clear();
    for (const [, run] of pending) {
      run({ didTimeout: false, timeRemaining: () => 50 });
    }
    return pending.length;
  };
  return { window, advance, runIdle };
};

const setup = (elements: readonly ExcalidrawElement[]) => {
  let measured = 0;
  const clock = testWindow();
  const index = new ElementsRTree<ExcalidrawElement>(
    (element, elementsMap) => {
      measured++;
      return getElementPaintBounds(element, elementsMap);
    },
    (element, elementsMap) =>
      isTextElement(element) ? getContainerElement(element, elementsMap) : null,
    () => clock.window,
  );
  // one map per array, as the scene keeps one
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
  /** measures done outside queries, by rebuilds */
  const rebuildWork = (run: () => void) => {
    measured = 0;
    run();
    return measured;
  };
  query(elements);
  index.rebuild();
  return { index, query, clock, rebuildWork };
};

/** what every query must agree with: each element tested in order */
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

    // every element changed: each is measured, as a linear scan would
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

  it("bounds the work of each idle task, and keeps the old tree until the new one is complete", () => {
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
        // the old tree answers until the new one replaces it
        expect(measuredBetween).toBe(next.length);
      }
      expect(perTask.length).toBeLessThan(1000);
    }
    expect(Math.max(...perTask)).toBeLessThanOrEqual(2048);
    expect(perTask.length).toBeGreaterThan(next.length / 2048);
  });

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

    // a second after the drag the tree is rebuilt in idle time
    clock.advance(1000);
    while (clock.runIdle()) {
      // next task
    }
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
    while (clock.runIdle()) {
      // next task
    }
    expect(edit().measured).toBe(40);
    clock.advance(900);
    while (clock.runIdle()) {
      // next task
    }
    expect(query(next).measured).toBe(40);

    clock.advance(100);
    while (clock.runIdle()) {
      // next task
    }
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
});
