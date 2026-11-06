import { arrayToMap } from "@excalidraw/common";

import { Scene, deepCopyElement, syncMovedIndices } from "@excalidraw/element";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type {
  ExcalidrawElement,
  FractionalIndex,
} from "@excalidraw/element/types";

const board = () => [
  API.createElement({ id: "a", type: "rectangle", index: "a0V" }),
  API.createElement({ id: "f", type: "frame", index: "a1" }),
  API.createElement({ id: "d", type: "ellipse", index: "a2", isDeleted: true }),
];

const added = () => [
  API.createElement({ id: "n1", type: "rectangle" }),
  API.createElement({ id: "n2", type: "frame" }),
  API.createElement({ id: "n3", type: "diamond", isDeleted: true }),
];

// what the scene did before appends had their own path
const insertByReplacingAll = (
  scene: Scene,
  elements: ExcalidrawElement[],
) => {
  const next = [...scene.getElementsIncludingDeleted(), ...elements];
  syncMovedIndices(next, arrayToMap(elements));
  scene.replaceAllElements(next);
};

const state = (scene: Scene) => ({
  elements: scene
    .getElementsIncludingDeleted()
    .map(({ id, index, version }) => ({ id, index, version })),
  map: [...scene.getElementsMapIncludingDeleted().keys()],
  nonDeleted: scene.getNonDeletedElements().map(({ id }) => id),
  nonDeletedMap: [...scene.getNonDeletedElementsMap().keys()],
  frames: scene.getFramesIncludingDeleted().map(({ id }) => id),
  nonDeletedFrames: scene.getNonDeletedFramesLikes().map(({ id }) => id),
});

describe("appending to the scene", () => {
  it.each<
    [
      string,
      {
        initial: () => ExcalidrawElement[];
        toAdd?: () => ExcalidrawElement[];
        corrupt?: (scene: Scene) => void;
      },
    ]
  >([
    ["onto a board", { initial: board }],
    ["onto an empty board", { initial: () => [] }],
    [
      "after an element whose index went bad since the last sync",
      {
        initial: board,
        corrupt: (scene) => {
          Object.assign(scene.getElementsIncludingDeleted().at(-1)!, {
            index: "a!" as FractionalIndex,
          });
        },
      },
    ],
    [
      "an element already on the board",
      { initial: board, toAdd: () => [board()[0]] },
    ],
  ])(
    "matches replacing every element (%s)",
    (_, { initial, toAdd = added, corrupt }) => {
      const elements = initial();
      const appended = new Scene(
        elements.map((el) => deepCopyElement(el)),
        { skipValidation: true },
      );
      const replaced = new Scene(
        elements.map((el) => deepCopyElement(el)),
        { skipValidation: true },
      );
      corrupt?.(appended);
      corrupt?.(replaced);

      appended.insertElementsAtIndex(toAdd(), null);
      insertByReplacingAll(replaced, toAdd());

      expect(state(appended)).toEqual(state(replaced));
    },
  );

  it("gives the new element an index after the last one", () => {
    const scene = new Scene(board());
    const element = API.createElement({ type: "rectangle" });

    scene.insertElement(element);

    expect(scene.getElementsIncludingDeleted().at(-1)).toBe(element);
    expect(element.index! > "a2").toBe(true);
    expect(scene.getNonDeletedElementsMap().get(element.id)).toBe(element);
  });

  it("does not look at the elements before the last one", () => {
    const touched = new Set<string>();
    const elements = Array.from({ length: 1000 }, (_, i) => {
      const element = API.createElement({
        id: `e${i}`,
        type: "rectangle",
        index: `a${String(i).padStart(4, "0")}` as FractionalIndex,
      });
      return new Proxy(element, {
        get(target, key, receiver) {
          touched.add(target.id);
          return Reflect.get(target, key, receiver);
        },
      });
    });
    const scene = new Scene(elements);
    touched.clear();

    scene.insertElement(API.createElement({ type: "rectangle" }));

    expect([...touched]).toEqual(["e999"]);
  });
});
