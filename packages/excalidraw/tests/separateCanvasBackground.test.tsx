import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { GlobalTestState, render, waitFor } from "./test-utils";

const { h } = window;

const GRID_THEME = `:scope {
  --canvas-background: #f4ecd8;
  --canvas-grid-color: #9fb3c4;
}`;

type Painted = { fills: number; lines: number; images: number };

const backgroundCanvas = () =>
  GlobalTestState.renderResult.container.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.background",
  );

const eventsOf = (canvas: HTMLCanvasElement) =>
  (canvas.getContext("2d") as any).__getEvents() as { type: string }[];

const count = (canvas: HTMLCanvasElement | null): Painted => {
  const events = canvas ? eventsOf(canvas) : [];
  const counted = (type: string) =>
    events.filter((e) => e.type === type).length;
  return {
    fills: counted("fillRect"),
    lines: counted("moveTo"),
    images: counted("drawImage"),
  };
};

const repaint = async () => {
  const canvases = [GlobalTestState.canvas, backgroundCanvas()];
  for (const canvas of canvases) {
    (canvas?.getContext("2d") as any)?.__clearEvents();
  }
  API.setAppState({ scrollX: h.state.scrollX + 7 });
  await waitFor(() =>
    expect(
      canvases.some(
        (canvas) => canvas && eventsOf(canvas).some((e) => e.type === "scale"),
      ),
    ).toBe(true),
  );
  return { shown: count(GlobalTestState.canvas), under: count(canvases[1]) };
};

describe("separateCanvasBackground", () => {
  describe("when set, under a theme with a grid", () => {
    let painted: { shown: Painted; under: Painted };

    beforeEach(async () => {
      await render(<Excalidraw separateCanvasBackground css={GRID_THEME} />);
      API.setAppState({ width: 800, height: 600 });
      painted = await repaint();
    });

    it("leaves the static canvas without a background fill", () => {
      expect(painted.shown.fills).toBe(0);
    });

    it("leaves the static canvas without grid lines", () => {
      expect(painted.shown.lines).toBe(0);
    });

    it("fills the background canvas", () => {
      expect(painted.under.fills).toBeGreaterThan(0);
    });

    it("draws the grid on the background canvas", () => {
      expect(painted.under.lines).toBeGreaterThan(0);
    });

    it("puts the background canvas under the static canvas", () => {
      expect(backgroundCanvas()?.nextElementSibling).toBe(
        GlobalTestState.canvas,
      );
    });

    describe("and a rectangle is drawn", () => {
      beforeEach(async () => {
        UI.createElement("rectangle", { x: 40, y: 40, width: 80, height: 60 });
        painted = await repaint();
      });

      it("paints the rectangle on the static canvas", () => {
        expect(painted.shown.images).toBeGreaterThan(0);
      });
    });
  });

  describe("when set, in grid mode", () => {
    it("snaps new shapes to the grid", async () => {
      await render(<Excalidraw separateCanvasBackground css={GRID_THEME} />);
      API.setAppState({ gridModeEnabled: true });

      const rectangle = UI.createElement("rectangle", {
        x: 13,
        y: 27,
        width: 51,
        height: 38,
      });

      expect([rectangle.x, rectangle.y]).toEqual([20, 20]);
    });
  });

  describe("when not set", () => {
    let painted: { shown: Painted; under: Painted };

    beforeEach(async () => {
      await render(<Excalidraw css={GRID_THEME} />);
      API.setAppState({ width: 800, height: 600 });
      painted = await repaint();
    });

    it("adds no background canvas", () => {
      expect(backgroundCanvas()).toBeNull();
    });

    it("fills the static canvas", () => {
      expect(painted.shown.fills).toBeGreaterThan(0);
    });

    it("draws the grid on the static canvas", () => {
      expect(painted.shown.lines).toBeGreaterThan(0);
    });
  });
});
