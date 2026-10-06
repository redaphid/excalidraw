import React from "react";

import { DEFAULT_SIDEBAR, FRAMES_SIDEBAR_TAB, KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { API } from "../tests/helpers/api";
import { Keyboard } from "../tests/helpers/ui";
import { act, fireEvent, render } from "../tests/test-utils";

import { SCROLL_TO_CONTENT_ANIMATION_KEY } from "./App.viewport";

import type { FrameNavigation } from "../types";

const { h } = window;

const frame = (
  id: string,
  x: number,
  y: number,
  width = 400,
  height = 300,
) => ({
  ...API.createElement({ type: "frame", id, x, y, width, height }),
  name: id,
});

const landed = (maxFrames = 300) =>
  act(
    () =>
      new Promise<void>((resolve) => {
        let remaining = maxFrames;
        const check = () => {
          if (
            !AnimationController.running(SCROLL_TO_CONTENT_ANIMATION_KEY) ||
            --remaining <= 0
          ) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );

const viewIn = (id: string) =>
  act(() =>
    h.app.viewport.setViewport({
      target: id,
      fit: "contain",
      animation: false,
      offsets: { ui: { left: 24 } },
    }),
  );

const sized = () => API.setAppState({ width: 1200, height: 800 });

const press = async (key: string) => {
  Keyboard.keyPress(key);
  await landed();
};

describe("frame navigation keys", () => {
  let nav: FrameNavigation | undefined;

  beforeEach(() => {
    window.EXCALIDRAW_THROTTLE_RENDER = true;
    nav = {};
  });

  afterEach(() => {
    window.EXCALIDRAW_THROTTLE_RENDER = undefined;
    AnimationController.reset();
  });

  const mount = async () => {
    await render(<Excalidraw handleKeyboardGlobally frameNavigation={nav} />);
    sized();
    API.setElements([
      frame("frame-valley-of-the-sun", 0, 0),
      frame("frame-the-lair", 600, 0),
      frame("frame-thunderwrench", 0, 600),
    ]);
    await viewIn("frame-valley-of-the-sun");
  };

  describe("when the view is in a frame and nothing is selected", () => {
    beforeEach(async () => {
      await mount();
      await press(KEYS.ARROW_RIGHT);
    });

    it("should glide to the frame to its right", () => {
      expect(h.app.frameNavigation.currentId()).toBe("frame-the-lair");
    });
  });

  describe("when two arrows are pressed in quick succession", () => {
    beforeEach(async () => {
      nav = {};
      await mount();
      API.setElements([
        ...h.elements,
        frame("frame-rusty-conquistador", 1200, 0),
      ]);
      Keyboard.keyPress(KEYS.ARROW_RIGHT);
      await press(KEYS.ARROW_RIGHT);
    });

    it("should step on from where the first one lands", () => {
      expect(h.app.frameNavigation.currentId()).toBe(
        "frame-rusty-conquistador",
      );
    });
  });

  describe("when an element is selected", () => {
    let before: { scrollX: number; scrollY: number };

    beforeEach(async () => {
      await mount();
      API.setSelectedElements([h.app.scene.getNonDeletedElements()[0]]);
      before = { scrollX: h.state.scrollX, scrollY: h.state.scrollY };
      await press(KEYS.ARROW_RIGHT);
    });

    it("should leave the view where it was", () => {
      expect({ scrollX: h.state.scrollX, scrollY: h.state.scrollY }).toEqual(
        before,
      );
    });
  });

  describe("when frameNavigation is off", () => {
    let before: { scrollX: number; scrollY: number };

    beforeEach(async () => {
      nav = undefined;
      await mount();
      before = { scrollX: h.state.scrollX, scrollY: h.state.scrollY };
      await press(KEYS.ARROW_RIGHT);
    });

    it("should leave the view where it was", () => {
      expect({ scrollX: h.state.scrollX, scrollY: h.state.scrollY }).toEqual(
        before,
      );
    });
  });

  describe("when M is pressed", () => {
    beforeEach(async () => {
      await mount();
      Keyboard.keyPress("m");
    });

    it("should open the Frames tab of the default sidebar", () => {
      expect(h.state.openSidebar).toEqual({
        name: DEFAULT_SIDEBAR.name,
        tab: FRAMES_SIDEBAR_TAB,
      });
    });

    describe("when M is pressed again", () => {
      beforeEach(() => {
        Keyboard.keyPress("m");
      });

      it("should close it", () => {
        expect(h.state.openSidebar).toBeNull();
      });
    });
  });

  describe("when M is pressed on a board without frames", () => {
    beforeEach(async () => {
      await render(<Excalidraw handleKeyboardGlobally frameNavigation={nav} />);
      Keyboard.keyPress("m");
    });

    it("should leave the sidebar closed", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when ⌥2 is pressed with two live bookmarks", () => {
    beforeEach(async () => {
      nav = {
        bookmarks: [
          "frame-ghost-town",
          "frame-the-lair",
          "frame-thunderwrench",
        ],
      };
      await mount();
      fireEvent.keyDown(document, { key: "™", code: "Digit2", altKey: true });
      await landed();
    });

    it("should fly to the second one still on the board", () => {
      expect(h.app.frameNavigation.currentId()).toBe("frame-thunderwrench");
    });
  });
});
