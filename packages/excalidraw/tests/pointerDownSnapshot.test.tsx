import React from "react";
import { vi } from "vitest";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

import type { PointerDownState } from "../types";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

describe("the board snapshot a pointer-down takes", () => {
  const onPointerDown = vi.fn();
  const board = () => [
    API.createElement({ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }),
    API.createElement({ type: "ellipse", x: 100, y: 0, width: 50, height: 50 }),
    API.createElement({ type: "diamond", x: 200, y: 0, width: 50, height: 50 }),
  ];

  const lastSnapshot = () =>
    (onPointerDown.mock.lastCall![1] as PointerDownState).originalElements;

  beforeEach(async () => {
    onPointerDown.mockClear();
    mouse.reset();
    await render(<Excalidraw onPointerDown={onPointerDown} />);
    API.setElements(board());
  });

  it.each(["freedraw", "rectangle", "arrow"] as const)(
    "copies none of the board when a %s gesture starts",
    (tool) => {
      UI.clickTool(tool);
      mouse.downAt(400, 400);
      mouse.moveTo(440, 460);
      mouse.upAt(440, 460);

      expect(lastSnapshot().size).toBe(0);
      expect(h.elements).toHaveLength(4);
    },
  );

  it("still copies every element when a selection gesture starts", () => {
    const elements = h.elements;
    UI.clickTool("selection");
    mouse.downAt(400, 400);

    const snapshot = lastSnapshot();
    expect([...snapshot.keys()].sort()).toEqual(
      elements.map((element) => element.id).sort(),
    );
    for (const element of elements) {
      expect(snapshot.get(element.id)).not.toBe(element);
      expect(snapshot.get(element.id)).toEqual(element);
    }
    mouse.upAt(400, 400);
  });
});
