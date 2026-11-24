import { fireEvent, queryByTestId } from "@testing-library/react";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { GlobalTestState, act, render } from "../../tests/test-utils";
import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "../App.radialPalette";

const { h } = window;

const puck = () => queryByTestId(document.body, "radial-palette-puck")!;

const ring = () => queryByTestId(document.body, "radial-palette");

const hub = () => queryByTestId(document.body, "radial-palette-menu")!;

const backdrop = () => queryByTestId(document.body, "radial-palette-backdrop")!;

const canvas = () => GlobalTestState.interactiveCanvas;

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const touch = (x: number, y: number) => ({
  pointerId: 2,
  pointerType: "touch",
  button: 0,
  buttons: 1,
  clientX: x,
  clientY: y,
});

const moveTo = (x: number, y: number) =>
  fireEvent.pointerMove(window, touch(x, y));

const lift = (x: number, y: number) =>
  fireEvent.pointerUp(window, { ...touch(x, y), buttons: 0 });

/** the context menu event a platform sends for a long press or a
 * right-click: Windows sends it where the finger lifts, as a mouse event */
const menuEventOnCanvas = (x: number, y: number) =>
  fireEvent.contextMenu(canvas(), { button: 2, clientX: x, clientY: y });

const ringCenter = () => {
  const { left, top, width, height } = ring()!.style;
  return {
    x: parseFloat(left) + parseFloat(width) / 2,
    y: parseFloat(top) + parseFloat(height) / 2,
  };
};

describe("dragging the radial palette", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render(<Excalidraw radialPalette />);
    API.setAppState({ width: 1000, height: 800, offsetLeft: 0, offsetTop: 0 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {});
  });

  describe("when the puck is held", () => {
    it("keeps the browser's own menu shut", () => {
      expect(fireEvent.contextMenu(puck(), touch(950, 700))).toBe(false);
    });

    describe("and dragged over the canvas", () => {
      beforeEach(() => {
        fireEvent.pointerDown(puck(), touch(950, 700));
        wait(LONG_PRESS_DELAY);
        moveTo(500, 400);
      });

      it("opens no context menu for a menu event on the way", () => {
        menuEventOnCanvas(500, 400);
        expect(h.state.contextMenu).toBeNull();
      });

      it("keeps the browser's menu shut on the way", () => {
        expect(menuEventOnCanvas(500, 400)).toBe(false);
      });

      describe("when it is dropped", () => {
        beforeEach(() => {
          lift(500, 400);
        });

        it("opens no context menu for the menu event that follows", () => {
          menuEventOnCanvas(500, 400);
          expect(h.state.contextMenu).toBeNull();
        });
      });
    });
  });

  describe("when the host's top bar takes the top of the editor", () => {
    /** the bar's height, in CSS px */
    const BAR = 60;
    const original = document.elementsFromPoint;

    beforeEach(() => {
      const bar = document.createElement("button");
      bar.textContent = "Send to Claude";
      document.body.appendChild(bar);
      const editor = () => document.querySelector(".excalidraw")!;
      document.elementsFromPoint = (_x: number, y: number) =>
        y < BAR ? [bar, editor()] : [editor()];
    });

    afterEach(() => {
      document.elementsFromPoint = original;
      document.body
        .querySelectorAll("body > button")
        .forEach((button) => button.remove());
    });

    describe("and the ring opens under it", () => {
      beforeEach(() => {
        act(() => h.app.radialPalette.open({ at: { x: 500, y: 20 } }));
      });

      it("opens below the bar, so every slice can be pressed", () => {
        const top = parseFloat(ring()!.style.top);
        expect(top).toBeGreaterThanOrEqual(BAR);
      });
    });

    describe("and the ring is carried up under it by its hub", () => {
      beforeEach(() => {
        act(() => h.app.radialPalette.open({ at: { x: 500, y: 400 } }));
        fireEvent.pointerDown(hub(), touch(500, 400));
        wait(LONG_PRESS_DELAY);
        moveTo(500, 10);
        lift(500, 10);
      });

      it("stays below the bar", () => {
        const top = parseFloat(ring()!.style.top);
        expect(top).toBeGreaterThanOrEqual(BAR);
      });
    });
  });

  describe("when the ring is open against a corner", () => {
    beforeEach(() => {
      act(() => h.app.radialPalette.open({ at: { x: 20, y: 20 } }));
      fireEvent.pointerDown(hub(), touch(166, 166));
      wait(LONG_PRESS_DELAY);
      moveTo(206, 196);
    });

    it("moves the ring with the finger from the first move", () => {
      expect(ringCenter()).toEqual({ x: 206, y: 196 });
    });
  });

  describe("when the ring is open", () => {
    beforeEach(() => {
      act(() => h.app.radialPalette.open({ at: { x: 500, y: 400 } }));
    });

    describe("and its hub is held", () => {
      beforeEach(() => {
        fireEvent.pointerDown(hub(), touch(500, 400));
        wait(LONG_PRESS_DELAY);
      });

      it("keeps the ring open", () => {
        expect(ring()).not.toBeNull();
      });

      it("keeps the browser's own menu shut", () => {
        expect(fireEvent.contextMenu(hub(), touch(500, 400))).toBe(false);
      });

      describe("and lifted where it was", () => {
        beforeEach(() => {
          lift(500, 400);
          fireEvent.click(hub(), { detail: 1 });
        });

        it("opens no context menu, as a hold is no tap", () => {
          expect(h.state.contextMenu).toBeNull();
        });
      });

      describe("and dragged", () => {
        beforeEach(() => {
          moveTo(560, 330);
          moveTo(600, 300);
        });

        it("moves the ring with it", () => {
          expect(ringCenter()).toEqual({ x: 600, y: 300 });
        });

        it("keeps the ring open", () => {
          expect(ring()).not.toBeNull();
        });

        describe("when it is dropped", () => {
          beforeEach(() => {
            lift(600, 300);
            fireEvent.click(hub(), { detail: 1 });
          });

          it("leaves the ring open where it was dropped", () => {
            expect(ringCenter()).toEqual({ x: 600, y: 300 });
          });

          it("opens no context menu", () => {
            expect(h.state.contextMenu).toBeNull();
          });

          it("puts the puck there too", () => {
            expect(puck().style.getPropertyValue("--radial-puck-x")).toBe(
              "60%",
            );
          });
        });
      });
    });

    describe("and its hub is held and dragged while another finger lands", () => {
      const other = (x: number, y: number) => ({
        ...touch(x, y),
        pointerId: 9,
      });

      beforeEach(() => {
        fireEvent.pointerDown(hub(), touch(500, 400));
        wait(LONG_PRESS_DELAY);
        moveTo(560, 330);
        // a second finger, as when the other hand starts to pan
        fireEvent.pointerDown(backdrop(), other(200, 600));
        fireEvent.pointerMove(window, other(260, 640));
        moveTo(600, 300);
      });

      it("keeps the ring open", () => {
        expect(ring()).not.toBeNull();
      });

      it("keeps the ring on the first finger", () => {
        expect(ringCenter()).toEqual({ x: 600, y: 300 });
      });

      describe("when the first finger lifts", () => {
        beforeEach(() => {
          lift(600, 300);
          fireEvent.pointerUp(window, { ...other(260, 640), buttons: 0 });
        });

        it("puts the puck where the ring was dropped", () => {
          expect(puck().style.getPropertyValue("--radial-puck-x")).toBe("60%");
        });
      });
    });

    describe("and its hub is held and dragged and the browser takes the pointer", () => {
      beforeEach(() => {
        fireEvent.pointerDown(hub(), touch(500, 400));
        wait(LONG_PRESS_DELAY);
        moveTo(600, 300);
        fireEvent.pointerCancel(window, touch(600, 300));
      });

      it("leaves the ring open where it was carried", () => {
        expect(ring()).not.toBeNull();
        expect(ringCenter()).toEqual({ x: 600, y: 300 });
      });

      it("puts the puck there too", () => {
        expect(puck().style.getPropertyValue("--radial-puck-x")).toBe("60%");
      });

      it("sets the ring down", () => {
        expect(ring()!.classList.contains("RadialPalette--moving")).toBe(false);
      });
    });

    describe("and its hub is held and dragged past the left side", () => {
      beforeEach(() => {
        fireEvent.pointerDown(hub(), touch(500, 400));
        wait(LONG_PRESS_DELAY);
        moveTo(-200, 400);
        lift(-200, 400);
      });

      it("puts the puck where the ring is drawn, not past the side", () => {
        expect(puck().style.getPropertyValue("--radial-puck-x")).toBe("16.6%");
      });
    });

    describe("and its hub is pressed and moved before the hold", () => {
      beforeEach(() => {
        fireEvent.pointerDown(hub(), touch(500, 400));
        moveTo(500 + LONG_PRESS_TOLERANCE + 20, 400);
        wait(LONG_PRESS_DELAY);
        lift(500 + LONG_PRESS_TOLERANCE + 20, 400);
      });

      it("leaves the ring where it was", () => {
        expect(ringCenter()).toEqual({ x: 500, y: 400 });
      });
    });

    describe("and its hub is tapped", () => {
      beforeEach(() => {
        fireEvent.pointerDown(hub(), touch(500, 400));
        lift(500, 400);
        fireEvent.click(hub(), { detail: 1 });
      });

      it("opens the context menu, as before", () => {
        expect(h.state.contextMenu).not.toBeNull();
      });
    });
  });
});
