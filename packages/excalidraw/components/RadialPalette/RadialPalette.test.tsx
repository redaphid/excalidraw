import fs from "node:fs";
import path from "node:path";

import { fireEvent, queryByTestId } from "@testing-library/react";

import { KEYS } from "@excalidraw/common";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../../tests/helpers/ui";
import { GlobalTestState, act, render } from "../../tests/test-utils";

import { LONG_PRESS_DELAY } from "../App.radialPalette";

import { getPenPresets } from "./penPresets";
import { RADIAL_TOOLS } from "./radialPaletteController";
import {
  TOOLS_BAND,
  RING_RADIUS,
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

/** the ring's size against its own, from its box */
const ringScale = () => parseFloat(ring()!.style.width) / (RING_RADIUS * 2);

const ringBox = () => {
  const { left, top, width } = ring()!.style;
  return {
    left: parseFloat(left),
    top: parseFloat(top),
    size: parseFloat(width),
  };
};

/** the corner handle's centre: it sits 22px inside the ring's box corner */
const scaleHandleCenter = () => {
  const { left, top, size } = ringBox();
  const handle = byTestId("radial-palette-scale")!;
  const onLeft = handle.classList.contains("RadialPalette__scale--left");
  const onTop = handle.classList.contains("RadialPalette__scale--top");
  return {
    x: onLeft ? left + 22 : left + size - 22,
    y: onTop ? top + 22 : top + size - 22,
    anchor: { x: onLeft ? left + size : left, y: onTop ? top + size : top },
  };
};

/** presses the corner handle at its centre and moves it as far as the
 * ring's corner moves when it is `scale` big, its opposite corner held;
 * lifts it unless told not to */
const dragScaleHandle = (scale: number, { lift = true } = {}) => {
  const from = scaleHandleCenter();
  const way = {
    x: Math.sign(from.x - from.anchor.x),
    y: Math.sign(from.y - from.anchor.y),
  };
  const by = RING_RADIUS * 2 * (scale - ringScale());
  const to = { clientX: from.x + way.x * by, clientY: from.y + way.y * by };
  fireEvent.pointerDown(byTestId("radial-palette-scale")!, {
    pointerId: 7,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(window, { pointerId: 7, ...to });
  if (lift) {
    fireEvent.pointerUp(window, { pointerId: 7, ...to });
  }
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
      await render(<Excalidraw css={PARCHMENT} />);
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

      describe.each([
        [KEYS.R, "rectangle"],
        [KEYS.O, "ellipse"],
        [KEYS.A, "arrow"],
        [KEYS.P, "freedraw"],
        [KEYS.E, "eraser"],
        [KEYS.H, "hand"],
        ["5", "arrow"],
      ])("when the %s key picks a tool", (key, type) => {
        beforeEach(() => {
          // as on the board: nothing in the editor has focus
          Keyboard.keyPress(key, document.body);
        });

        it("picks it and closes, as a tap on the ring does", () => {
          expect(h.state.activeTool.type).toBe(type);
          expect(ring()).toBeNull();
        });
      });

      describe("when a key that is not a tool's is pressed", () => {
        beforeEach(() => {
          Keyboard.keyPress(KEYS.W, document.body);
        });

        it("stays open", () => {
          expect(ring()).not.toBeNull();
        });
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

      describe("when its corner is dragged outward, as a frame's is", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          dragScaleHandle(1.3);
        });

        afterEach(() => {
          localStorage.clear();
        });

        it("draws the ring bigger", () => {
          expect(ringScale()).toBeCloseTo(1.3);
        });

        describe("when it is opened again", () => {
          beforeEach(() => {
            Keyboard.keyPress(KEYS.ESCAPE);
            openRing();
          });

          it("keeps the size", () => {
            expect(ringScale()).toBeCloseTo(1.3);
          });
        });
      });

      describe("when its corner is dragged into the middle", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          dragScaleHandle(0.2);
        });

        afterEach(() => {
          localStorage.clear();
        });

        it("folds the ring back into the puck", () => {
          expect(ring()).toBeNull();
        });
      });

      describe("when it is opened in the middle and its corner dragged outward", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          Keyboard.keyPress(KEYS.ESCAPE);
          act(() => h.app.radialPalette.api.open({ at: { x: 400, y: 300 } }));
          dragScaleHandle(1.3);
        });

        afterEach(() => {
          localStorage.clear();
        });

        it("holds the opposite corner where it was, as a frame does", () => {
          const { left, top } = ringBox();
          expect({ left: Math.round(left), top: Math.round(top) }).toEqual({
            left: 242,
            top: 142,
          });
        });
      });

      describe("when it is opened against the lower right", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          Keyboard.keyPress(KEYS.ESCAPE);
          act(() => h.app.radialPalette.api.open({ at: { x: 900, y: 700 } }));
        });

        it("puts its corner on the top left, where there is room", () => {
          const { classList } = byTestId("radial-palette-scale")!;
          expect([
            classList.contains("RadialPalette__scale--left"),
            classList.contains("RadialPalette__scale--top"),
          ]).toEqual([true, true]);
        });
      });

      describe("when its corner is pressed and moved by a pixel", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          const from = scaleHandleCenter();
          fireEvent.pointerDown(byTestId("radial-palette-scale")!, {
            pointerId: 7,
            clientX: from.x,
            clientY: from.y,
          });
          fireEvent.pointerMove(window, {
            pointerId: 7,
            clientX: from.x + 1,
            clientY: from.y,
          });
        });

        afterEach(() => {
          fireEvent.pointerUp(window, { pointerId: 7 });
          localStorage.clear();
        });

        it("keeps the ring its size, as a grab is no resize", () => {
          expect(ringScale()).toBeCloseTo(1, 2);
        });
      });

      describe("when its corner is held in far enough to fold it", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          dragScaleHandle(0.2, { lift: false });
        });

        afterEach(() => {
          fireEvent.pointerUp(window, { pointerId: 7 });
          localStorage.clear();
        });

        it("shows it will fold before it is let go", () => {
          expect(ring()!.classList).toContain("RadialPalette--folding");
        });
      });

      describe("when Escape closes it while its corner is held", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          dragScaleHandle(1.3, { lift: false });
          Keyboard.keyPress(KEYS.ESCAPE);
          fireEvent.pointerUp(window, { pointerId: 7 });
          openRing();
        });

        afterEach(() => {
          localStorage.clear();
        });

        it("keeps the size it had, not the one held", () => {
          expect(ringScale()).toBeCloseTo(1);
        });
      });

      describe("when its corner is focused and + is pressed", () => {
        beforeEach(() => {
          API.setAppState({ width: 1000, height: 800 });
          byTestId("radial-palette-scale")!.focus();
          fireEvent.keyDown(byTestId("radial-palette-scale")!, { key: "+" });
        });

        afterEach(() => {
          localStorage.clear();
        });

        it("draws the ring a step bigger", () => {
          expect(ringScale()).toBeCloseTo(1.1);
        });
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
          // a tool picked elsewhere closes the ring: open it again on it
          act(() => h.app.setActiveTool({ type: "ellipse", locked: true }));
          openRing();
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

      describe.each([
        ["the right button", { button: 2, buttons: 2 }],
        [
          "a pen's barrel button",
          { button: 2, buttons: 2, pointerType: "pen" },
        ],
        ["the middle button", { button: 1, buttons: 4 }],
      ])("when a tool is held with %s", (_, init) => {
        let before: typeof h.state.activeTool;

        beforeEach(() => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          before = h.state.activeTool;
          fireEvent.pointerDown(byTestId("radial-tool-rectangle")!, init);
          act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY * 2);
          });
        });

        afterEach(() => {
          vi.useRealTimers();
        });

        it("picks nothing: only the main button picks", () => {
          expect(h.state.activeTool).toEqual(before);
          expect(ring()).not.toBeNull();
        });
      });

      describe.each([
        ["the right button", { button: 2, buttons: 2 }],
        [
          "a pen's barrel button",
          { button: 2, buttons: 2, pointerType: "pen" },
        ],
      ])("when the canvas off the ring is clicked with %s", (_, init) => {
        beforeEach(() => {
          const at = { ...init, clientX: 5, clientY: 5 };
          fireEvent.pointerDown(byTestId("radial-palette-backdrop")!, at);
          // the browser's menu event goes to whatever is under the pointer
          // by then: the canvas, once the backdrop is gone
          fireEvent.contextMenu(
            byTestId("radial-palette-backdrop") ??
              GlobalTestState.interactiveCanvas,
            at,
          );
          fireEvent.pointerUp(window, { ...at, buttons: 0 });
        });

        it("closes the ring", () => {
          expect(ring()).toBeNull();
        });

        it("opens no context menu: one click, one menu closed", () => {
          expect(h.state.contextMenu).toBeNull();
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

    describe("when a pressed colour slice is picked", () => {
      beforeEach(() => {
        const rectangle = API.createElement({ type: "rectangle" });
        API.setElements([rectangle]);
        API.setSelectedElements([rectangle]);
        openRing();
        // a press on a slice focuses it, as a browser does
        (byTestId("radial-color-1") as unknown as HTMLElement).focus();
        tap("radial-color-1");
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
      });

      it("gives focus back to the editor, so Ctrl+Z works at once", () => {
        expect(document.activeElement).toBe(
          document.querySelector("[data-excalidraw-id]"),
        );
      });
    });

    describe("when a pressed tool slice is picked", () => {
      beforeEach(() => {
        openRing();
        (byTestId("radial-tool-rectangle") as unknown as HTMLElement).focus();
        tap("radial-tool-rectangle");
      });

      it("gives focus back to the editor", () => {
        expect(document.activeElement).toBe(
          document.querySelector("[data-excalidraw-id]"),
        );
      });
    });

    describe("when the ring closes while a host's field has focus", () => {
      let field: HTMLInputElement;

      beforeEach(() => {
        field = document.createElement("input");
        document.body.append(field);
        openRing();
        field.focus();
        act(() => {
          h.app.radialPalette.api.close();
        });
      });

      afterEach(() => {
        field.remove();
      });

      it("leaves focus in the field", () => {
        expect(document.activeElement).toBe(field);
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

    describe("when a host opens it for a pointer still down, which slides to the rectangle and lifts", () => {
      beforeEach(() => {
        API.setAppState({ width: 1000, height: 800 });
        const tip = { x: 500, y: 400 };
        act(() => {
          h.app.radialPalette.api.open({ at: tip, pointerId: 7 });
        });
        const layout = getRingLayout({
          tools: RADIAL_TOOLS.length,
          pens: getPenPresets(h.app.cssTheme).length + 1,
          colors: 12,
        });
        const center = placeRing(tip, {
          width: h.state.width,
          height: h.state.height,
        });
        const target = polar(
          (TOOLS_BAND.inner + TOOLS_BAND.outer) / 2,
          sectorMiddle(layout.tools[RADIAL_TOOLS.indexOf("rectangle")]),
        );
        const at = {
          pointerId: 7,
          clientX: center.x + target.x * center.scale,
          clientY: center.y + target.y * center.scale,
        };
        fireEvent.pointerMove(window, at);
        fireEvent.pointerUp(window, at);
      });

      it("picks the rectangle", () => {
        expect(h.state.activeTool.type).toBe("rectangle");
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
      });
    });

    describe("when a host opens it with no pointer down and a pointer lifts over the rectangle", () => {
      beforeEach(() => {
        API.setAppState({ width: 1000, height: 800 });
        act(() => {
          h.app.radialPalette.api.open({ at: { x: 500, y: 400 } });
        });
        fireEvent.pointerMove(window, { pointerId: 7, clientX: 560, clientY: 300 });
        fireEvent.pointerUp(window, { pointerId: 7, clientX: 560, clientY: 300 });
      });

      it("stays open", () => {
        expect(ring()).not.toBeNull();
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
