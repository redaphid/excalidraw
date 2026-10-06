import { vi } from "vitest";

import type { FixedPointBinding } from "@excalidraw/element/types";

import { AnimationController } from "../../renderer/animation";
import { getNormalizedZoom } from "../../scene";
import { act } from "../test-utils";

import { API } from "./api";

/** a frame named after its id */
export const frame = (
  id: string,
  x: number,
  y: number,
  width = 400,
  height = 300,
) => ({
  ...API.createElement({ type: "frame", id, x, y, width, height }),
  name: id,
});

const binding = (elementId: string): FixedPointBinding => ({
  elementId,
  fixedPoint: [0.5, 0.5],
  mode: "orbit",
});

export const arrowBetween = (id: string, from: string, to: string) => ({
  ...API.createElement({ type: "arrow", id, x: 0, y: 0, width: 10 }),
  startBinding: binding(from),
  endBinding: binding(to),
});

/** in jsdom the measured UI leaves 24px of padding on every side */
const INSET = 24;

/** sets the view so that, inside the padding, it shows exactly this scene box */
export const showView = (view: {
  x: number;
  y: number;
  width: number;
  height: number;
}) =>
  API.setAppState({
    zoom: { value: getNormalizedZoom(1) },
    width: view.width + 2 * INSET,
    height: view.height + 2 * INSET,
    scrollX: INSET - view.x,
    scrollY: INSET - view.y,
  });

/** animation frames, flights and debounces on a fake clock */
export const fakeClock = () => {
  window.EXCALIDRAW_THROTTLE_RENDER = true;
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
  });
};

export const realClock = () => {
  AnimationController.reset();
  vi.useRealTimers();
  window.EXCALIDRAW_THROTTLE_RENDER = undefined;
};

export const settle = (ms = 3000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** the breadcrumb, outermost first */
export const breadcrumb = () =>
  [...document.querySelectorAll(".frame-breadcrumb button")].map(
    (b) => b.textContent,
  );

/** the frame the breadcrumb says the view is in */
export const here = () =>
  document.querySelector(".frame-breadcrumb [aria-current]")?.textContent ??
  null;
