import { arrayToMap, type Bounds } from "@excalidraw/common";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  elementsOverlappingBBox,
  elementsTouchingBBox,
  getElementBounds,
} from "../src/bounds";
import { getContainingFrame } from "../src/frame";
import { LinearElementEditor } from "../src/linearElementEditor";
import { mutateElement } from "../src/mutateElement";
import { getBoundTextElement, getContainerElement } from "../src/textElement";
import { isArrowElement, isTextElement } from "../src/typeChecks";

import { linearElementsOverlappingBBox } from "./linearElementsOverlappingBBox";

import type { ElementsMap, ExcalidrawElement } from "../src/types";

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = ReturnType<typeof mulberry32>;

const between = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);

/** labelled shapes and arrows, strokes, groups and frames, from a millionth of
 * a unit up to a thousand across */
const randomBoard = (rng: Rng, count: number) => {
  const frame = API.createElement({
    type: "frame",
    x: -1500,
    y: -1500,
    width: 2500,
    height: 2500,
  });
  const groups = ["g1", "g2", "g3", "g4"];
  const elements: ExcalidrawElement[] = [];
  for (let i = 0; i < count; i++) {
    const size = 10 ** between(rng, -6, 3);
    const x =
      rng() < 0.5 ? 500 + between(rng, -2, 2) * size : between(rng, -4e3, 4e3);
    const y =
      rng() < 0.5 ? 500 + between(rng, -2, 2) * size : between(rng, -4e3, 4e3);
    const common = {
      x,
      y,
      width: size,
      height: size * between(rng, 0.2, 2),
      angle: rng() < 0.3 ? between(rng, 0, Math.PI * 2) : 0,
      strokeWidth: size / between(rng, 5, 50),
      groupIds: rng() < 0.2 ? [groups[Math.floor(rng() * groups.length)]] : [],
      frameId:
        x > frame.x &&
        y > frame.y &&
        x < frame.x + frame.width &&
        y < frame.y + frame.height &&
        rng() < 0.7
          ? frame.id
          : null,
      locked: rng() < 0.1,
    };
    const kind = Math.floor(rng() * 5);
    if (kind === 0) {
      elements.push(
        API.createElement({
          ...common,
          type: "freedraw",
          points: [
            pointFrom<LocalPoint>(0, 0),
            pointFrom<LocalPoint>(size, size / 3),
            pointFrom<LocalPoint>(size / 2, size),
          ],
        }),
      );
    } else if (kind === 1 || kind === 2) {
      const container = API.createElement({
        ...common,
        type: kind === 1 ? "arrow" : "rectangle",
        ...(kind === 1
          ? {
              points: [
                pointFrom<LocalPoint>(0, 0),
                pointFrom<LocalPoint>(size, size),
              ],
            }
          : {}),
      });
      const label = API.createElement({
        type: "text",
        text: "a label",
        x: x + size / 2,
        y: y + size / 2,
        fontSize: Math.max(size / 4, 1e-6) as never,
        containerId: container.id,
        groupIds: common.groupIds,
        frameId: common.frameId,
      });
      elements.push(
        { ...container, boundElements: [{ id: label.id, type: "text" }] },
        label,
      );
    } else {
      elements.push(
        API.createElement({
          ...common,
          type: kind === 3 ? "ellipse" : "diamond",
        }),
      );
    }
  }
  return [...elements, frame];
};

/** a box near some element, sized from a tenth of it to a hundred times it;
 * now and then inverted, as the scan reads one */
const randomBounds = (
  rng: Rng,
  elements: readonly ExcalidrawElement[],
): Bounds => {
  const anchor = elements[Math.floor(rng() * elements.length)];
  const size = Math.max(anchor.width, 1e-6) * 10 ** between(rng, -1, 2);
  const x = anchor.x + between(rng, -1, 1) * size;
  const y = anchor.y + between(rng, -1, 1) * size;
  const box: Bounds = [
    x,
    y,
    x + size * between(rng, 0.2, 2),
    y + size * between(rng, 0.2, 2),
  ];
  return rng() < 0.05 ? [box[2], box[3], box[0], box[1]] : box;
};

const ids = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => element.id);

/** the elements whose stroke-grown box, with an arrow's label, touches the
 * box, by a scan of every element, each with the frame, label or container
 * it looks up */
const touchingByScan = (
  elements: readonly ExcalidrawElement[],
  box: Bounds,
  elementsMap: ElementsMap,
) => {
  const touching: ExcalidrawElement[] = [];
  const related = new Set<string>();
  for (const element of elements) {
    let [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
    const halfStroke = element.strokeWidth / 2;
    x1 -= halfStroke;
    y1 -= halfStroke;
    x2 += halfStroke;
    y2 += halfStroke;
    const label =
      isArrowElement(element) && getBoundTextElement(element, elementsMap);
    if (label) {
      const { x, y } = LinearElementEditor.getBoundTextElementPosition(
        element,
        label,
        elementsMap,
      );
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x + label.width);
      y2 = Math.max(y2, y + label.height);
    }
    if (box[0] <= x2 && box[1] <= y2 && box[2] >= x1 && box[3] >= y1) {
      touching.push(element);
      for (const other of [
        getContainingFrame(element, elementsMap),
        label || null,
        isTextElement(element)
          ? getContainerElement(element, elementsMap)
          : null,
      ]) {
        if (other) {
          related.add(other.id);
        }
      }
    }
  }
  return { touching, related };
};

describe("elementsOverlappingBBox", () => {
  it("finds what a scan of every element finds, in order, across random boards, boxes and edits", () => {
    const rng = mulberry32(5);
    let found = 0;
    for (let board = 0; board < 10; board++) {
      let elements = randomBoard(rng, 120);
      for (let step = 0; step < 40; step++) {
        const elementsMap: ElementsMap | undefined =
          rng() < 0.5 ? arrayToMap(elements) : undefined;
        const opts = {
          elements,
          elementsMap,
          bounds: randomBounds(rng, elements),
          type: rng() < 0.5 ? ("overlap" as const) : ("contain" as const),
          excludeElementsInFrames: rng() < 0.5,
          shouldIgnoreElementFromSelection:
            rng() < 0.5
              ? (element: ExcalidrawElement) =>
                  element.locked ||
                  (element.type === "text" && !!element.containerId)
              : undefined,
        };
        const expected = ids(linearElementsOverlappingBBox(opts));
        expect(ids(elementsOverlappingBBox(opts))).toEqual(expected);
        expect(
          ids(elementsTouchingBBox(elements, opts.bounds, elementsMap)),
        ).toEqual(
          ids(
            touchingByScan(
              elements,
              opts.bounds,
              elementsMap ?? arrayToMap(elements),
            ).touching,
          ),
        );
        found += expected.length;

        const target = elements[Math.floor(rng() * elements.length)];
        const edit = rng();
        if (edit < 0.3) {
          // in place, as a drag does, so the array stays the same
          mutateElement(target, arrayToMap(elements), {
            x: target.x + between(rng, -500, 500),
            groupIds: rng() < 0.3 ? ["g1"] : target.groupIds,
          });
        } else if (edit < 0.4) {
          elements = [
            ...elements.filter((el) => el !== target),
            ...randomBoard(rng, 1),
          ];
        } else if (edit < 0.5) {
          // the array is replaced, as the scene does after any change
          elements = [...elements];
        }
      }
    }
    expect(found).toBeGreaterThan(400);
  });

  it("reads only the elements whose box touches a small box, and what they point to, once the array has been seen", () => {
    const rng = mulberry32(9);
    const touched = new Set<string>();
    let recording = false;
    const board = randomBoard(rng, 1000);
    const elements = board.map(
      (element) =>
        new Proxy(element, {
          get(target, key, receiver) {
            if (recording) {
              touched.add(target.id);
            }
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const near: Bounds = [499.999, 499.999, 500.001, 500.001];
    elementsOverlappingBBox({ elements, bounds: near, type: "overlap" });

    const box: Bounds = [500, 500, 500.002, 500.002];
    recording = true;
    const found = elementsOverlappingBBox({
      elements,
      bounds: box,
      type: "overlap",
    });
    recording = false;

    const { touching, related } = touchingByScan(board, box, arrayToMap(board));
    const expected = new Set([...ids(touching), ...related]);

    expect(found.length).toBeGreaterThan(0);
    expect(expected.size).toBeLessThan(board.length / 5);
    expect([...touched].filter((id) => !expected.has(id))).toEqual([]);
  });
});
