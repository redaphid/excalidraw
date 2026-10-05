import React from "react";

import {
  Excalidraw,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "../index";
import { getNormalizedZoom } from "../scene";

import { Pointer } from "./helpers/ui";
import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";

const { h } = window;

const pinch = (from: number, to: number) => {
  const finger1 = new Pointer("touch", 1);
  const finger2 = new Pointer("touch", 2);
  finger1.downAt(100 - from / 2, 100);
  finger2.downAt(100 + from / 2, 100);
  finger1.moveTo(100 - to / 2, 100);
  finger2.moveTo(100 + to / 2, 100);
  finger1.up();
  finger2.up();
};

type ScreenPoint = { x: number; y: number };

const sceneUnder = (screen: ScreenPoint) =>
  viewportCoordsToSceneCoords(
    { clientX: screen.x, clientY: screen.y },
    h.state,
  );

const screenDistance = (scene: ScreenPoint, screen: ScreenPoint) => {
  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: scene.x, sceneY: scene.y },
    h.state,
  );
  return Math.hypot(x - screen.x, y - screen.y);
};

const ratioOfPinchAt = (zoom: number, from: number, to: number) => {
  React.act(() => {
    h.setState({ zoom: { value: getNormalizedZoom(zoom) } });
  });
  pinch(from, to);
  return h.state.zoom.value / zoom;
};

describe("one pinch of the same finger travel", () => {
  beforeEach(async () => {
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(h.state.width).toBe(200));
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  describe("when pinching out", () => {
    let ratios: number[];

    beforeEach(() => {
      ratios = [1, 25, 250].map((zoom) => ratioOfPinchAt(zoom, 150, 30));
    });

    it("zooms out by the same ratio at every depth", () => {
      expect(ratios.map((ratio) => ratio.toFixed(3))).toEqual([
        "0.200",
        "0.200",
        "0.200",
      ]);
    });
  });

  describe("when pinching in", () => {
    let ratios: number[];

    beforeEach(() => {
      ratios = [1, 25, 250].map((zoom) => ratioOfPinchAt(zoom, 30, 150));
    });

    it("zooms in by the same ratio at every depth", () => {
      expect(ratios.map((ratio) => ratio.toFixed(3))).toEqual([
        "5.000",
        "5.000",
        "5.000",
      ]);
    });
  });
});

describe("a two-finger gesture", () => {
  const finger1 = new Pointer("touch", 1);
  const finger2 = new Pointer("touch", 2);

  beforeEach(async () => {
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(h.state.width).toBe(200));
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  describe("when the fingers spread while their centre travels", () => {
    let anchor: ScreenPoint;

    beforeEach(() => {
      finger1.downAt(70, 60);
      finger2.downAt(110, 60);
      anchor = sceneUnder({ x: 90, y: 60 });
      for (let step = 1; step <= 10; step++) {
        finger1.moveTo(70 - step, 60 + 3 * step);
        finger2.moveTo(110 + 3 * step, 60 + 3 * step);
      }
      finger1.up();
      finger2.up();
    });

    it("keeps the board point that was under the fingers under their centre", () => {
      expect(screenDistance(anchor, { x: 100, y: 90 })).toBeLessThan(0.5);
    });

    it("zooms by the ratio of the spread", () => {
      expect(h.state.zoom.value).toBeCloseTo(2, 5);
    });
  });

  describe("when both fingers' moves land in one React batch", () => {
    let anchor: ScreenPoint;

    beforeEach(() => {
      finger1.downAt(100, 60);
      finger2.downAt(140, 60);
      anchor = sceneUnder({ x: 120, y: 60 });
      for (let step = 1; step <= 10; step++) {
        React.act(() => {
          finger1.moveTo(100 - 4 * step, 60);
          finger2.moveTo(140 + 4 * step, 60);
        });
      }
      finger1.up();
      finger2.up();
    });

    it("keeps the board point that was under the fingers under their centre", () => {
      expect(screenDistance(anchor, { x: 120, y: 60 })).toBeLessThan(0.5);
    });

    it("zooms by the ratio of the spread", () => {
      expect(h.state.zoom.value).toBeCloseTo(3, 5);
    });
  });
});
