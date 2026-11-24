import { exportToCanvas } from "@excalidraw/utils";

import type { FillGradient } from "@excalidraw/element/types";

import { API } from "./helpers/api";

type CanvasEvent = { type: string; props: Record<string, unknown> };

const gradientRectangle = (fillGradient: FillGradient) =>
  API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    backgroundColor: "#ff0000",
    fillStyle: "gradient",
    fillGradient,
  });

const drawOnCanvas = async (fillGradient: FillGradient) => {
  const canvas = await exportToCanvas({
    elements: [gradientRectangle(fillGradient)],
    files: null,
    appState: { exportBackground: false, viewBackgroundColor: "#ffffff" },
  });
  const context = canvas.getContext("2d") as unknown as {
    __getEvents: () => CanvasEvent[];
  };
  return context.__getEvents();
};

const roundedProps = (events: CanvasEvent[], type: string) =>
  Object.fromEntries(
    Object.entries(
      events.find((event) => event.type === type)?.props ?? {},
    ).map(([key, value]) => [key, Math.round((value as number) * 1e6) / 1e6]),
  );

const fillsOf = (events: CanvasEvent[]) =>
  events
    .filter((event) => event.type === "fillStyle")
    .map((event) => event.props.value);

describe("a rectangle with a gradient fill", () => {
  describe("when a linear gradient is drawn on a canvas", () => {
    let events: CanvasEvent[];

    beforeEach(async () => {
      events = await drawOnCanvas({
        type: "linear",
        color: "#0000ff",
        angle: 90,
      });
    });

    it("creates the gradient across the element", () => {
      expect(roundedProps(events, "createLinearGradient")).toEqual({
        x0: 0,
        y0: 25,
        x1: 100,
        y1: 25,
      });
    });

    it("fills with a gradient running between the two colors", () => {
      const gradient = fillsOf(events).find(
        (fill) => fill instanceof CanvasGradient,
      ) as CanvasGradient;

      expect(vi.mocked(gradient.addColorStop).mock.calls).toEqual([
        [0, "#ff0000"],
        [1, "#0000ff"],
      ]);
    });
  });

  describe("when a radial gradient is drawn on a canvas", () => {
    let events: CanvasEvent[];

    beforeEach(async () => {
      events = await drawOnCanvas({
        type: "radial",
        color: "#0000ff",
        angle: 0,
      });
    });

    it("creates the gradient from the center out to the corners", () => {
      expect(roundedProps(events, "createRadialGradient")).toEqual({
        x0: 50,
        y0: 25,
        r0: 0,
        x1: 50,
        y1: 25,
        r1: 55.901699,
      });
    });
  });
});
