import { fireEvent, queryByTestId } from "@testing-library/react";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { act, render, unmountComponent } from "../../tests/test-utils";
import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "../App.radialPalette";

import { PUCK_EDGE } from "./puckPlace";
import { RADIAL_TOOLS } from "./radialPaletteController";
import { STICK_RIM } from "./stick";

const { h } = window;

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

    it("opens the ring for the pull", () => {
      expect(ring()).not.toBeNull();
    });
  });

  describe("when it is pulled toward the rectangle", () => {
    const toward = (reach: number) => {
      const radians = (-50 * Math.PI) / 180;
      return {
        x: 370 + reach * Math.cos(radians),
        y: 700 + reach * Math.sin(radians),
      };
    };

    beforeEach(() => {
      press(370, 700);
      const { x, y } = toward(STICK_RIM - 5);
      moveTo(x, y);
    });

    it("aims at it on the ring", () => {
      expect(h.app.radialPalette.state()).toMatchObject({
        open: true,
        ring: "tools",
        index: RADIAL_TOOLS.indexOf("rectangle"),
      });
    });

    it("leaves the tool as it was until the rim", () => {
      expect(h.state.activeTool.type).toBe("selection");
    });

    it("follows the thumb with the puck", () => {
      expect(has("pulled")).toBe(true);
    });

    describe("when it rests there past the hold", () => {
      beforeEach(() => {
        wait(LONG_PRESS_DELAY);
      });

      it("does not lift the puck to move", () => {
        expect(has("moving")).toBe(false);
      });
    });

    describe("when it is released inside the rim", () => {
      beforeEach(() => {
        const { x, y } = toward(STICK_RIM - 5);
        lift(x, y);
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
      });

      it("picks nothing", () => {
        expect(h.state.activeTool.type).toBe("selection");
      });
    });

    describe("when it is pulled on past the rim", () => {
      beforeEach(() => {
        const { x, y } = toward(STICK_RIM + 5);
        moveTo(x, y);
      });

      it("picks the rectangle", () => {
        expect(h.state.activeTool.type).toBe("rectangle");
      });

      it("closes the ring", () => {
        expect(ring()).toBeNull();
      });
    });
  });
});
