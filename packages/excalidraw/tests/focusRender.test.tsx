import React from "react";

import { elementWithCanvasCache } from "@excalidraw/element";

import { Excalidraw } from "../index";
import * as InteractiveScene from "../renderer/interactiveScene";
import * as StaticScene from "../renderer/staticScene";

import { API } from "./helpers/api";
import { act, render, unmountComponent, waitFor } from "./test-utils";

unmountComponent();

const { h } = window;

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");
const renderInteractiveScene = vi.spyOn(
  InteractiveScene,
  "renderInteractiveScene",
);

const cachedBitmap = () => elementWithCanvasCache.get(h.elements[0])?.canvas;

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const focusWindow = () => {
  act(() => {
    window.dispatchEvent(new FocusEvent("blur"));
    window.dispatchEvent(new FocusEvent("focus"));
  });
};

describe("repainting the canvases after focus, visibility or context changes", () => {
  beforeEach(async () => {
    setVisibility("visible");
    await render(
      <Excalidraw
        initialData={{
          elements: [
            API.createElement({ type: "rectangle", id: "rect-dusty-otter" }),
          ],
        }}
      />,
    );
    renderStaticScene.mockClear();
  });

  afterEach(() => {
    setVisibility("visible");
  });

  describe("when focus moves away and back while the page stays visible", () => {
    beforeEach(() => {
      focusWindow();
      focusWindow();
      focusWindow();
    });

    it("does not repaint the static scene", () => {
      expect(renderStaticScene).not.toHaveBeenCalled();
    });
  });

  describe("when the page turns visible again after being hidden", () => {
    beforeEach(() => {
      setVisibility("hidden");
      renderStaticScene.mockClear();
      setVisibility("visible");
    });

    it("repaints the static scene", () => {
      expect(renderStaticScene).toHaveBeenCalled();
    });
  });

  describe("when focus returns after the page was hidden and shown", () => {
    beforeEach(() => {
      setVisibility("hidden");
      setVisibility("visible");
      renderStaticScene.mockClear();
      focusWindow();
    });

    it("does not repaint the static scene again", () => {
      expect(renderStaticScene).not.toHaveBeenCalled();
    });
  });

  // a GPU process crash blanks every canvas, the cached bitmaps too
  describe("when the static canvas's context is restored after a loss", () => {
    let bitmapBefore: HTMLCanvasElement;

    beforeEach(() => {
      // a bitmap that holds the element as drawn before the loss
      bitmapBefore = document.createElement("canvas");
      elementWithCanvasCache.set(h.elements[0], {
        element: h.elements[0],
        canvas: bitmapBefore,
        theme: h.state.theme,
        scale: h.state.zoom.value,
        zoomValue: h.state.zoom.value,
        canvasOffsetX: 0,
        canvasOffsetY: 0,
        phaseX: 0,
        phaseY: 0,
        imageCrop: null,
        containingFrameOpacity: 100,
        canvasTheme: undefined,
      });
      act(() => {
        h.app.canvas.dispatchEvent(new Event("contextrestored"));
      });
    });

    it("repaints the static scene", () => {
      expect(renderStaticScene).toHaveBeenCalled();
    });

    it("does not draw from the bitmap cached before the loss", () => {
      expect(cachedBitmap()).not.toBe(bitmapBefore);
    });
  });

  describe("when the interactive canvas's context is restored after a loss", () => {
    beforeEach(() => {
      renderInteractiveScene.mockClear();
      act(() => {
        h.app.interactiveCanvas!.dispatchEvent(new Event("contextrestored"));
      });
    });

    it("repaints the interactive scene", async () => {
      await waitFor(() => expect(renderInteractiveScene).toHaveBeenCalled());
    });
  });
});
