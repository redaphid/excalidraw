import React from "react";
import { vi } from "vitest";

import { DEFAULT_SIDEBAR, FRAMES_SIDEBAR_TAB, KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import {
  fakeClock,
  frame,
  here,
  realClock,
  settle,
  showView,
} from "../tests/helpers/frames";
import { act, fireEvent, render, screen, waitFor } from "../tests/test-utils";

import type { FrameNavigation } from "../types";

const { h } = window;

const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(
    `.frames-menu__tree [data-frame="${id}"]`,
  )!;

const tree = (list: Element | null): unknown[] =>
  [...(list?.children ?? [])].map((item) => [
    item.querySelector("[data-frame]")?.getAttribute("data-frame"),
    tree(item.querySelector(":scope > ul")),
  ]);

const listed = () => tree(document.querySelector(".frames-menu__tree > ul"));

const mount = async (
  nav: FrameNavigation = {},
  formFactor: "desktop" | "phone" = "desktop",
) => {
  await render(
    <Excalidraw
      frameNavigation={nav}
      UIOptions={{ getFormFactor: () => formFactor }}
      initialData={{
        appState: {
          openSidebar: { name: DEFAULT_SIDEBAR.name, tab: FRAMES_SIDEBAR_TAB },
        },
      }}
    />,
  );
  fireEvent.resize(window);
  await waitFor(() =>
    expect(h.app.editorInterface.formFactor).toBe(formFactor),
  );
  fakeClock();
  API.setElements([
    frame("frame-overview", 0, 0, 1700, 980),
    frame("frame-board-do", 1300, 260, 340, 330),
    frame("frame-registry", 1300, 0, 300, 200),
    frame("frame-the-lair", 2000, 0),
    API.createElement({
      type: "rectangle",
      id: "rect-thunderwrench",
      x: 2100,
      y: 100,
      frameId: "frame-the-lair",
    }),
  ]);
  showView({ x: 2000, y: 0, width: 400, height: 300 });
};

afterEach(realClock);

describe("FramesMenu", () => {
  describe("when the Frames tab is open", () => {
    beforeEach(async () => {
      await mount();
    });

    it("should list the frames as a tree in reading order", () => {
      expect(listed()).toEqual([
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

    it("should name the bookmark keys for this platform", () => {
      expect(document.querySelector(".frames-menu__hint")?.textContent).toBe(
        "↵ into · Esc out · Alt+1…9 bookmarks · M close",
      );
    });

    it("should show no stars without onBookmarkChange", () => {
      expect(document.querySelector(".frames-menu__star")).toBeNull();
    });
  });

  describe("when a frame is nudged past its sibling while the drawer is open", () => {
    beforeEach(async () => {
      await mount();
      act(() => {
        h.app.scene.mutateElement(h.elements[2], { y: 400 });
      });
    });

    it("should reorder the tree", () => {
      expect(listed()).toEqual([
        [
          "frame-overview",
          [
            ["frame-board-do", []],
            ["frame-registry", []],
          ],
        ],
        ["frame-the-lair", []],
      ]);
    });
  });

  describe("when the scene has been still for a moment", () => {
    beforeEach(async () => {
      await mount();
      await settle(1000);
    });

    it("should show a thumbnail for every frame", () => {
      expect(
        document.querySelectorAll(".frames-menu__tree .frames-menu__thumb img"),
      ).toHaveLength(4);
    });
  });

  describe("when a frame is clicked", () => {
    beforeEach(async () => {
      await mount();
      fireEvent.click(row("frame-board-do"));
      await settle();
    });

    it("should fly there", () => {
      expect(here()).toBe("frame-board-do");
    });
  });

  describe("when a frame is picked on a phone", () => {
    beforeEach(async () => {
      await mount({}, "phone");
      fireEvent.click(row("frame-board-do"));
      await settle();
    });

    it("should close the drawer so the flight shows", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when Enter is pressed on a frame with children", () => {
    beforeEach(async () => {
      await mount();
      row("frame-overview").focus();
      fireEvent.keyDown(row("frame-overview"), { key: KEYS.ENTER });
      await settle();
    });

    it("should go into its first child", () => {
      expect(here()).toBe("frame-registry");
    });

    it("should move focus with it", () => {
      expect(document.activeElement).toBe(row("frame-registry"));
    });
  });

  describe("when Escape is pressed on a nested frame", () => {
    beforeEach(async () => {
      await mount();
      fireEvent.keyDown(row("frame-registry"), { key: KEYS.ESCAPE });
      await settle();
    });

    it("should go out to its parent", () => {
      expect(here()).toBe("frame-overview");
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

  describe("when the drawer is closed with its close button while a row has focus", () => {
    beforeEach(async () => {
      await mount();
      row("frame-the-lair").focus();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await settle();
    });

    it("should hand focus back to the editor", () => {
      expect(document.activeElement).toBe(
        document.querySelector(".excalidraw-container"),
      );
    });
  });

  describe("when the host keeps bookmarks", () => {
    let onBookmarkChange: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      onBookmarkChange = vi.fn();
      await mount({
        bookmarks: ["frame-ghost-town", "frame-board-do"],
        onBookmarkChange,
      });
    });

    it("should list the live ones with their keys", () => {
      expect(
        [
          ...document.querySelectorAll(".frames-menu__bookmarks [data-frame]"),
        ].map((b) => b.textContent),
      ).toEqual(["frame-board-doAlt+1"]);
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
    await render(<Excalidraw frameNavigation={{}} />);
    API.setElements([
      frame("frame-overview", 0, 0, 1700, 980),
      frame("frame-board-do", 1300, 260, 340, 330),
      frame("frame-element-row", 1333, 345, 130, 110),
    ]);
    fakeClock();
    showView({ x: 1333, y: 345, width: 130, height: 110 });
    fireEvent.click(screen.getByRole("button", { name: "frame-overview" }));
    await settle();
  });

  it("should fly out to an outer frame when it is clicked", () => {
    expect(here()).toBe("frame-overview");
  });
});
