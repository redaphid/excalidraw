import { fireEvent, queryByTestId } from "@testing-library/react";

import { pointFrom } from "@excalidraw/math";

import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { GlobalTestState, act, render } from "../../tests/test-utils";
import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "../App.radialPalette";

import {
  TOOLS_BAND,
  getRingLayout,
  placeRing,
  polar,
  sectorMiddle,
} from "./radialLayout";
import { RADIAL_TOOLS } from "./radialPaletteController";
import { getPenPresets } from "./penPresets";

import type { ToolType } from "../../types";

const { h } = window;

const ring = () => queryByTestId(document.body, "radial-palette");

const canvas = () => GlobalTestState.interactiveCanvas;

type Init = {
  pointerId?: number;
  pointerType?: "touch" | "pen" | "mouse";
  button?: number;
  buttons?: number;
};

const down = (x: number, y: number, init: Init = {}) =>
  fireEvent.pointerDown(canvas(), {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    ...init,
  });

const move = (x: number, y: number, init: Init = {}) =>
  fireEvent.pointerMove(canvas(), {
    pointerId: 1,
    pointerType: "touch",
    buttons: 1,
    clientX: x,
    clientY: y,
    ...init,
  });

const up = (x: number, y: number, init: Init = {}) =>
  fireEvent.pointerUp(canvas(), {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    buttons: 0,
    clientX: x,
    clientY: y,
    ...init,
  });

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const ringCenter = () => {
  const { left, top, width, height } = ring()!.style;
  return {
    x: parseFloat(left) + parseFloat(width) / 2,
    y: parseFloat(top) + parseFloat(height) / 2,
  };
};

describe("opening the radial palette from the canvas", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(async () => {
    // the editor tracks pointers across renders: lift every one a test left
    // down, or the next test starts mid-pinch
    if (h.app) {
      for (const pointerId of [1, 2, 7]) {
        up(0, 0, { pointerId });
      }
    }
    vi.useRealTimers();
    await act(async () => {});
  });

  describe("with the palette on", () => {
    beforeEach(async () => {
      await render(<Excalidraw />);
      API.setAppState({ width: 1000, height: 800 });
    });

    describe("when a finger holds still", () => {
      beforeEach(() => {
        down(400, 300);
      });

      it("waits the long-press time before opening", () => {
        wait(LONG_PRESS_DELAY - 1);
        expect(ring()).toBeNull();
        wait(1);
        expect(ring()).not.toBeNull();
      });

      it("opens the ring under the finger", () => {
        wait(LONG_PRESS_DELAY);
        expect(ringCenter()).toEqual({ x: 400, y: 300 });
      });

      it("opens no context menu", () => {
        wait(LONG_PRESS_DELAY * 2);
        expect(h.state.contextMenu).toBeNull();
      });
    });

    describe("when the finger drifts a little", () => {
      beforeEach(() => {
        down(400, 300);
        move(400 + LONG_PRESS_TOLERANCE - 2, 302);
        wait(LONG_PRESS_DELAY);
      });

      it("still opens, where the finger now is", () => {
        expect(ringCenter()).toEqual({
          x: 400 + LONG_PRESS_TOLERANCE - 2,
          y: 302,
        });
      });
    });

    describe("when the finger moves past the tolerance", () => {
      beforeEach(() => {
        down(400, 300);
        move(400 + LONG_PRESS_TOLERANCE + 5, 300);
        wait(LONG_PRESS_DELAY * 2);
      });

      it("does not open: it is a drag", () => {
        expect(ring()).toBeNull();
      });
    });

    describe("when the finger lifts early", () => {
      beforeEach(() => {
        down(400, 300);
        wait(LONG_PRESS_DELAY / 2);
        up(400, 300);
        wait(LONG_PRESS_DELAY);
      });

      it("does not open: it is a tap", () => {
        expect(ring()).toBeNull();
      });
    });

    describe("when a second finger lands", () => {
      beforeEach(() => {
        down(400, 300);
        down(500, 300, { pointerId: 2 });
        wait(LONG_PRESS_DELAY * 2);
      });

      it("does not open: it is a pinch", () => {
        expect(ring()).toBeNull();
      });
    });

    describe.each<ToolType>([
      "selection",
      "freedraw",
      "rectangle",
      "arrow",
      "line",
      "ellipse",
      "text",
    ])("when a long press is made with the %s tool", (type) => {
      let undoDepth: number;

      beforeEach(() => {
        act(() => h.app.setActiveTool({ type }));
        undoDepth = API.getUndoStack().length;
        down(400, 300);
        wait(LONG_PRESS_DELAY);
        // the finger wanders over the ring and lifts on nothing
        move(400, 302);
        up(400, 302);
      });

      it("opens the ring", () => {
        expect(ring()).not.toBeNull();
      });

      it("leaves no element and no undo step behind", () => {
        expect(h.elements.filter((element) => !element.isDeleted)).toEqual([]);
        expect(h.state.newElement).toBeNull();
        expect(h.state.multiElement).toBeNull();
        expect(API.getUndoStack().length).toBe(undoDepth);
      });

      it("keeps the tool", () => {
        expect(h.state.activeTool.type).toBe(type);
      });
    });

    describe("when a long press lands on a selected rectangle", () => {
      beforeEach(() => {
        const rectangle = API.createElement({
          type: "rectangle",
          x: 350,
          y: 250,
          width: 100,
          height: 100,
        });
        API.setElements([rectangle]);
        API.setSelectedElements([rectangle]);
        down(400, 300);
        wait(LONG_PRESS_DELAY);
        up(400, 300);
      });

      it("leaves the rectangle where it was", () => {
        expect(h.elements[0]).toMatchObject({ x: 350, y: 250 });
      });

      it("reaches its context menu through the hub", () => {
        fireEvent.click(queryByTestId(document.body, "radial-palette-menu")!);
        expect(ring()).toBeNull();
        expect(h.state.contextMenu).not.toBeNull();
      });
    });

    describe("when the browser clicks where a long press lifts", () => {
      beforeEach(() => {
        down(400, 300);
        wait(LONG_PRESS_DELAY);
        up(400, 300);
      });

      describe("on the hub", () => {
        beforeEach(() => {
          fireEvent.click(
            queryByTestId(document.body, "radial-palette-menu")!,
            {
              detail: 1,
            },
          );
        });

        it("opens no context menu", () => {
          expect(h.state.contextMenu).toBeNull();
        });

        it("keeps the ring open", () => {
          expect(ring()).not.toBeNull();
        });
      });

      describe("on a slice", () => {
        beforeEach(() => {
          fireEvent.click(
            queryByTestId(document.body, "radial-tool-rectangle")!,
            {
              detail: 1,
            },
          );
        });

        it("picks nothing", () => {
          expect(h.state.activeTool.type).toBe("selection");
        });
      });

      describe("after a fresh press on the hub", () => {
        beforeEach(() => {
          const hub = queryByTestId(document.body, "radial-palette-menu")!;
          fireEvent.pointerDown(hub, { pointerId: 3, pointerType: "touch" });
          fireEvent.pointerUp(hub, { pointerId: 3, pointerType: "touch" });
          fireEvent.click(hub, { detail: 1 });
        });

        it("opens the context menu", () => {
          expect(h.state.contextMenu).not.toBeNull();
        });
      });
    });

    describe("when a finger drifts a little on a rectangle while it holds", () => {
      let undoDepth: number;

      beforeEach(() => {
        const rectangle = API.createElement({
          type: "rectangle",
          x: 350,
          y: 250,
          width: 100,
          height: 100,
        });
        API.setElements([rectangle]);
        API.setSelectedElements([rectangle]);
        undoDepth = API.getUndoStack().length;
        down(400, 300);
        move(404, 303);
        move(406, 304);
        wait(LONG_PRESS_DELAY);
        up(406, 304);
      });

      it("opens the ring", () => {
        expect(ring()).not.toBeNull();
      });

      it("leaves the rectangle where it was, with no undo step", () => {
        expect(h.elements[0]).toMatchObject({ x: 350, y: 250 });
        expect(API.getUndoStack().length).toBe(undoDepth);
      });
    });

    describe("when a long press is made with the eraser on a rectangle", () => {
      beforeEach(() => {
        API.setElements([
          API.createElement({
            type: "rectangle",
            x: 350,
            y: 250,
            width: 100,
            height: 100,
          }),
        ]);
        act(() => h.app.setActiveTool({ type: "eraser" }));
        down(351, 300);
        move(353, 302);
        wait(LONG_PRESS_DELAY);
        up(353, 302);
      });

      it("erases nothing", () => {
        expect(ring()).not.toBeNull();
        expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(
          1,
        );
      });
    });

    describe("when the finger rolls a little as it lifts after a long press", () => {
      it.each([
        ["in the middle of the editor", 500, 400],
        ["near its left edge, over a slice", 40, 400],
      ])("%s, it picks nothing and leaves the ring open", (_, x, y) => {
        down(x, y);
        wait(LONG_PRESS_DELAY);
        move(x + 8, y + 9);
        up(x + 8, y + 9);
        expect(ring()).not.toBeNull();
        expect(h.state.activeTool.type).toBe("selection");
      });
    });

    describe("when the finger flicks to the rectangle and lifts", () => {
      beforeEach(async () => {
        down(400, 300);
        wait(LONG_PRESS_DELAY);
        const layout = getRingLayout({
          tools: RADIAL_TOOLS.length,
          pens: getPenPresets(h.app.cssTheme).length + 1,
          colors: 12,
        });
        const center = placeRing(
          { x: 400, y: 300 },
          { width: h.state.width, height: h.state.height },
        );
        const target = polar(
          (TOOLS_BAND.inner + TOOLS_BAND.outer) / 2,
          sectorMiddle(layout.tools[RADIAL_TOOLS.indexOf("rectangle")]),
        );
        const x = center.x + target.x * center.scale;
        const y = center.y + target.y * center.scale;
        move(x, y);
        up(x, y);
        // the pick comes from a window listener; let React apply it
        await act(async () => {});
      });

      it("picks it and closes", () => {
        expect(h.state.activeTool.type).toBe("rectangle");
        expect(ring()).toBeNull();
      });
    });

    describe("when the browser's own long-press menu event comes first", () => {
      beforeEach(() => {
        down(400, 300);
        wait(LONG_PRESS_DELAY / 2);
        fireEvent.contextMenu(canvas(), {
          pointerType: "touch",
          clientX: 400,
          clientY: 300,
        });
      });

      it("opens the ring at once, and no context menu", () => {
        expect(ring()).not.toBeNull();
        expect(h.state.contextMenu).toBeNull();
      });
    });

    describe("when a pen touches down with its barrel button held", () => {
      beforeEach(() => {
        act(() => h.app.setActiveTool({ type: "freedraw" }));
        down(250, 200, {
          pointerType: "pen",
          pointerId: 7,
          button: 2,
          buttons: 2,
        });
      });

      it("opens the ring at the pen tip, at once", () => {
        expect(ringCenter()).toEqual({ x: 250, y: 200 });
      });

      it("draws nothing and pans nothing", () => {
        expect(h.elements).toEqual([]);
        expect(h.app.pan.isActive()).toBe(false);
      });
    });

    describe("when a pen's barrel button is pressed mid-stroke", () => {
      const pen = { pointerType: "pen", pointerId: 7 } as const;
      let undoDepth: number;

      beforeEach(() => {
        act(() => h.app.setActiveTool({ type: "freedraw" }));
        undoDepth = API.getUndoStack().length;
        down(250, 200, { ...pen, buttons: 1 });
        move(270, 210, { ...pen, buttons: 1 });
        move(290, 220, { ...pen, buttons: 1 });
        // the barrel goes down
        move(290, 220, { ...pen, buttons: 3 });
      });

      it("opens the ring", () => {
        expect(ring()).not.toBeNull();
      });

      it("keeps the stroke drawn so far, without the flick after it", () => {
        move(400, 400, { ...pen, buttons: 3 });
        up(400, 400, { ...pen, buttons: 0 });
        const strokes = h.elements.filter((element) => !element.isDeleted);
        expect(strokes).toHaveLength(1);
        const [stroke] = strokes;
        expect(stroke.type).toBe("freedraw");
        expect(stroke.x + stroke.width).toBeLessThanOrEqual(291);
        expect(stroke.y + stroke.height).toBeLessThanOrEqual(221);
        expect(API.getUndoStack().length).toBe(undoDepth + 1);
      });
    });

    describe("when a finger draws a short stroke and lifts early", () => {
      beforeEach(() => {
        act(() => h.app.setActiveTool({ type: "freedraw" }));
        down(400, 300);
        move(402, 301);
        move(404, 303);
        move(406, 306);
        up(406, 306);
      });

      it("keeps every point the finger drew", () => {
        const [stroke] = h.elements;
        expect(stroke.type).toBe("freedraw");
        expect(
          (stroke as ExcalidrawFreeDrawElement).points.length,
        ).toBeGreaterThanOrEqual(4);
        expect(ring()).toBeNull();
      });
    });

    describe("when a long press lands while a line is being built", () => {
      beforeEach(() => {
        act(() => h.app.setActiveTool({ type: "line" }));
        // a click starts a line, and a second adds a point to it
        down(100, 100, { pointerType: "mouse" });
        up(100, 100, { pointerType: "mouse" });
        move(200, 100, { pointerType: "mouse", buttons: 0 });
        down(200, 100, { pointerType: "mouse" });
        up(200, 100, { pointerType: "mouse" });
        move(300, 200, { pointerType: "mouse", buttons: 0 });
        expect(h.state.multiElement).not.toBeNull();
        down(300, 200);
        wait(LONG_PRESS_DELAY);
        up(300, 200);
      });

      it("opens the ring and keeps the line", () => {
        expect(ring()).not.toBeNull();
        const lines = h.elements.filter(
          (element) => !element.isDeleted && element.type === "line",
        );
        expect(lines).toHaveLength(1);
        const points = (lines[0] as ExcalidrawLinearElement).points;
        expect(points.length).toBeGreaterThanOrEqual(2);
        expect(points[1]).toEqual(pointFrom(100, 0));
      });
    });

    describe("when a hovering pen's barrel button is pressed", () => {
      beforeEach(() => {
        move(250, 200, { pointerType: "pen", pointerId: 7, buttons: 0 });
        move(252, 200, { pointerType: "pen", pointerId: 7, buttons: 2 });
      });

      it("opens the ring at the pen", () => {
        expect(ringCenter()).toEqual({ x: 252, y: 200 });
      });
    });

    describe("when a pen's barrel button sends a context menu event", () => {
      beforeEach(() => {
        // Chromium sends a pen's context menu as a PointerEvent
        fireEvent(
          canvas(),
          new window.PointerEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            pointerType: "pen",
            button: 2,
            clientX: 250,
            clientY: 200,
          }),
        );
      });

      it("opens the ring there instead of the context menu", () => {
        expect(ringCenter()).toEqual({ x: 250, y: 200 });
        expect(h.state.contextMenu).toBeNull();
      });
    });

    describe("when a mouse is right-clicked", () => {
      beforeEach(() => {
        fireEvent.contextMenu(canvas(), {
          button: 2,
          clientX: 250,
          clientY: 200,
        });
      });

      it("opens the context menu as before", () => {
        expect(ring()).toBeNull();
        expect(h.state.contextMenu).not.toBeNull();
      });
    });
  });
});
