import React from "react";

import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard, Pointer } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  render,
  unmountComponent,
} from "@excalidraw/excalidraw/tests/test-utils";
import { KEYS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { getFrameContents } from "../src/frame";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "../src/types";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

// The Rusty Conquistador's board: an outer frame with a page frame nested in
// it, and a neighbouring frame that overlaps the page
const board = () => [
  API.createElement({
    type: "frame",
    id: "lair",
    x: 0,
    y: 0,
    width: 600,
    height: 600,
  }),
  API.createElement({
    type: "frame",
    id: "page",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  }),
  API.createElement({
    type: "frame",
    id: "valley",
    x: 250,
    y: 250,
    width: 400,
    height: 300,
  }),
  API.createElement({
    type: "frame",
    id: "faraway",
    x: 800,
    y: 0,
    width: 100,
    height: 100,
  }),
  // the page's own child
  API.createElement({
    id: "pageChild",
    x: 120,
    y: 120,
    width: 20,
    height: 20,
    frameId: "page",
  }),
  // drawn inside the page, but claimed by the outer frame
  API.createElement({
    id: "claimedByLair",
    x: 160,
    y: 160,
    width: 20,
    height: 20,
    frameId: "lair",
  }),
  // drawn inside the page without any frame
  API.createElement({
    id: "loose",
    x: 200,
    y: 120,
    width: 20,
    height: 20,
  }),
  // the outer frame's own child, outside the page
  API.createElement({
    id: "lairChild",
    x: 20,
    y: 400,
    width: 20,
    height: 20,
    frameId: "lair",
  }),
  // another frame's element drawn on top of the page
  API.createElement({
    id: "valleys",
    x: 260,
    y: 260,
    width: 20,
    height: 20,
    frameId: "valley",
  }),
  // in the page's frame but reaching past it
  API.createElement({
    id: "spill",
    x: 280,
    y: 140,
    width: 60,
    height: 20,
    frameId: "page",
  }),
  // the outer frame's, reaching from inside the page past its edge
  API.createElement({
    id: "straddle",
    x: 280,
    y: 200,
    width: 60,
    height: 20,
    frameId: "lair",
  }),
  // in no frame, reaching past the outer frame's edge
  API.createElement({
    id: "overhang",
    x: 590,
    y: 20,
    width: 40,
    height: 20,
  }),
  API.createElement({
    id: "faraways",
    x: 820,
    y: 20,
    width: 20,
    height: 20,
  }),
];

const select = (id: string) =>
  API.setSelectedElements(
    h.elements.filter(
      (each) => each.id === id,
    ) as NonDeletedExcalidrawElement[],
  );

const ids = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => element.id).sort();

describe("getFrameContents", () => {
  it("carries a nested frame and all that belongs to it with the outer frame", () => {
    expect(ids(getFrameContents(board(), ["lair"]))).toEqual([
      "claimedByLair",
      "lairChild",
      "loose",
      "page",
      "pageChild",
      "spill",
      "straddle",
    ]);
  });

  it("carries what sits wholly inside a nested frame, whoever claimed it", () => {
    expect(ids(getFrameContents(board(), ["page"]))).toEqual([
      "claimedByLair",
      "loose",
      "pageChild",
      "spill",
    ]);
  });

  it("gives an element reaching past a nested frame to the frame that holds it whole", () => {
    expect(ids(getFrameContents(board(), ["page"]))).not.toContain("straddle");
    expect(ids(getFrameContents(board(), ["lair"]))).toContain("straddle");
    expect(ids(getFrameContents(board(), ["lair"]))).not.toContain("overhang");
  });

  it("leaves another frame's element on top, and a frame that only overlaps", () => {
    const carried = ids(getFrameContents(board(), ["page"]));

    expect(carried).not.toContain("valleys");
    expect(carried).not.toContain("valley");
    expect(ids(getFrameContents(board(), ["valley"]))).toEqual(["valleys"]);
  });

  it("carries a label with its container, not on its own", () => {
    const box = API.createElement({
      id: "box",
      x: 120,
      y: 200,
      width: 60,
      height: 40,
      boundElements: [{ type: "text", id: "boxLabel" }],
    });
    const label = API.createElement({
      type: "text",
      id: "boxLabel",
      x: 125,
      y: 205,
      width: 40,
      height: 20,
      containerId: "box",
    });

    expect(ids(getFrameContents([...board(), box, label], ["page"]))).toEqual([
      "box",
      "claimedByLair",
      "loose",
      "pageChild",
      "spill",
    ]);
  });
});

describe("dragging a frame", () => {
  const position = (id: string) => {
    const element = h.elements.find((each) => each.id === id)!;
    return [element.x, element.y];
  };

  beforeEach(async () => {
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    API.setElements(board());
  });

  it("moves the frames nested in it and everything that belongs to them", () => {
    select("lair");

    mouse.downAt(500, 50);
    mouse.moveTo(520, 80);
    mouse.moveTo(550, 150);
    mouse.upAt(550, 150);

    expect(position("lair")).toEqual([50, 100]);
    expect(position("page")).toEqual([150, 200]);
    expect(position("pageChild")).toEqual([170, 220]);
    expect(position("claimedByLair")).toEqual([210, 260]);
    expect(position("loose")).toEqual([250, 220]);
    expect(position("lairChild")).toEqual([70, 500]);
    expect(position("spill")).toEqual([330, 240]);
    expect(position("straddle")).toEqual([330, 300]);
    expect(position("overhang")).toEqual([590, 20]);
    expect(position("valley")).toEqual([250, 250]);
    expect(position("valleys")).toEqual([260, 260]);
    expect(position("faraway")).toEqual([800, 0]);
    expect(position("faraways")).toEqual([820, 20]);
  });

  it("moves what sits inside a nested frame, and leaves its neighbour's", () => {
    select("page");

    mouse.downAt(110, 290);
    mouse.moveTo(120, 300);
    mouse.moveTo(130, 310);
    mouse.upAt(130, 310);

    expect(position("page")).toEqual([120, 120]);
    expect(position("pageChild")).toEqual([140, 140]);
    expect(position("claimedByLair")).toEqual([180, 180]);
    expect(position("loose")).toEqual([220, 140]);
    expect(position("valleys")).toEqual([260, 260]);
    expect(position("lairChild")).toEqual([20, 400]);
    expect(position("straddle")).toEqual([280, 200]);
  });

  it("keeps an arrow bound across frames on both its ends", () => {
    const arrow = API.createElement({
      type: "arrow",
      id: "bridge",
      x: 140,
      y: 130,
      width: 680,
      height: 100,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(680, -100)],
      startBinding: {
        elementId: "pageChild",
        fixedPoint: [0.5001, 0.5001],
        mode: "orbit",
      },
      endBinding: {
        elementId: "faraways",
        fixedPoint: [0.5001, 0.5001],
        mode: "orbit",
      },
    });
    API.setElements([
      ...board().map((element) =>
        element.id === "pageChild" || element.id === "faraways"
          ? {
              ...element,
              boundElements: [{ type: "arrow" as const, id: "bridge" }],
            }
          : element,
      ),
      arrow,
    ]);
    const bridge = () =>
      h.elements.find((each) => each.id === "bridge") as ExcalidrawArrowElement;
    const ends = () =>
      bridge().points.map(([x, y]) => [bridge().x + x, bridge().y + y]);
    const [startBefore] = ends();
    select("page");

    mouse.downAt(110, 290);
    mouse.moveTo(120, 300);
    mouse.moveTo(130, 310);
    mouse.upAt(130, 310);

    const [start, end] = ends();
    expect(position("pageChild")).toEqual([140, 140]);
    expect(bridge().startBinding?.elementId).toBe("pageChild");
    expect(bridge().endBinding?.elementId).toBe("faraways");
    // the bound end sits on the moved box's outline, wherever it orbits to
    expect(start).not.toEqual(startBefore);
    expect(start[0]).toBeGreaterThanOrEqual(130);
    expect(start[0]).toBeLessThanOrEqual(170);
    expect(start[1]).toBeGreaterThanOrEqual(130);
    expect(start[1]).toBeLessThanOrEqual(170);
    expect(end[0]).toBeGreaterThanOrEqual(810);
    expect(end[0]).toBeLessThanOrEqual(850);
    expect(end[1]).toBeGreaterThanOrEqual(10);
    expect(end[1]).toBeLessThanOrEqual(50);
  });

  it("carries the same contents when nudged with an arrow key", () => {
    select("lair");

    Keyboard.keyPress(KEYS.ARROW_RIGHT);

    expect(position("lair")).toEqual([1, 0]);
    expect(position("page")).toEqual([101, 100]);
    expect(position("pageChild")).toEqual([121, 120]);
    expect(position("claimedByLair")).toEqual([161, 160]);
    expect(position("loose")).toEqual([201, 120]);
    expect(position("valleys")).toEqual([260, 260]);
  });
});
