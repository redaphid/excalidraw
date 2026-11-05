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
    // the static canvas still holds what lies below the stroke
    expect(takePainted()).toEqual({
      static: [stroke.id, frame.id, above.id, embeddable.id],
      newElement: [],
    });
  });

  it("repaints in full on release when an element below changed while the static canvas held", async () => {
    const { embeddable, frame, below, above } = await board();
    UI.clickTool("freedraw");
    const mouse = new Pointer("mouse");
    mouse.downAt(200, 60);
    mouse.moveTo(220, 80);
    const stroke = h.state.newElement!;
    h.app.scene.mutateElement(
      h.app.scene.getElement(below.id)!,
      { strokeColor: "#e03131" },
      { informMutation: false, isDragging: false },
    );
    takePainted();

    mouse.upAt(240, 90);
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

describe("a new element drawn outside any frame", () => {
  it("paints only itself over the static canvas on release", async () => {
    await render(<Excalidraw />);
    const rectangle = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 100,
    });
    API.setElements([rectangle]);
    API.setAppState({ width: 1000, height: 800 });
    UI.clickTool("freedraw");
    const mouse = new Pointer("mouse");
    mouse.downAt(300, 300);
    mouse.moveTo(320, 340);
    const stroke = h.state.newElement!;
    expect(stroke.frameId).toBe(null);
    takePainted();

    mouse.upAt(360, 380);
    expect(takePainted()).toEqual({ static: [stroke.id], newElement: [] });
  });
});
