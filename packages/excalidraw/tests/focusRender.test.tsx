import React from "react";

import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

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

describe("repainting the static scene on window focus", () => {
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

  describe("when the static canvas's context is restored after a loss", () => {
    beforeEach(() => {
      act(() => {
        h.app.canvas.dispatchEvent(new Event("contextrestored"));
      });
    });

    it("repaints the static scene", () => {
      expect(renderStaticScene).toHaveBeenCalled();
    });
  });
});
