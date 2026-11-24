import fs from "node:fs";
import path from "node:path";

import { fireEvent, queryByTestId } from "@testing-library/react";

import { KEYS } from "@excalidraw/common";

import type {
  ExcalidrawFreeDrawElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../../tests/helpers/ui";
import { act, render } from "../../tests/test-utils";

import { LONG_PRESS_DELAY } from "../App.radialPalette";

import { getPenPresets } from "./penPresets";
import { RADIAL_TOOLS } from "./radialPaletteController";
import {
  TOOLS_BAND,
  getRingLayout,
  placeRing,
  polar,
  sectorMiddle,
  FLICK_DISTANCE,
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

/** a host's icon given as a component, not a bare svg */
const HostMark = () => <svg data-testid="host-pen-icon-marked" />;

describe("RadialPalette", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  describe("when the host adds pens of its own", () => {
    const onPick = vi.fn();
    const doodleLeft = vi.fn();
    const sketchyLeft = vi.fn();

    beforeEach(async () => {
      onPick.mockReset();
      doodleLeft.mockReset();
      sketchyLeft.mockReset();
      await render(
        <Excalidraw
          radialPalette={{
            pens: [
              {
                id: "doodle",
                label: "Doodle",
                icon: <svg data-testid="host-pen-icon-doodle" />,
                onPick,
                onLeave: doodleLeft,
              },
              {
                id: "sketchy",
                label: "Sketchy",
                icon: <svg />,
                active: true,
                onPick: () => {},
                onLeave: sketchyLeft,
              },
              {
                id: "marked",
                label: "Marked",
                icon: <HostMark />,
                onPick: () => {},
              },
            ],
          }}
        />,
      );
      openRing();
    });

    it("draws a component's icon in its segment, as a bare svg's", () => {
      const placed = byTestId("host-pen-icon-marked")!.closest(
        ".RadialPalette__icon",
      );
      expect(placed?.getAttribute("width")).toBe("18");
    });

    it("draws them after the presets and before the eraser", () => {
      const ids = Array.from(
        ring()!.querySelectorAll("[data-testid]"),
        (node) => node.getAttribute("data-testid"),
      ).filter(
        (id) => id?.startsWith("radial-pen-") || id === "radial-tool-eraser",
      );
      expect(ids).toEqual([
        ...h.app.radialPalette.getPresets().map(({ id }) => `radial-pen-${id}`),
        "radial-pen-host-doodle",
        "radial-pen-host-sketchy",
        "radial-pen-host-marked",
        "radial-tool-eraser",
      ]);
    });

    it("highlights the one the host says is active", () => {
      expect(
        byTestId("radial-pen-host-sketchy")!.getAttribute("aria-pressed"),
      ).toBe("true");
    });

    describe("when one is picked", () => {
      beforeEach(() => {
        tap("radial-pen-host-doodle");
      });

      it("calls its onPick", () => {
        expect(onPick).toHaveBeenCalledTimes(1);
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
      });

      it("leaves the active one", () => {
        expect(sketchyLeft).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a preset is picked over the active one", () => {
      beforeEach(() => {
        tap(`radial-pen-${h.app.radialPalette.getPresets()[0].id}`);
      });

      it("leaves the active one", () => {
        expect(sketchyLeft).toHaveBeenCalledTimes(1);
      });

      it("leaves no pen that was not active", () => {
        expect(doodleLeft).not.toHaveBeenCalled();
      });
    });

    describe("when the eraser is picked over the active one", () => {
      beforeEach(() => {
        tap("radial-tool-eraser");
      });

      it("leaves the active one", () => {
        expect(sketchyLeft).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a shape is picked over the active one", () => {
      beforeEach(() => {
        tap("radial-tool-rectangle");
      });

      it("leaves the active one", () => {
        expect(sketchyLeft).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a color is picked with one active", () => {
      beforeEach(() => {
        tap("radial-color-0");
      });

      it("keeps it", () => {
        expect(sketchyLeft).not.toHaveBeenCalled();
      });
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

      it("writes every pen's name above its sample stroke, at any angle", () => {
        // an 8px label's half height, and the widest sample's: its curve and
        // half its 12px stroke, and a few pixels between them
        const clearance = 18;
        const crowded = h.app.radialPalette
          .getPresets()
          .map(({ id }) => {
            const segment = byTestId(`radial-pen-${id}`)!;
            const label = segment.querySelector(".RadialPalette__label")!;
            const sample = segment.querySelector(".RadialPalette__sample")!;
            const sampleY = Number(
              /translate\(\S+ (\S+)\)/.exec(
                sample.getAttribute("transform")!,
              )![1],
            );
            return { id, gap: sampleY - Number(label.getAttribute("y")) };
          })
          .filter(({ gap }) => gap < clearance);
        expect(crowded).toEqual([]);
      });

      it("opens the ring", () => {
        expect(ring()).not.toBeNull();
      });

      it("keeps it open after a tap, for the next tap", () => {
        expect(puck().getAttribute("aria-expanded")).toBe("true");
      });

      it("opens the context menu from the hub, in place of itself", () => {
        tap("radial-palette-menu");
        expect(ring()).toBeNull();
        expect(h.state.contextMenu).not.toBeNull();
      });

      describe("when the hub is tapped with a shape selected away from the ring", () => {
        beforeEach(() => {
          const rectangle = API.createElement({
            type: "rectangle",
            x: 400,
            y: 400,
            width: 40,
            height: 40,
          });
          API.setElements([rectangle]);
          API.setSelectedElements([rectangle]);
          tap("radial-palette-menu");
        });

        it("opens the shape's menu", () => {
          expect(
            UI.queryContextMenu()?.querySelector(
              'li[data-testid="deleteSelectedElements"]',
            ),
          ).not.toBeNull();
        });
      });

      it("offers shapes and pens, and no style roles", () => {
        const ids = Array.from(
          ring()!.querySelectorAll("[data-testid]"),
          (node) => node.getAttribute("data-testid"),
        );
        expect(ids.filter((id) => id?.startsWith("radial-tool-"))).toEqual(
          [...RADIAL_TOOLS, "eraser"].map((type) => `radial-tool-${type}`),
        );
        expect(ids.filter((id) => id?.startsWith("radial-pen-"))).toEqual(
          ["liner", "pencil", "brush", "marker", "wash"].map(
            (id) => `radial-pen-${id}`,
          ),
        );
        expect(
          ids.some((id) =>
            /role|danger|service|healthy|assumed|async|-error|-data/.test(id!),
          ),
        ).toBe(false);
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
        "selection",
        "freedraw",
        "rectangle",
        "diamond",
        "ellipse",
        "arrow",
        "line",
        "text",
        "frame",
        "eraser",
      ] as const)("picks the %s tool and closes", (type) => {
        tap(`radial-tool-${type}`);
        expect(h.state.activeTool.type).toBe(type);
        expect(ring()).toBeNull();
      });

      describe("when a tool is locked and another is tapped", () => {
        beforeEach(() => {
          act(() => h.app.setActiveTool({ type: "ellipse", locked: true }));
          tap("radial-tool-rectangle");
        });

        it("picks it unlocked", () => {
          expect(h.state.activeTool.locked).toBe(false);
        });
      });

      describe("when a tool is held", () => {
        beforeEach(() => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          fireEvent.pointerDown(byTestId("radial-tool-rectangle")!, {
            button: 0,
          });
          act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY);
          });
        });

        afterEach(() => {
          vi.useRealTimers();
        });

        it("picks it locked, as Q does", () => {
          expect(h.state.activeTool).toMatchObject({
            type: "rectangle",
            locked: true,
          });
        });
      });

      describe("when a held tool drifts past the flick distance", () => {
        beforeEach(() => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          const slice = byTestId("radial-tool-rectangle")!;
          fireEvent.pointerDown(slice, {
            button: 0,
            clientX: 100,
            clientY: 100,
          });
          fireEvent.pointerMove(slice, {
            clientX: 100 + FLICK_DISTANCE + 1,
            clientY: 100,
          });
          act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY);
          });
        });

        afterEach(() => {
          vi.useRealTimers();
        });

        it("cancels the hold", () => {
          expect(h.state.activeTool.locked).toBe(false);
        });
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

    describe("when a color is picked", () => {
      beforeEach(() => {
        openRing();
        tap("radial-color-1");
      });

      it("inks new elements with it", () => {
        expect(h.state.currentItemStrokeColor).toBe("#9e3a33");
      });
    });

    describe("when the colors arc is flipped to fill and a color is picked", () => {
      beforeEach(() => {
        const rectangle = API.createElement({
          type: "rectangle",
          strokeColor: "#1e1e1e",
          backgroundColor: "transparent",
        });
        API.setElements([rectangle]);
        API.setSelectedElements([rectangle]);
        openRing();
        tap("radial-color-fill");
        tap("radial-color-1");
      });

      it("fills the selected rectangle with it", () => {
        expect(h.elements[0].backgroundColor).toBe("#9e3a33");
      });

      it("leaves the rectangle's stroke alone", () => {
        expect(h.elements[0].strokeColor).toBe("#1e1e1e");
      });
    });

    describe("when the style ring opens on a selected rectangle and dashed is picked", () => {
      beforeEach(() => {
        const rectangle = API.createElement({
          type: "rectangle",
          strokeStyle: "solid",
        });
        API.setElements([rectangle]);
        API.setSelectedElements([rectangle]);
        act(() => {
          h.app.radialPalette.api.open({ ring: "style" });
        });
        tap("radial-style-strokeStyle");
        tap("radial-style-option-1");
      });

      it("dashes the rectangle", () => {
        expect(h.elements[0].strokeStyle).toBe("dashed");
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
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

    describe("when a stroke is selected", () => {
      let drawn = 0;
      beforeEach(() => {
        // drawn, not set, so history holds the stroke as it was
        API.setAppState({ currentItemFreedrawStrokeWidth: 0.2 });
        const stroke = drawStroke();
        API.setSelectedElements([stroke as NonDeleted<typeof stroke>]);
        drawn = stroke.strokeWidth;
        openRing();
      });

      const width = () => h.elements[0].strokeWidth;

      describe("when the size arc is dragged", () => {
        beforeEach(() => {
          const svg = ring()!.querySelector("svg")!;
          // the test DOM knows no pointer 1 to capture
          Object.defineProperty(svg, "setPointerCapture", { value: () => {} });
          const { left, top, width, height } = ring()!.style;
          const center = {
            x: parseFloat(left) + parseFloat(width) / 2,
            y: parseFloat(top) + parseFloat(height) / 2,
          };
          // straight left of the center: past the arc's thick end, so the
          // size clamps to its largest
          const thick = { clientX: center.x - 300, clientY: center.y };
          fireEvent.pointerDown(byTestId("radial-size")!, {
            pointerId: 1,
            ...thick,
          });
          fireEvent.pointerMove(svg, { pointerId: 1, ...thick });
          fireEvent.pointerUp(svg, { pointerId: 1, ...thick });
        });

        it("moves the pen size", () => {
          expect(h.state.currentItemFreedrawStrokeWidth).toBeGreaterThan(0.2);
        });

        it("gives the selected stroke the new width", () => {
          expect(width()).toBe(h.state.currentItemFreedrawStrokeWidth);
        });

        it("is one undo step", () => {
          expect(width()).not.toBe(drawn);
          // in the editor, as this host takes no keys from the page
          Keyboard.withModifierKeys({ ctrl: true }, () => {
            Keyboard.keyPress(
              KEYS.Z,
              document.querySelector<HTMLElement>(".excalidraw-container")!,
            );
          });
          expect(width()).toBe(drawn);
        });
      });

      describe("when the size arc is stepped up from the keyboard", () => {
        beforeEach(() => {
          fireEvent.keyDown(byTestId("radial-size")!, {
            key: KEYS.ARROW_UP,
          });
        });

        it("widens the selected stroke", () => {
          expect(width()).not.toBe(drawn);
          expect(width()).toBe(h.state.currentItemFreedrawStrokeWidth);
        });
      });
    });

    describe("when the puck is flicked to the rectangle", () => {
      beforeEach(() => {
        API.setAppState({ width: 1000, height: 800 });
        const layout = getRingLayout({
          tools: RADIAL_TOOLS.length,
          pens: getPenPresets(h.app.cssTheme).length + 1,
          colors: 12,
        });
        const center = placeRing(
          { x: 0, y: 0 },
          { width: h.state.width, height: h.state.height },
        );
        const target = polar(
          (TOOLS_BAND.inner + TOOLS_BAND.outer) / 2,
          sectorMiddle(layout.tools[RADIAL_TOOLS.indexOf("rectangle")]),
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
        // the ring opens once the pointer leaves the puck
        fireEvent.pointerMove(window, {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
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

    describe("when , is pressed with the pointer over the canvas", () => {
      beforeEach(() => {
        API.setAppState({ width: 1000, height: 800 });
        new Pointer("mouse").moveTo(400, 300);
        Keyboard.keyPress(KEYS.COMMA);
      });

      it("opens the ring centered on the pointer", () => {
        const { left, top, width, height } = ring()!.style;
        expect({
          x: parseFloat(left) + parseFloat(width) / 2,
          y: parseFloat(top) + parseFloat(height) / 2,
        }).toEqual({ x: 400, y: 300 });
      });

      it("closes it when pressed again", () => {
        Keyboard.keyPress(KEYS.COMMA);
        expect(ring()).toBeNull();
      });
    });

    describe("when , is pressed before the pointer has moved", () => {
      beforeEach(() => {
        API.setAppState({ width: 1000, height: 800 });
        h.app.lastPointerMoveEvent = null;
        Keyboard.keyPress(KEYS.COMMA);
      });

      it("opens the ring in the middle of the editor", () => {
        const { left, top, width, height } = ring()!.style;
        expect({
          x: parseFloat(left) + parseFloat(width) / 2,
          y: parseFloat(top) + parseFloat(height) / 2,
        }).toEqual({ x: 500, y: 400 });
      });
    });

    describe("when , is held down and repeats", () => {
      it("opens the ring once and keeps it open", () => {
        Keyboard.keyPress(KEYS.COMMA);
        fireEvent.keyDown(document, { key: KEYS.COMMA, repeat: true });
        expect(ring()).not.toBeNull();
      });
    });

    describe("when , is typed outside the editor", () => {
      let field: HTMLElement;

      afterEach(() => field.remove());

      it.each([
        ["into a contenteditable", "div", true],
        ["on a host's button", "button", false],
      ] as const)("%s, it leaves the ring shut", (_, tag, editable) => {
        field = document.createElement(tag);
        if (editable) {
          field.contentEditable = "true";
        }
        document.body.appendChild(field);
        fireEvent.keyDown(field, { key: KEYS.COMMA });
        expect(ring()).toBeNull();
      });
    });

    describe("when the ring is open and the user types in a field", () => {
      let field: HTMLInputElement;

      beforeEach(() => {
        Keyboard.keyPress(KEYS.COMMA);
        field = document.createElement("input");
        document.body.appendChild(field);
      });

      afterEach(() => field.remove());

      it("leaves Enter and the arrows to the field", () => {
        const before = h.app.radialPalette.api.state();
        expect(fireEvent.keyDown(field, { key: KEYS.ARROW_RIGHT })).toBe(true);
        expect(fireEvent.keyDown(field, { key: KEYS.ENTER })).toBe(true);
        expect(h.app.radialPalette.api.state()).toEqual(before);
      });
    });

    describe("when W is pressed", () => {
      beforeEach(() => {
        Keyboard.keyPress(KEYS.W);
      });

      it("leaves the ring shut: W is not the palette's key", () => {
        expect(ring()).toBeNull();
      });
    });
  });
});
