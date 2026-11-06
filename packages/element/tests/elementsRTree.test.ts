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

const setup = (elements: readonly ExcalidrawElement[]) => {
  let measured = 0;
  const index = new ElementsRTree<ExcalidrawElement>(
    (element, elementsMap) => {
      measured++;
      return getElementPaintBounds(element, elementsMap);
    },
    (element, elementsMap) =>
      isTextElement(element) ? getContainerElement(element, elementsMap) : null,
  );
  const query = (
    elements: readonly ExcalidrawElement[],
    elementsMap: ElementsMap = arrayToMap(elements),
    bounds: Bounds = view,
  ) => {
    measured = 0;
    const result = index.query(elements, elementsMap, bounds, null);
    return { result, measured };
  };
  query(elements);
  index.rebuild();
  return { index, query };
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

describe("ElementsRTree", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("rebuilds in idle time, not when the array changes", () => {
    vi.useFakeTimers();
    const elements = grid();
    const { query } = setup(elements);
    const next = elements.map((element) =>
      newElementWith(element, { x: element.x + 5 }),
    );

    // every element changed: each is measured, as a linear scan would, and
    // no rebuild runs during the query
    expect(query(next).measured).toBe(next.length);
    expect(query(next).measured).toBe(next.length);

    vi.runAllTimers();
    const { result, measured } = query(next);
    expect(measured).toBe(0);
    expect(result).toEqual(linear(next));
  });

  it("waits for a few edits to settle before rebuilding", () => {
    vi.useFakeTimers();
    const elements = grid();
    const { query } = setup(elements);
    let next = elements;
    const edit = (i: number) => {
      next = next.map((element, k) =>
        k === i ? newElementWith(element, { x: 1100, y: 1050 }) : element,
      );
      return query(next);
    };

    expect(edit(1).measured).toBe(1);
    vi.advanceTimersByTime(900);
    expect(edit(2).measured).toBe(2);
    vi.advanceTimersByTime(900);
    expect(query(next).measured).toBe(2);

    vi.runAllTimers();
    const { result, measured } = query(next);
    expect(measured).toBe(0);
    expect(result).toEqual(linear(next));
  });
});
