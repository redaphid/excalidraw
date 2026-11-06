import { isElementInViewport, Scene } from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  NonDeletedElementsMap,
} from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = ReturnType<typeof mulberry32>;

const between = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);

/** sizes from a millionth of a unit up to a thousand, half of them clustered
 * around one point the way deep-zoom detail is */
const randomBoard = (rng: Rng, count: number) => {
  const elements: ExcalidrawElement[] = [];
  const frame = API.createElement({
    type: "frame",
    x: -2000,
    y: -2000,
    width: 3000,
    height: 3000,
  });
  for (let i = 0; i < count; i++) {
    const size = 10 ** between(rng, -6, 3);
    const clustered = rng() < 0.5;
    const x = clustered
      ? 500 + between(rng, -2, 2) * size
      : between(rng, -5e3, 5e3);
    const y = clustered
      ? 500 + between(rng, -2, 2) * size
      : between(rng, -5e3, 5e3);
    const common = {
      x,
      y,
      width: size,
      height: size * between(rng, 0.2, 2),
      angle: rng() < 0.3 ? between(rng, 0, Math.PI * 2) : 0,
      strokeWidth: size / 50,
      frameId:
        x < frame.x + frame.width &&
        y < frame.y + frame.height &&
        x > frame.x &&
        y > frame.y
          ? frame.id
          : null,
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
        text: "label",
        x: x + size / 2,
        y: y + size / 2,
        fontSize: Math.max(size / 10, 1e-6) as never,
        containerId: container.id,
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

const randomView = (
  rng: Rng,
  elements: readonly ExcalidrawElement[],
): AppState => {
  const zoom = 10 ** between(rng, -1, 6);
  const width = between(rng, 300, 1600);
  const height = between(rng, 300, 1000);
  const anchor = elements[Math.floor(rng() * elements.length)];
  const centerX = anchor.x + between(rng, -1, 1) * (width / zoom);
  const centerY = anchor.y + between(rng, -1, 1) * (height / zoom);
  return {
    ...getDefaultAppState(),
    width,
    height,
    offsetLeft: between(rng, 0, 100),
    offsetTop: between(rng, 0, 100),
    zoom: { value: zoom as AppState["zoom"]["value"] },
    scrollX: width / 2 / zoom - centerX,
    scrollY: height / 2 / zoom - centerY,
  };
};

/** the elements every visible-element query must agree with: a scan of the
 * whole map in its order */
const linearCull = (elementsMap: NonDeletedElementsMap, appState: AppState) =>
  [...elementsMap.values()].filter(
    (element) =>
      element.id === appState.newElement?.id ||
      isElementInViewport(
        element,
        appState.width,
        appState.height,
        appState,
        elementsMap,
      ),
  );

const ids = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => element.id);

describe("the visible elements", () => {
  it("are those a linear scan keeps, in z-order, across random boards, views and edits", () => {
    const rng = mulberry32(7);
    let nonEmpty = 0;
    for (let board = 0; board < 12; board++) {
      const elements = randomBoard(rng, 150);
      const scene = new Scene(elements, { skipValidation: true });
      const renderer = new Renderer(scene);
      for (let step = 0; step < 40; step++) {
        const appState = randomView(rng, scene.getNonDeletedElements());
        const framed = scene
          .getNonDeletedElements()
          .filter((element) => element.frameId && element.type === "freedraw");
        if (rng() < 0.2 && framed.length) {
          appState.newElement = framed[
            Math.floor(rng() * framed.length)
          ] as AppState["newElement"];
        }
        const { elementsMap, visibleElements } = renderer.getRenderableElements(
          {
            ...appState,
            selectedElements: [],
          },
        );
        const expected = ids(linearCull(elementsMap, appState));
        expect(ids(visibleElements)).toEqual(expected);
        nonEmpty += expected.length > 1 ? 1 : 0;

        const target =
          scene.getNonDeletedElements()[
            Math.floor(rng() * scene.getNonDeletedElements().length)
          ];
        const edit = rng();
        if (edit < 0.25) {
          // moved where the next view may land, without telling the scene
          scene.mutateElement(
            target,
            { x: target.x + between(rng, -1e3, 1e3), y: target.y * 0.5 },
            { informMutation: edit < 0.1, isDragging: false },
          );
        } else if (edit < 0.35) {
          scene.replaceAllElements(
            [
              ...scene
                .getElementsIncludingDeleted()
                .filter((el) => el !== target),
              ...randomBoard(rng, 2),
            ],
            { skipValidation: true },
          );
        }
      }
    }
    // the random views must mostly land on something to test the order
    expect(nonEmpty).toBeGreaterThan(200);
  });

  it("include an element that only touches the edge of the view", () => {
    const edge = API.createElement({
      type: "rectangle",
      x: 100,
      y: 0,
      width: 50,
      height: 50,
      strokeWidth: 2,
      roughness: 0,
    });
    const renderer = new Renderer(new Scene([edge], { skipValidation: true }));
    const { visibleElements } = renderer.getRenderableElements({
      ...getDefaultAppState(),
      width: 500,
      height: 500,
      offsetLeft: 0,
      offsetTop: 0,
      // the stroke reaches x = 99, the right edge of the view
      scrollX: 401,
      scrollY: 0,
      selectedElements: [],
    });
    expect(visibleElements).toEqual([edge]);
  });

  it("are found without touching elements far from a deep-zoomed view", () => {
    const rng = mulberry32(11);
    const touched = new Set<string>();
    let recording = false;
    const elements = randomBoard(rng, 1000).map(
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
    const scene = new Scene(elements, { skipValidation: true });
    const renderer = new Renderer(scene);
    const view = (scrollX: number): AppState => ({
      ...getDefaultAppState(),
      width: 1000,
      height: 800,
      offsetLeft: 0,
      offsetTop: 0,
      zoom: { value: 1e6 as AppState["zoom"]["value"] },
      scrollX,
      scrollY: 400 / 1e6 - 500,
    });
    renderer.getRenderableElements({
      ...view(500 / 1e6 - 500),
      selectedElements: [],
    });

    recording = true;
    const { visibleElements } = renderer.getRenderableElements({
      ...view(500 / 1e6 - 500 - 1e-4),
      selectedElements: [],
    });
    recording = false;

    expect(visibleElements.length).toBeGreaterThan(0);
    expect(touched.size).toBeLessThan(elements.length / 10);
  });
});
