import React from "react";
import { vi } from "vitest";

import { DEFAULT_SIDEBAR, FRAMES_SIDEBAR_TAB, KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { API } from "../tests/helpers/api";
import { act, fireEvent, render, screen } from "../tests/test-utils";

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

const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(
    `.frames-menu__tree [data-frame="${id}"]`,
  )!;

const tree = (list: Element | null): unknown[] =>
  [...(list?.children ?? [])].map((item) => [
    item.querySelector("[data-frame]")?.getAttribute("data-frame"),
    tree(item.querySelector(":scope > ul")),
  ]);

describe("FramesMenu", () => {
  let nav: FrameNavigation;

  beforeEach(() => {
    window.EXCALIDRAW_THROTTLE_RENDER = true;
    nav = {};
  });

  afterEach(() => {
    window.EXCALIDRAW_THROTTLE_RENDER = undefined;
    AnimationController.reset();
  });

  const mount = async () => {
    await render(
      <Excalidraw
        frameNavigation={nav}
        initialData={{
          appState: {
            openSidebar: {
              name: DEFAULT_SIDEBAR.name,
              tab: FRAMES_SIDEBAR_TAB,
            },
          },
        }}
      />,
    );
    API.setAppState({ width: 1200, height: 800 });
    API.setElements([
      frame("frame-overview", 0, 0, 1700, 980),
      frame("frame-board-do", 1300, 260, 340, 330),
      frame("frame-registry", 1300, 0, 300, 200),
      frame("frame-the-lair", 2000, 0),
    ]);
    await act(() =>
      h.app.viewport.setViewport({
        target: "frame-the-lair",
        fit: "contain",
        animation: false,
        offsets: { ui: { left: 24 } },
      }),
    );
  };

  describe("when the Frames tab is open", () => {
    beforeEach(async () => {
      await mount();
    });

    it("should list the frames as a tree in reading order", () => {
      expect(tree(document.querySelector(".frames-menu__tree > ul"))).toEqual([
        [
          "frame-overview",
          [
            ["frame-registry", []],
            ["frame-board-do", []],
          ],
        ],
        ["frame-the-lair", []],
      ]);
    });

    it("should mark the frame the view is in", () => {
      expect(row("frame-the-lair")).toHaveAttribute("aria-current", "location");
    });

    it("should show no stars without onBookmarkChange", () => {
      expect(document.querySelector(".frames-menu__star")).toBeNull();
    });
  });

  describe("when a frame is clicked", () => {
    beforeEach(async () => {
      await mount();
      fireEvent.click(row("frame-board-do"));
      await landed();
    });

    it("should fly there", () => {
      expect(h.app.frameNavigation.currentId()).toBe("frame-board-do");
    });
  });

  describe("when Enter is pressed on a frame with children", () => {
    beforeEach(async () => {
      await mount();
      row("frame-overview").focus();
      fireEvent.keyDown(row("frame-overview"), { key: KEYS.ENTER });
      await landed();
    });

    it("should go into its first child", () => {
      expect(h.app.frameNavigation.currentId()).toBe("frame-registry");
    });

    it("should move focus with it", () => {
      expect(document.activeElement).toBe(row("frame-registry"));
    });
  });

  describe("when Escape is pressed on a nested frame", () => {
    beforeEach(async () => {
      await mount();
      fireEvent.keyDown(row("frame-registry"), { key: KEYS.ESCAPE });
      await landed();
    });

    it("should go out to its parent", () => {
      expect(h.app.frameNavigation.currentId()).toBe("frame-overview");
    });

    it("should keep the drawer open", () => {
      expect(h.state.openSidebar?.tab).toBe(FRAMES_SIDEBAR_TAB);
    });
  });

  describe("when Escape is pressed on a top-level frame", () => {
    beforeEach(async () => {
      await mount();
      fireEvent.keyDown(row("frame-the-lair"), { key: KEYS.ESCAPE });
    });

    it("should close the drawer", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when the host keeps bookmarks", () => {
    let onBookmarkChange: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      onBookmarkChange = vi.fn();
      nav = {
        bookmarks: ["frame-ghost-town", "frame-board-do"],
        onBookmarkChange,
      };
      await mount();
    });

    it("should list the live ones with their ⌥ keys", () => {
      expect(
        [
          ...document.querySelectorAll(".frames-menu__bookmarks [data-frame]"),
        ].map((b) => b.textContent),
      ).toEqual(["frame-board-do⌥1"]);
    });

    describe("when an unstarred frame's star is clicked", () => {
      beforeEach(() => {
        fireEvent.click(
          screen.getAllByRole("button", { name: "Bookmark frame-the-lair" })[0],
        );
      });

      it("should ask the host to bookmark it", () => {
        expect(onBookmarkChange).toHaveBeenCalledWith("frame-the-lair", true);
      });
    });

    describe("when a starred frame's star is clicked", () => {
      beforeEach(() => {
        fireEvent.click(
          screen.getAllByRole("button", {
            name: "Remove bookmark frame-board-do",
          })[0],
        );
      });

      it("should ask the host to unbookmark it", () => {
        expect(onBookmarkChange).toHaveBeenCalledWith("frame-board-do", false);
      });
    });
  });
});

describe("FrameBreadcrumb", () => {
  beforeEach(async () => {
    window.EXCALIDRAW_THROTTLE_RENDER = true;
    await render(<Excalidraw frameNavigation={{}} />);
    API.setAppState({ width: 1200, height: 800 });
    API.setElements([
      frame("frame-overview", 0, 0, 1700, 980),
      frame("frame-board-do", 1300, 260, 340, 330),
      frame("frame-element-row", 1333, 345, 130, 110),
    ]);
    await act(() =>
      h.app.viewport.setViewport({
        target: "frame-element-row",
        fit: "contain",
        animation: false,
        offsets: { ui: { left: 24 } },
      }),
    );
  });

  afterEach(() => {
    window.EXCALIDRAW_THROTTLE_RENDER = undefined;
    AnimationController.reset();
  });

  it("should run from the outermost frame down to the one the view is in", () => {
    expect(
      [...document.querySelectorAll(".frame-breadcrumb button")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["frame-overview", "frame-board-do", "frame-element-row"]);
  });

  describe("when an outer frame is clicked", () => {
    beforeEach(async () => {
      fireEvent.click(screen.getByRole("button", { name: "frame-overview" }));
      await landed();
    });

    it("should fly out to it", () => {
      expect(h.app.frameNavigation.currentId()).toBe("frame-overview");
    });
  });
});
