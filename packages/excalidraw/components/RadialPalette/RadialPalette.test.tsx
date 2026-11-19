import fs from "node:fs";
import path from "node:path";

import { fireEvent, queryByTestId } from "@testing-library/react";

import { KEYS } from "@excalidraw/common";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { Keyboard, UI } from "../../tests/helpers/ui";
import { act, render } from "../../tests/test-utils";

import { getPenPresets } from "./penPresets";
import {
  TOOLS_BAND,
  getRingLayout,
  placeRing,
  polar,
  sectorMiddle,
} from "./radialLayout";

import type { PenPresetId } from "./penPresets";

const { h } = window;

const PARCHMENT = fs.readFileSync(
  path.resolve(__dirname, "../../themes/architect-parchment.css"),
  "utf8",
);

const byTestId = (id: string) => queryByTestId(document.body, id);

const ring = () => byTestId("radial-palette");

const puck = () => byTestId("radial-palette-puck")!;

const openRing = () => {
  fireEvent.pointerDown(puck(), { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
};

const tap = (testId: string) => {
  const target = byTestId(testId);
  if (!target) {
    throw new Error(`no ${testId} on the ring`);
  }
  fireEvent.click(target);
};

const drawStroke = () => {
  UI.createElement("freedraw", { x: 10, y: 10, width: 40, height: 30 });
  return h.elements[h.elements.length - 1] as ExcalidrawFreeDrawElement;
};

describe("RadialPalette", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  describe("when the host leaves it off", () => {
    beforeEach(async () => {
      await render(<Excalidraw />);
    });

    it("renders no puck", () => {
      expect(byTestId("radial-palette-puck")).toBeNull();
    });
  });

  describe("when the host turns it on", () => {
    beforeEach(async () => {
      await render(<Excalidraw radialPalette css={PARCHMENT} />);
    });

    it("renders the puck alone while closed", () => {
      expect(puck()).not.toBeNull();
      expect(ring()).toBeNull();
    });

    describe("when the puck is pressed", () => {
      beforeEach(() => {
        openRing();
      });

      it("opens the ring", () => {
        expect(ring()).not.toBeNull();
      });

      it("keeps it open after a tap, for the next tap", () => {
        expect(puck().getAttribute("aria-expanded")).toBe("true");
      });

      it("closes on the hub", () => {
        tap("radial-palette-close");
        expect(ring()).toBeNull();
      });

      it("closes on a press outside it", () => {
        fireEvent.pointerDown(byTestId("radial-palette-backdrop")!);
        expect(ring()).toBeNull();
      });

      it("closes on Escape", () => {
        Keyboard.keyPress(KEYS.ESCAPE);
        expect(ring()).toBeNull();
      });

      it.each([
        "rectangle",
        "diamond",
        "ellipse",
        "arrow",
        "line",
        "text",
        "stickynote",
        "frame",
        "eraser",
      ] as const)("picks the %s tool and closes", (type) => {
        tap(`radial-tool-${type}`);
        expect(h.state.activeTool.type).toBe(type);
        expect(ring()).toBeNull();
      });
    });

    describe.each<[PenPresetId, Partial<ExcalidrawFreeDrawElement>]>([
      [
        "liner",
        {
          opacity: 100,
          strokeWidth: 0.2,
          strokeOptions: expect.objectContaining({
            variability: "variable",
            thinning: 0.2,
            taper: 4,
          }),
        },
      ],
      [
        "pencil",
        {
          opacity: 70,
          strokeWidth: 0.2 * 1.5,
          strokeOptions: {
            variability: "variable",
            thinning: 0.35,
            taper: 2,
            streamline: 0.15,
          },
        },
      ],
      [
        "brush",
        {
          opacity: 100,
          strokeWidth: 0.2 * 5,
          strokeOptions: {
            variability: "variable",
            thinning: 0.8,
            taper: 10,
            streamline: 0.5,
          },
        },
      ],
      [
        "marker",
        {
          opacity: 85,
          strokeWidth: 0.2 * 8,
          strokeOptions: expect.objectContaining({
            variability: "constant",
            streamline: 0.6,
          }),
        },
      ],
      [
        "wash",
        {
          opacity: 25,
          strokeWidth: 4,
          strokeOptions: expect.objectContaining({
            variability: "constant",
            streamline: 0.75,
          }),
        },
      ],
    ])("when the %s pen is picked", (id, expected) => {
      beforeEach(() => {
        openRing();
        tap(`radial-pen-${id}`);
      });

      it("takes the pen tool", () => {
        expect(h.state.activeTool.type).toBe("freedraw");
      });

      it("draws a stroke with the pen's look", () => {
        const stroke = drawStroke();
        expect({
          opacity: stroke.opacity,
          strokeOptions: stroke.strokeOptions,
        }).toEqual({
          opacity: expected.opacity,
          strokeOptions: expected.strokeOptions,
        });
        expect(stroke.strokeWidth).toBeCloseTo(expected.strokeWidth!, 9);
      });
    });

    describe("when a diagram tool follows the wash", () => {
      beforeEach(() => {
        openRing();
        tap("radial-pen-wash");
        openRing();
        tap("radial-tool-rectangle");
      });

      it("draws shapes fully opaque again", () => {
        expect(h.state.currentItemOpacity).toBe(100);
      });
    });

    describe("when a role is picked with a rectangle selected", () => {
      let undoDepth: number;

      beforeEach(() => {
        const rectangle = API.createElement({ type: "rectangle" });
        API.setElements([rectangle]);
        API.setSelectedElements([rectangle]);
        undoDepth = API.getUndoStack().length;
        openRing();
        tap("radial-role-error");
      });

      it("gives it the role's stroke, paper and line", () => {
        expect(h.elements[0]).toMatchObject({
          strokeColor: "#9e3a33",
          backgroundColor: "#ebe4d6",
          fillStyle: "solid",
          strokeStyle: "solid",
        });
      });

      it("gives new shapes the role too", () => {
        expect({
          stroke: h.state.currentItemStrokeColor,
          background: h.state.currentItemBackgroundColor,
        }).toEqual({ stroke: "#9e3a33", background: "#ebe4d6" });
      });

      it("takes one undo step", () => {
        expect(API.getUndoStack().length).toBe(undoDepth + 1);
      });
    });

    describe("when the assumed role is picked", () => {
      beforeEach(() => {
        openRing();
        tap("radial-role-assumed");
      });

      it("draws new shapes in dashed ink", () => {
        expect({
          stroke: h.state.currentItemStrokeColor,
          line: h.state.currentItemStrokeStyle,
        }).toEqual({ stroke: "#1b2129", line: "dashed" });
      });
    });

    describe("when a color is picked", () => {
      beforeEach(() => {
        openRing();
        tap("radial-color-1");
      });

      it("inks new elements with it", () => {
        expect(h.state.currentItemStrokeColor).toBe("#9e3a33");
      });
    });

    describe("when the ring opens on a color the theme lacks", () => {
      beforeEach(() => {
        API.setAppState({ currentItemStrokeColor: "#123456" });
        openRing();
      });

      it("offers it as a recent color", () => {
        expect(byTestId("radial-color-9")?.getAttribute("aria-label")).toBe(
          "#123456",
        );
      });
    });

    describe("when the opacity arc is stepped down from the keyboard", () => {
      beforeEach(() => {
        openRing();
        fireEvent.keyDown(byTestId("radial-opacity")!, {
          key: KEYS.ARROW_DOWN,
        });
      });

      it("lowers the opacity of new elements", () => {
        expect(h.state.currentItemOpacity).toBe(95);
      });
    });

    describe("when the puck is flicked to the rectangle", () => {
      beforeEach(() => {
        API.setAppState({ width: 1000, height: 800 });
        const layout = getRingLayout({
          tools: 9,
          pens: getPenPresets(h.app.cssTheme).length + 1,
          roles: 7,
          colors: 12,
        });
        const center = placeRing(
          { x: 0, y: 0 },
          { width: h.state.width, height: h.state.height },
        );
        const target = polar(
          (TOOLS_BAND.inner + TOOLS_BAND.outer) / 2,
          sectorMiddle(layout.tools[1]),
        );
        const at = {
          pointerId: 1,
          clientX: center.x + target.x * center.scale,
          clientY: center.y + target.y * center.scale,
        };
        fireEvent.pointerDown(puck(), {
          button: 0,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
        });
        fireEvent.pointerMove(window, at);
        fireEvent.pointerUp(window, at);
      });

      it("picks the rectangle on lift", () => {
        expect(h.state.activeTool.type).toBe("rectangle");
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
      });
    });

    describe("when W is pressed", () => {
      beforeEach(() => {
        Keyboard.keyPress(KEYS.W);
      });

      it("opens the ring", () => {
        expect(ring()).not.toBeNull();
      });
    });
  });
});
