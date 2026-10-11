import React from "react";
import { vi } from "vitest";

import * as ElementModule from "@excalidraw/element";

import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");
const renderElement = vi.spyOn(ElementModule, "renderElement");

// the last frame schedules settled bitmaps; build them before teardown
afterEach(() => new Promise((resolve) => setTimeout(resolve, 400)));

/** element ids each canvas painted since the last call, in paint order */
const takePainted = () => {
  const painted = { static: [] as string[], newElement: [] as string[] };
  for (const [element, , , , context] of renderElement.mock.calls) {
    const canvas = context.canvas as HTMLCanvasElement;
    painted[canvas.classList.contains("static") ? "static" : "newElement"].push(
      element.id,
    );
  }
  renderElement.mockClear();
  renderStaticScene.mockClear();
  // an embeddable's placeholder label is painted under its owner's id
  return {
    static: [...new Set(painted.static)],
    newElement: [...new Set(painted.newElement)],
  };
};

describe("a new element drawn inside a frame", () => {
  const board = async () => {
    await render(<Excalidraw />);
    const embeddable = API.createElement({
      type: "embeddable",
      x: 300,
      y: 300,
      width: 80,
      height: 60,
    });
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    const below = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      frameId: frame.id,
    });
    const above = API.createElement({
      type: "rectangle",
      x: 150,
      y: 150,
      width: 100,
      height: 100,
    });
    API.setElements([embeddable, below, frame, above]);
    API.setAppState({ width: 1000, height: 800 });
    return { embeddable, frame, below, above };
  };

  it("repaints only what lies above it on each move, over a static canvas that holds", async () => {
    const { embeddable, frame, below, above } = await board();
    UI.clickTool("freedraw");
    const mouse = new Pointer("mouse");
    takePainted();

    mouse.downAt(200, 60);
    const stroke = h.state.newElement!;
    expect(stroke.frameId).toBe(frame.id);
    expect(takePainted()).toEqual({
      static: [below.id],
      newElement: [stroke.id, frame.id, above.id, embeddable.id],
    });

    for (const [x, y] of [
      [220, 80],
      [240, 90],
      [260, 120],
    ]) {
      mouse.moveTo(x, y);
      expect(renderStaticScene).not.toHaveBeenCalled();
      expect(takePainted()).toEqual({
        static: [],
        newElement: [stroke.id, frame.id, above.id, embeddable.id],
      });
    }

    mouse.upAt(260, 120);
    expect(takePainted()).toEqual({
      static: [below.id, stroke.id, frame.id, above.id, embeddable.id],
      newElement: [],
    });
  });

  it("repaints the static canvas when the view moves mid-stroke", async () => {
    const { embeddable, frame, below, above } = await board();
    UI.clickTool("freedraw");
    const mouse = new Pointer("mouse");
    mouse.downAt(200, 60);
    mouse.moveTo(220, 80);
    const stroke = h.state.newElement!;
    takePainted();

    API.setAppState({ scrollX: 5 });
    expect(takePainted()).toEqual({
      static: [below.id],
      newElement: [stroke.id, frame.id, above.id, embeddable.id],
    });
    mouse.upAt(240, 90);
  });
});
