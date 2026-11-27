import { fireEvent, queryByTestId } from "@testing-library/react";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { act, render, unmountComponent } from "../../tests/test-utils";
import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "../App.radialPalette";

import { PUCK_EDGE, PUCK_RADIUS, PUCK_STORAGE_KEY } from "./puckPlace";
import {
  OUTER_BAND,
  RING_RADIUS,
  getRingLayout,
  polar,
  sectorMiddle,
} from "./radialLayout";

const puck = () => queryByTestId(document.body, "radial-palette-puck")!;

const ring = () => queryByTestId(document.body, "radial-palette");

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const pointer = (x: number, y: number) => ({
  pointerId: 1,
  pointerType: "touch",
  button: 0,
  clientX: x,
  clientY: y,
});

const press = (x: number, y: number) =>
  fireEvent.pointerDown(puck(), pointer(x, y));

const moveTo = (x: number, y: number) =>
  fireEvent.pointerMove(window, pointer(x, y));

const lift = (x: number, y: number) =>
  fireEvent.pointerUp(window, pointer(x, y));

const place = () => ({
  x: puck().style.getPropertyValue("--radial-puck-x"),
  y: puck().style.getPropertyValue("--radial-puck-y"),
});

const has = (modifier: string) =>
  puck().classList.contains(`RadialPalette__puck--${modifier}`);

const renderEditor = async () => {
  await render(<Excalidraw radialPalette />);
  API.setAppState({ width: 400, height: 800, offsetLeft: 0, offsetTop: 0 });
};

describe("the radial palette's puck", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await renderEditor();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {});
  });

  it("sits in its corner until it is moved", () => {
    expect(place()).toEqual({ x: "", y: "" });
  });

  describe("when it is pressed", () => {
    beforeEach(() => {
      press(370, 700);
    });

    it("opens nothing until it moves or lifts", () => {
      expect(ring()).toBeNull();
    });
  });

  describe("when the host's top bar takes the top of the editor", () => {
    /** the bar's height, in CSS px */
    const BAR = 60;
    const original = document.elementsFromPoint;
    /** px down the editor (800 tall) the puck's center is at */
    const puckY = () => (parseFloat(place().y) / 100) * 800;

    beforeEach(() => {
      const bar = document.createElement("button");
      bar.textContent = "Send to Claude";
      document.body.appendChild(bar);
      // the editor as it is now: it is drawn again when it reopens
      const editor = () => document.querySelector(".excalidraw")!;
      document.elementsFromPoint = (_x: number, y: number) =>
        y < BAR ? [bar, editor()] : [editor()];
    });

    afterEach(() => {
      document.elementsFromPoint = original;
      document.body
        .querySelectorAll("body > button")
        .forEach((b) => b.remove());
    });

    describe("when it is dropped on the bar's corner", () => {
      beforeEach(() => {
        press(370, 700);
        wait(LONG_PRESS_DELAY);
        moveTo(380, 400);
        moveTo(390, 15);
        lift(390, 15);
      });

      it("lands clear of the bar, where it can be pressed", () => {
        expect(puckY()).toBeGreaterThanOrEqual(BAR + PUCK_RADIUS);
      });

      it("lands as a puck, not a dot under the bar", () => {
        expect(has("collapsed")).toBe(false);
      });

      it("keeps the place it lands at", () => {
        const kept = JSON.parse(localStorage.getItem(PUCK_STORAGE_KEY)!);
        expect(kept.y * 800).toBeGreaterThanOrEqual(BAR + PUCK_RADIUS);
      });
    });

    describe("when it is dropped in the open", () => {
      beforeEach(() => {
        press(370, 700);
        wait(LONG_PRESS_DELAY);
        moveTo(100, 600);
        lift(100, 600);
      });

      it("stays where it was dropped", () => {
        expect(place()).toEqual({ x: "25%", y: "75%" });
      });
    });

    describe("when the editor opens with a place kept under the bar", () => {
      beforeEach(async () => {
        unmountComponent();
        localStorage.setItem(
          PUCK_STORAGE_KEY,
          JSON.stringify({ x: 0.9, y: 0.01, collapsed: false }),
        );
        await renderEditor();
        // the host's bar may come after the editor: the puck looks again
        wait(1000);
      });

      it("moves the puck out from under the bar", () => {
        expect(puckY()).toBeGreaterThanOrEqual(BAR + PUCK_RADIUS);
      });
    });
  });

  describe("when it is held still", () => {
    beforeEach(() => {
      press(370, 700);
      wait(LONG_PRESS_DELAY);
    });

    it("puts the ring away", () => {
      expect(ring()).toBeNull();
    });

    it("lifts the puck to move it", () => {
      expect(has("moving")).toBe(true);
    });

    describe("when it is dragged and dropped in the open", () => {
      beforeEach(() => {
        moveTo(250, 500);
        moveTo(100, 600);
        lift(100, 600);
      });

      it("moves the puck there", () => {
        expect(place()).toEqual({ x: "25%", y: "75%" });
      });

      it("sets it down", () => {
        expect(has("moving")).toBe(false);
      });

      describe("when the editor opens again on this device", () => {
        beforeEach(async () => {
          unmountComponent();
          await renderEditor();
        });

        it("puts the puck where it was left", () => {
          expect(place()).toEqual({ x: "25%", y: "75%" });
        });
      });
    });

    describe("when it is dragged and the browser takes the pointer", () => {
      beforeEach(() => {
        moveTo(250, 500);
        moveTo(100, 600);
        fireEvent.pointerCancel(window, pointer(100, 600));
      });

      it("leaves the puck where it was carried", () => {
        expect(place()).toEqual({ x: "25%", y: "75%" });
      });

      it("sets it down", () => {
        expect(has("moving")).toBe(false);
      });
    });

    describe("when it is dropped against a side", () => {
      beforeEach(() => {
        moveTo(400 - PUCK_EDGE + 2, 400);
        lift(400 - PUCK_EDGE + 2, 400);
      });

      it("tucks it into a dot", () => {
        expect(has("collapsed")).toBe(true);
      });

      describe("when the dot is tapped", () => {
        beforeEach(() => {
          press(395, 400);
          lift(395, 400);
        });

        it("brings the puck back", () => {
          expect(has("collapsed")).toBe(false);
        });

        it("leaves the ring closed", () => {
          expect(ring()).toBeNull();
        });
      });

      describe("when the dot is dragged", () => {
        beforeEach(() => {
          press(395, 400);
          moveTo(200, 200);
          lift(200, 200);
        });

        it("moves it without a hold, as a puck again", () => {
          expect(place()).toEqual({ x: "50%", y: "25%" });
        });
      });
    });
  });

  describe("when it is pressed and lifted before the hold", () => {
    beforeEach(() => {
      press(370, 700);
      wait(LONG_PRESS_DELAY - 1);
      lift(370, 700);
      wait(LONG_PRESS_DELAY);
    });

    it("leaves the ring open, as a tap does", () => {
      expect(ring()).not.toBeNull();
    });
  });

  describe("when the ring, clamped in from the corner, covers the puck", () => {
    beforeEach(() => {
      vi.spyOn(puck(), "getBoundingClientRect").mockReturnValue(
        new DOMRect(350, 680, 40, 40),
      );
      press(370, 700);
      lift(370, 700);
    });

    it("is open over the puck", () => {
      expect(ring()).not.toBeNull();
    });

    describe("when the puck is pressed again, through the ring", () => {
      let opacity: number;

      beforeEach(() => {
        opacity = window.h.state.currentItemOpacity;
        // the test DOM knows no pointer 1 to capture
        Object.defineProperty(
          ring()!.querySelector("svg")!,
          "setPointerCapture",
          {
            value: () => {},
          },
        );
        const covering = queryByTestId(document.body, "radial-opacity")!;
        fireEvent.pointerDown(covering, pointer(370, 700));
        fireEvent.pointerUp(window, pointer(370, 700));
      });

      it("closes the ring, as a press on the puck does", () => {
        expect(ring()).toBeNull();
      });

      it("sets nothing", () => {
        expect(window.h.state.currentItemOpacity).toBe(opacity);
      });
    });
  });

  describe("when the ring opens over the puck, its hub on it", () => {
    beforeEach(() => {
      vi.spyOn(puck(), "getBoundingClientRect").mockReturnValue(
        new DOMRect(180, 380, 40, 40),
      );
      act(() => {
        window.h.app.radialPalette.api.open({ at: { x: 200, y: 400 } });
      });
      const hub = ring()!.querySelector(".RadialPalette__hub")!;
      fireEvent.pointerDown(hub, pointer(200, 400));
    });

    it("leaves the hub its own press", () => {
      expect(ring()).not.toBeNull();
    });
  });

  describe("when it is pressed and moved before the hold", () => {
    beforeEach(() => {
      press(370, 700);
      moveTo(370 - LONG_PRESS_TOLERANCE - 1, 700);
      wait(LONG_PRESS_DELAY);
    });

    it("does not lift the puck", () => {
      expect(has("moving")).toBe(false);
    });

    it("opens the ring for the flick", () => {
      expect(ring()).not.toBeNull();
    });

    describe("when it flicks onto the fill chip past empty recent slots", () => {
      beforeEach(() => {
        const controller = window.h.app.radialPalette;
        const colors = controller.items("colors");
        const fill = colors.findIndex(({ id }) => id === "fill");
        const layout = getRingLayout({
          tools: controller.items("tools").length,
          pens: controller.items("pens").length,
          colors: colors.length,
        });
        const { left, top, width, height } = ring()!.style;
        const scale = parseFloat(width) / (RING_RADIUS * 2);
        const at = polar(
          ((OUTER_BAND.inner + OUTER_BAND.outer) / 2) * scale,
          sectorMiddle(layout.colors[fill]),
        );
        const x = parseFloat(left) + parseFloat(width) / 2 + at.x;
        const y = parseFloat(top) + parseFloat(height) / 2 + at.y;
        moveTo(x, y);
        lift(x, y);
      });

      it("flips the colors arc to fill", () => {
        expect(window.h.app.radialPalette.colorsFill).toBe(true);
      });

      it("keeps the ring open", () => {
        expect(ring()).not.toBeNull();
      });
    });
  });
});
