import React from "react";
import { vi } from "vitest";

import { CaptureUpdateAction } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

import type { PointerDownState } from "../types";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const onPointerDown = vi.fn();
const onPointerUp = vi.fn();

// known to the store, so undo goes back to it, without being undoable itself
const seed = (elements: ExcalidrawElement[]) =>
  API.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });

const copiesAt = (callback: typeof onPointerDown) =>
  (callback.mock.lastCall![1] as PointerDownState).originalElements;

const get = (id: string) => h.elements.find((element) => element.id === id)!;
const position = (id: string) => [get(id).x, get(id).y];
const arrowEnds = () => {
  const arrow = get("arrow") as ExcalidrawArrowElement;
  return arrow.points.map(([x, y]) => [arrow.x + x, arrow.y + y]);
};

beforeEach(async () => {
  onPointerDown.mockClear();
  onPointerUp.mockClear();
  mouse.reset();
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    />,
  );
});

describe("the board snapshot a pointer-down takes", () => {
  beforeEach(() => {
    seed([
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      }),
      API.createElement({
        type: "ellipse",
        x: 100,
        y: 0,
        width: 50,
        height: 50,
      }),
      API.createElement({
        type: "diamond",
        x: 200,
        y: 0,
        width: 50,
        height: 50,
      }),
    ]);
  });

  it.each(["freedraw", "rectangle", "arrow"] as const)(
    "copies none of the board when a %s gesture starts",
    (tool) => {
      UI.clickTool(tool);
      mouse.downAt(400, 400);
      mouse.moveTo(440, 460);
      mouse.upAt(440, 460);

      expect(copiesAt(onPointerDown).size).toBe(0);
      expect(copiesAt(onPointerUp).size).toBe(0);
      expect(h.elements).toHaveLength(4);
    },
  );
});

describe("a selection gesture", () => {
  // a labelled box with an arrow bound to it, and an unrelated shape
  beforeEach(() => {
    seed([
      API.createElement({
        type: "rectangle",
        id: "box",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        backgroundColor: "#ffc9c9",
        fillStyle: "solid",
        boundElements: [
          { type: "text", id: "label" },
          { type: "arrow", id: "arrow" },
        ],
      }),
      API.createElement({
        type: "text",
        id: "label",
        text: "label",
        x: 5,
        y: 5,
        width: 50,
        height: 20,
        containerId: "box",
      }),
      API.createElement({
        type: "arrow",
        id: "arrow",
        x: 300,
        y: 50,
        width: 190,
        height: 0,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(-190, 0)],
        endBinding: {
          elementId: "box",
          fixedPoint: [0.5001, 0.5001],
          mode: "orbit",
        },
      }),
      API.createElement({
        type: "rectangle",
        id: "far",
        x: 500,
        y: 300,
        width: 50,
        height: 50,
        backgroundColor: "#ffc9c9",
        fillStyle: "solid",
      }),
    ]);
    UI.clickTool("selection");
  });

  it("selects a clicked element without copying the board", () => {
    mouse.clickAt(525, 325);

    expect(h.state.selectedElementIds).toEqual({ far: true });
    expect(API.getUndoStack()).toHaveLength(1);
    expect(copiesAt(onPointerDown).size).toBe(0);
    expect(copiesAt(onPointerUp).size).toBe(0);
  });

  it("drags a box with its label and arrow, copying only the box and label", () => {
    const arrowBefore = arrowEnds();

    // several moves, so a label read from its moved state would drift
    mouse.downAt(50, 20);
    mouse.moveTo(70, 30);
    mouse.moveTo(90, 50);
    mouse.moveTo(100, 60);
    mouse.upAt(100, 60);

    expect(position("box")).toEqual([50, 40]);
    expect(position("label")).toEqual([55, 45]);
    expect(position("far")).toEqual([500, 300]);
    expect((get("arrow") as ExcalidrawArrowElement).endBinding?.elementId).toBe(
      "box",
    );
    expect(arrowEnds()[0]).toEqual(arrowBefore[0]);
    expect(arrowEnds()[1]).not.toEqual(arrowBefore[1]);

    Keyboard.undo();

    expect(position("box")).toEqual([0, 0]);
    expect(position("label")).toEqual([5, 5]);
    // back beside the box's right edge, where the binding puts it
    const [start, end] = arrowEnds();
    expect(start).toEqual(arrowBefore[0]);
    expect(end[0]).toBeGreaterThan(100);
    expect(end[0]).toBeLessThanOrEqual(110);
    expect(end[1]).toBeCloseTo(50, 1);
    expect([...copiesAt(onPointerUp).keys()].sort()).toEqual(["box", "label"]);
  });

  it("alt-drag duplicates the box and label, leaving the originals in place", () => {
    mouse.downAt(50, 20);
    Keyboard.withModifierKeys({ alt: true }, () => {
      mouse.moveTo(70, 30);
      mouse.moveTo(100, 60);
    });
    mouse.upAt(100, 60);

    expect(position("box")).toEqual([0, 0]);
    expect(position("label")).toEqual([5, 5]);
    const duplicates = h.elements.filter(
      (element) => !["box", "label", "arrow", "far"].includes(element.id),
    );
    expect(duplicates.map(({ type, x, y }) => [type, x, y])).toEqual([
      ["rectangle", 50, 40],
      ["text", 55, 45],
    ]);

    Keyboard.undo();

    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(4);
    expect(position("box")).toEqual([0, 0]);
    expect(position("label")).toEqual([5, 5]);
    expect([...copiesAt(onPointerUp).keys()].sort()).toEqual(
      ["box", "label", ...duplicates.map((element) => element.id)].sort(),
    );
  });
});

describe("a frame drag", () => {
  beforeEach(() => {
    seed([
      API.createElement({
        type: "frame",
        id: "frame",
        x: 0,
        y: 0,
        width: 300,
        height: 300,
      }),
      API.createElement({
        type: "rectangle",
        id: "card",
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        frameId: "frame",
        boundElements: [{ type: "text", id: "cardLabel" }],
      }),
      API.createElement({
        type: "text",
        id: "cardLabel",
        text: "card",
        x: 55,
        y: 55,
        width: 50,
        height: 20,
        containerId: "card",
        frameId: "frame",
      }),
      API.createElement({
        type: "rectangle",
        x: 500,
        y: 0,
        width: 50,
        height: 50,
      }),
    ]);
    UI.clickTool("selection");
  });

  it("moves the frame's children and their labels, copying only those", () => {
    API.setAppState({ selectedElementIds: { frame: true } });

    // inside the selected frame's box, clear of the card
    mouse.downAt(250, 250);
    mouse.moveTo(260, 260);
    mouse.moveTo(280, 280);
    mouse.upAt(280, 280);

    expect(position("frame")).toEqual([30, 30]);
    expect(position("card")).toEqual([80, 80]);
    expect(position("cardLabel")).toEqual([85, 85]);

    Keyboard.undo();

    expect(position("frame")).toEqual([0, 0]);
    expect(position("card")).toEqual([50, 50]);
    expect(position("cardLabel")).toEqual([55, 55]);
    expect([...copiesAt(onPointerUp).keys()].sort()).toEqual(
      ["card", "cardLabel", "frame"].sort(),
    );
  });
});
