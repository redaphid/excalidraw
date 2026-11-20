import { fireEvent, queryByTestId } from "@testing-library/react";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { act, render, unmountComponent } from "../../tests/test-utils";
import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "../App.radialPalette";

import { PUCK_EDGE } from "./puckPlace";
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
