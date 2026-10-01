import { fireEvent } from "@testing-library/react";

import { getFreedrawStrokeDiameter } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { penSizeFromSlider } from "../components/penSize";
import { getNormalizedZoom } from "../scene";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, render } from "./test-utils";

const zoomTo = (zoom: number) =>
  API.setAppState({ zoom: { value: getNormalizedZoom(zoom) } });

const draw = (type: "freedraw" | "rectangle") =>
  UI.createElement(type, { x: 0, y: 0, width: 10, height: 10 }).get();

const preview = () =>
  document.querySelector<HTMLElement>('[data-testid="pen-size-preview"]');

const label = () =>
  document.querySelector(".pen-size-slider__value")?.textContent;

describe("freedrawAuthoringUnits", () => {
  afterEach(async () => {
    await act(async () => {});
  });

  describe("when the pen authors in screen units on a scene-unit board", () => {
    beforeEach(async () => {
      await render(<Excalidraw freedrawAuthoringUnits="screen" />);
    });

    describe("when a stroke is drawn at 75,000%", () => {
      let stroke: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(750);
        stroke = draw("freedraw");
      });

      it("stores the pen width divided by the zoom", () => {
        expect(stroke.strokeWidth).toBeCloseTo(0.25 / 750, 12);
      });

      it("scales the stroke's details with it", () => {
        expect(stroke.authoringScale).toBeCloseTo(1 / 750, 12);
      });
    });

    describe("when a stroke is drawn at 10%", () => {
      let stroke: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(0.1);
        stroke = draw("freedraw");
      });

      it("stores the pen width divided by the zoom", () => {
        expect(stroke.strokeWidth).toBeCloseTo(2.5, 12);
      });
    });

    describe("when a rectangle is drawn at 75,000%", () => {
      let rectangle: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(750);
        rectangle = draw("rectangle");
      });

      it("keeps its scene stroke width", () => {
        expect(rectangle.strokeWidth).toBe(2);
      });
    });

    describe("when the pen tool is out at 75,000%", () => {
      beforeEach(() => {
        zoomTo(750);
        UI.clickTool("freedraw");
      });

      it("previews the stroke at its width on screen", () => {
        expect(parseFloat(preview()!.style.width)).toBeCloseTo(
          getFreedrawStrokeDiameter(0.25, "constant"),
          6,
        );
      });
    });

    describe("when the slider is moved at 75,000%", () => {
      let stroke: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(750);
        UI.clickTool("freedraw");
        fireEvent.change(
          document.querySelector('[data-testid="pen-size-slider"]')!,
          { target: { value: "100" } },
        );
        stroke = draw("freedraw");
      });

      it("draws the next stroke at the new width on screen", () => {
        expect(stroke.strokeWidth * 750).toBeCloseTo(penSizeFromSlider(100), 9);
      });
    });

    describe("when a stroke drawn at 100% is selected at 400%", () => {
      beforeEach(() => {
        zoomTo(1);
        const stroke = draw("freedraw");
        zoomTo(400);
        API.setAppState({ selectedElementIds: { [stroke.id]: true } });
      });

      it("labels the slider with the stroke's width on screen", () => {
        expect(label()).toBe("100");
      });
    });

    describe("when a stroke drawn at 100% is viewed at 400%", () => {
      let stroke: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(1);
        const drawn = draw("freedraw");
        zoomTo(400);
        stroke = API.getElement(drawn);
      });

      it("keeps its scene width", () => {
        expect(stroke.strokeWidth).toBe(0.25);
      });
    });
  });

  describe("when the whole board authors in screen units", () => {
    beforeEach(async () => {
      await render(<Excalidraw authoringUnits="screen" />);
    });

    describe("when a stroke is drawn at 75,000%", () => {
      let stroke: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(750);
        stroke = draw("freedraw");
      });

      it("follows the board's units", () => {
        expect(stroke.strokeWidth).toBeCloseTo(0.25 / 750, 12);
      });
    });
  });

  describe("when the pen authors in scene units on a screen-unit board", () => {
    beforeEach(async () => {
      await render(
        <Excalidraw authoringUnits="screen" freedrawAuthoringUnits="scene" />,
      );
    });

    describe("when a stroke is drawn at 75,000%", () => {
      let stroke: ExcalidrawElement;

      beforeEach(() => {
        zoomTo(750);
        stroke = draw("freedraw");
      });

      it("stores the pen width as a scene width", () => {
        expect(stroke.strokeWidth).toBe(0.25);
      });
    });
  });
});
