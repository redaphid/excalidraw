import React from "react";
import { vi } from "vitest";

import * as ElementModule from "@excalidraw/element";

import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

import type { AppState } from "../types";

unmountComponent();

const { h } = window;

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");
const renderElement = vi.spyOn(ElementModule, "renderElement");

// the last frame schedules settled bitmaps; build them before teardown
afterEach(() => new Promise((resolve) => setTimeout(resolve, 400)));

/** ids of the elements the new-element canvas painted since the last call */
const takeNewElementPaints = () => {
  const painted = renderElement.mock.calls
    .filter(
      ([, , , , context]) =>
        !(context.canvas as HTMLCanvasElement).classList.contains("static"),
    )
    .map(([element]) => element.id);
  renderElement.mockClear();
  renderStaticScene.mockClear();
  return painted;
};

describe("drawing a new linear element", () => {
  it.each<[string, "arrow" | "line", AppState["currentItemArrowType"]]>([
    ["arrow", "arrow", "round"],
    ["elbow arrow", "arrow", "elbow"],
    ["line", "line", "round"],
  ])(
    "%s: repaints the element on every move and holds the static canvas",
    async (_, tool, currentItemArrowType) => {
      await render(<Excalidraw />);
      const rectangle = API.createElement({
        type: "rectangle",
        x: 400,
        y: 400,
        width: 100,
        height: 100,
      });
      API.setElements([rectangle]);
      API.setAppState({ width: 1000, height: 800, currentItemArrowType });
      UI.clickTool(tool);
      const mouse = new Pointer("mouse");

      mouse.downAt(20, 20);
      mouse.moveTo(40, 40);
      const element = h.state.newElement as ExcalidrawLinearElement;
      expect(element.type).toBe(tool);
      takeNewElementPaints();

      for (const [x, y] of [
        [80, 60],
        [140, 90],
        [200, 150],
        [260, 210],
      ]) {
        mouse.moveTo(x, y);
        expect(renderStaticScene).not.toHaveBeenCalled();
        expect(takeNewElementPaints()).toContain(element.id);
        const last = element.points[element.points.length - 1];
        expect([element.x + last[0], element.y + last[1]]).toEqual([x, y]);
      }

      // over the rectangle an arrow gets a binding suggestion each move
      for (const [x, y] of [
        [450, 450],
        [455, 460],
      ]) {
        mouse.moveTo(x, y);
        expect(renderStaticScene).not.toHaveBeenCalled();
        expect(takeNewElementPaints()).toContain(element.id);
        expect(h.state.suggestedBinding?.element.id).toBe(
          tool === "arrow" ? rectangle.id : undefined,
        );
      }

      mouse.upAt(455, 460);
      expect(renderStaticScene).toHaveBeenCalled();
      expect(h.elements.map((e) => e.id)).toContain(element.id);
    },
  );
});
