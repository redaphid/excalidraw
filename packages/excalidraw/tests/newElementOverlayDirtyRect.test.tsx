import React from "react";
import { vi } from "vitest";

import { getElementPaintBounds } from "@excalidraw/element";

import type { Bounds } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

const overlayCanvas = () =>
  [...document.querySelectorAll<HTMLCanvasElement>("canvas")].find(
    (canvas) =>
      canvas.classList.contains("excalidraw__canvas") &&
      !canvas.classList.contains("static") &&
      !canvas.classList.contains("interactive"),
  )!;

const strokeBounds = () =>
  getElementPaintBounds(
    h.state.newElement!,
    h.app.scene.getNonDeletedElementsMap(),
  );

/** the device-pixel rect holding both bounds, at the current view */
const toDeviceRect = (a: Bounds, b: Bounds) => {
  const { scrollX, scrollY, zoom } = h.state;
  const toDevice = window.devicePixelRatio * zoom.value;
  return {
    x1: (Math.min(a[0], b[0]) + scrollX) * toDevice,
    y1: (Math.min(a[1], b[1]) + scrollY) * toDevice,
    x2: (Math.max(a[2], b[2]) + scrollX) * toDevice,
    y2: (Math.max(a[3], b[3]) + scrollY) * toDevice,
  };
};

describe("the canvas over a new element drawn inside a frame", () => {
  const drawInFrame = async () => {
    await render(<Excalidraw />);
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    const above = API.createElement({
      type: "rectangle",
      x: 150,
      y: 150,
      width: 100,
      height: 100,
    });
    API.setElements([frame, above]);
    API.setAppState({ width: 1000, height: 800 });
    UI.clickTool("freedraw");
    const mouse = new Pointer("mouse");
    mouse.downAt(200, 60);
    mouse.moveTo(220, 80);
    expect(h.state.newElement!.frameId).toBe(frame.id);
    const overlay = overlayCanvas();
    return {
      mouse,
      overlay,
      clearRect: vi.spyOn(overlay.getContext("2d")!, "clearRect"),
    };
  };

  it("clears only where the stroke was or is on each move", async () => {
    const { mouse, overlay, clearRect } = await drawInFrame();

    for (const [x, y] of [
      [240, 90],
      [260, 120],
      [300, 100],
    ]) {
      const before = strokeBounds();
      clearRect.mockClear();
      mouse.moveTo(x, y);
      const rect = toDeviceRect(before, strokeBounds());

      expect(clearRect).toHaveBeenCalledTimes(1);
      const [cx, cy, cw, ch] = clearRect.mock.calls[0];
      expect(cx).toBeGreaterThanOrEqual(Math.floor(rect.x1) - 1);
      expect(cy).toBeGreaterThanOrEqual(Math.floor(rect.y1) - 1);
      expect(cx + cw).toBeLessThanOrEqual(Math.ceil(rect.x2) + 1);
      expect(cy + ch).toBeLessThanOrEqual(Math.ceil(rect.y2) + 1);
      expect(cw * ch).toBeLessThan((overlay.width * overlay.height) / 10);
    }
    mouse.upAt(300, 100);
  });

  it("clears in full when the view moves mid-stroke", async () => {
    const { mouse, overlay, clearRect } = await drawInFrame();
    clearRect.mockClear();

    API.setAppState({ scrollX: 5 });
    expect(clearRect).toHaveBeenCalledWith(
      0,
      0,
      overlay.width / window.devicePixelRatio,
      overlay.height / window.devicePixelRatio,
    );
    mouse.upAt(240, 90);
  });
});
