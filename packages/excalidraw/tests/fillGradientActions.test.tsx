import React from "react";

import { CODES, DEFAULT_FILL_GRADIENT } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  FillGradient,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  actionChangeFillGradient,
  actionChangeFillStyle,
} from "../actions/actionProperties";
import { getStyleProperty } from "../components/RadialPalette/styleProperties";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { Action } from "../actions/types";

const { h } = window;

const mouse = new Pointer("mouse");

const run = (action: Action, value: unknown) =>
  act(() => {
    h.app.actionManager.executeAction(action, "ui", value);
  });

const rectangle = (
  props: { fillStyle?: "solid" | "gradient"; fillGradient?: FillGradient } = {},
) =>
  API.createElement({
    type: "rectangle",
    backgroundColor: "#ff0000",
    fillStyle: "gradient",
    ...props,
  });

const select = (...elements: NonDeletedExcalidrawElement[]) => {
  API.setElements(elements);
  API.setSelectedElements(elements);
};

const drawRectangle = () => {
  UI.clickTool("rectangle");
  mouse.down(10, 10);
  mouse.up(60, 60);
  return h.elements[h.elements.length - 1];
};

const applies = (id: string, elements: ExcalidrawElement[]) =>
  getStyleProperty(id)?.applies(elements, h.state);

describe("fill gradient", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  describe("when the end color of a selected gradient shape is changed", () => {
    beforeEach(() => {
      select(rectangle());
      run(actionChangeFillGradient, { color: "#0000ff" });
    });

    it("changes the color and keeps the rest of the gradient", () => {
      expect(h.elements[0].fillGradient).toEqual({
        ...DEFAULT_FILL_GRADIENT,
        color: "#0000ff",
      });
    });

    it("remembers the gradient for new shapes", () => {
      expect(h.state.currentItemFillGradient).toEqual({
        ...DEFAULT_FILL_GRADIENT,
        color: "#0000ff",
      });
    });
  });

  describe("when the type of a selected gradient shape is changed", () => {
    beforeEach(() => {
      select(
        rectangle({
          fillGradient: { type: "linear", color: "#00ff00", angle: 45 },
        }),
      );
      run(actionChangeFillGradient, { type: "radial" });
    });

    it("keeps the shape's own color and angle", () => {
      expect(h.elements[0].fillGradient).toEqual({
        type: "radial",
        color: "#00ff00",
        angle: 45,
      });
    });
  });

  describe("when a shape that isn't filled with a gradient is selected", () => {
    beforeEach(() => {
      select(rectangle({ fillStyle: "solid" }));
      run(actionChangeFillGradient, { color: "#0000ff" });
    });

    it("leaves the shape without a gradient", () => {
      expect(h.elements[0]).not.toHaveProperty("fillGradient");
    });
  });

  describe("when a shape is drawn with the gradient fill current", () => {
    let drawn: ExcalidrawElement;

    beforeEach(() => {
      run(actionChangeFillStyle, "gradient");
      run(actionChangeFillGradient, { color: "#0000ff", angle: 180 });
      drawn = drawRectangle();
    });

    it("is filled with a gradient", () => {
      expect(drawn.fillStyle).toBe("gradient");
    });

    it("gets the current gradient", () => {
      expect(drawn.fillGradient).toEqual({
        type: "linear",
        color: "#0000ff",
        angle: 180,
      });
    });
  });

  describe("when a shape is drawn with another fill current", () => {
    let drawn: ExcalidrawElement;

    beforeEach(() => {
      drawn = drawRectangle();
    });

    it("has no gradient", () => {
      expect(drawn).not.toHaveProperty("fillGradient");
    });
  });

  describe("when a gradient shape's styles are pasted onto another shape", () => {
    const fillGradient: FillGradient = {
      type: "radial",
      color: "#0000ff",
      angle: 0,
    };

    beforeEach(() => {
      const source = rectangle({ fillGradient });
      const target = rectangle({ fillStyle: "solid" });
      API.setElements([source, target]);
      API.setSelectedElements([source]);
      Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
        Keyboard.codeDown(CODES.C);
      });
      API.setSelectedElements([target]);
      Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
        Keyboard.codeDown(CODES.V);
      });
    });

    it("gives it the gradient fill", () => {
      expect(h.elements[1].fillStyle).toBe("gradient");
    });

    it("gives it the gradient", () => {
      expect(h.elements[1].fillGradient).toEqual(fillGradient);
    });
  });

  describe("the style ring", () => {
    it("offers the gradient fill", () => {
      expect(
        getStyleProperty("fillStyle")?.options.map((option) => option.value),
      ).toContain("gradient");
    });

    it("hides the gradient properties from a shape with another fill", () => {
      expect(
        ["fillGradientType", "fillGradientAngle", "fillGradientColor"].map(
          (id) => applies(id, [rectangle({ fillStyle: "solid" })]),
        ),
      ).toEqual([false, false, false]);
    });

    it("shows the gradient properties for a linear gradient shape", () => {
      expect(
        ["fillGradientType", "fillGradientAngle", "fillGradientColor"].map(
          (id) => applies(id, [rectangle()]),
        ),
      ).toEqual([true, true, true]);
    });

    it("hides the angle from a radial gradient shape", () => {
      expect(
        applies("fillGradientAngle", [
          rectangle({
            fillGradient: { type: "radial", color: "#0000ff", angle: 0 },
          }),
        ]),
      ).toBe(false);
    });

    it("reads the angle a shape's gradient runs at", () => {
      expect(
        getStyleProperty("fillGradientAngle")?.current(
          [
            rectangle({
              fillGradient: { type: "linear", color: "#0000ff", angle: 135 },
            }),
          ],
          h.state,
        ),
      ).toBe(135);
    });

    it("sets the angle its option names", () => {
      select(rectangle());
      run(
        actionChangeFillGradient,
        getStyleProperty("fillGradientAngle")?.options[3].value,
      );

      expect(h.elements[0].fillGradient?.angle).toBe(135);
    });
  });
});
