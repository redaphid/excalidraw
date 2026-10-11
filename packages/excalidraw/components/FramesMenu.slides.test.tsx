import React, { useState } from "react";
import { vi } from "vitest";

import { DEFAULT_SIDEBAR, FRAMES_SIDEBAR_TAB, KEYS } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

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
import { act, fireEvent, render, screen } from "../tests/test-utils";

import type { Mock } from "vitest";

import type { FrameNavigation, Slide } from "../types";

const { h } = window;

const ROW_PX = 64;

const openDrawer = {
  appState: {
    openSidebar: { name: DEFAULT_SIDEBAR.name, tab: FRAMES_SIDEBAR_TAB },
  },
};

const board = [
  frame("frame-valley-of-the-sun", 0, 0),
  frame("frame-the-lair", 600, 0),
  frame("frame-thunderwrench", 1200, 0),
  frame("frame-registry", 1800, 0),
];

const slide = (frameId: string, included = true): Slide => ({
  frameId,
  included,
});

/** the host's talk, deliberately not in scene order */
const talk = [
  slide("frame-the-lair"),
  slide("frame-valley-of-the-sun"),
  slide("frame-thunderwrench"),
  slide("frame-registry"),
];

let onChange: Mock<(order: Slide[]) => void>;
let onPresent: Mock<() => void>;
/** the host changing its talk on its own, as a sync from another device */
let reorder: (order: Slide[]) => void;

/** a host that keeps the order it is handed back, as a real one would */
const Host = ({ initial }: { initial: Slide[] }) => {
  const [order, setOrder] = useState(initial);
  reorder = setOrder;
  return (
    <Excalidraw
      frameNavigation={{
        slides: {
          order,
          onChange: (next) => {
            onChange(next);
            setOrder(next);
          },
          onPresent,
        },
      }}
      initialData={openDrawer}
    />
  );
};

const mount = async (
  order: Slide[],
  elements: readonly ExcalidrawElement[] = board,
) => {
  onChange = vi.fn();
  onPresent = vi.fn();
  await render(<Host initial={order} />);
  fakeClock();
  API.setElements(elements);
  showView({ x: 0, y: 0, width: 400, height: 300 });
};

const rows = () =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".frames-menu__slides [data-frame]",
    ),
  ].map((row) => row.getAttribute("data-frame"));

const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(
    `.frames-menu__slides [data-frame="${id}"]`,
  )!;

const grip = (name: string) =>
  screen.getByRole("button", { name: `Move ${name}` });

const box = (top: number, height: number) =>
  ({
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 240,
    width: 240,
    height,
  } as DOMRect);

/** jsdom has no layout: stack the rows ROW_PX apart */
const layOut = () =>
  document.querySelectorAll(".frames-menu__slides > li").forEach((li, i) => {
    li.getBoundingClientRect = () => box(i * ROW_PX, ROW_PX);
  });

/** the middle of the nth row, from 0 */
const middle = (n: number) => n * ROW_PX + ROW_PX / 2;

const pen = { pointerId: 7, pointerType: "pen", isPrimary: true };

/** press a grip and carry it, leaving the pen down */
const hold = (target: HTMLElement, from: number, to: number) => {
  fireEvent.pointerDown(target, { ...pen, clientY: from });
  fireEvent.pointerMove(target, { ...pen, clientY: to });
};

const sorting = () =>
  document.querySelector(".frames-menu__slides.is-sorting") !== null;

const removeFrame = (id: string) =>
  act(() => {
    API.setElements(board.filter((element) => element.id !== id));
  });

const stroke = (
  target: HTMLElement,
  pointerType: string,
  ys: number[],
  end: "up" | "cancel" = "up",
) => {
  const pointer = { ...pen, pointerType };
  const [first, ...rest] = ys;
  fireEvent.pointerDown(target, { ...pointer, clientY: first });
  for (const y of rest) {
    fireEvent.pointerMove(target, { ...pointer, clientY: y });
  }
  if (end === "up") {
    fireEvent.pointerUp(target, { ...pointer, clientY: ys[ys.length - 1] });
  } else {
    fireEvent.pointerCancel(target, { ...pointer, clientY: ys[ys.length - 1] });
  }
};

afterEach(realClock);

describe("the Frames drawer with a talk", () => {
  describe("when it opens", () => {
    beforeEach(async () => {
      await mount([
        slide("frame-the-lair"),
        slide("frame-valley-of-the-sun", false),
        slide("frame-thunderwrench"),
        slide("frame-registry"),
      ]);
    });

    it("should show the Slides view", () => {
      expect(screen.getByRole("button", { name: "Slides" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("should list the slides in the host's order", () => {
      expect(rows()).toEqual([
        "frame-the-lair",
        "frame-valley-of-the-sun",
        "frame-thunderwrench",
        "frame-registry",
      ]);
    });

    it("should number the included slides and dash the skipped one", () => {
      expect(
        rows().map(
          (id) => row(id!).querySelector(".frames-menu__number")?.textContent,
        ),
      ).toEqual(["1", "–", "2", "3"]);
    });

    it("should mark the frame the view is in", () => {
      expect(row("frame-valley-of-the-sun")).toHaveAttribute(
        "aria-current",
        "location",
      );
    });
  });

  describe("when the order lacks a frame and names one no longer on the board", () => {
    beforeEach(async () => {
      await mount([
        slide("frame-the-lair"),
        slide("frame-ghost-town"),
        slide("frame-valley-of-the-sun"),
        slide("frame-registry"),
      ]);
    });

    it("should drop the dead one and append the missing one", () => {
      expect(rows()).toEqual([
        "frame-the-lair",
        "frame-valley-of-the-sun",
        "frame-registry",
        "frame-thunderwrench",
      ]);
    });
  });

  describe.each(["pen", "touch", "mouse"])(
    "when the first slide's grip is dragged by %s below the third slide",
    (pointerType) => {
      beforeEach(async () => {
        await mount(talk);
        layOut();
        stroke(grip("frame-the-lair"), pointerType, [
          middle(0),
          middle(1),
          middle(2) + 10,
        ]);
      });

      it("should hand the host the new order once", () => {
        expect(onChange.mock.calls).toEqual([
          [
            [
              slide("frame-valley-of-the-sun"),
              slide("frame-thunderwrench"),
              slide("frame-the-lair"),
              slide("frame-registry"),
            ],
          ],
        ]);
      });

      it("should show the host's new order", () => {
        expect(rows()).toEqual([
          "frame-valley-of-the-sun",
          "frame-thunderwrench",
          "frame-the-lair",
          "frame-registry",
        ]);
      });
    },
  );

  describe("when a drag is cancelled", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      stroke(
        grip("frame-the-lair"),
        "pen",
        [middle(0), middle(2) + 10],
        "cancel",
      );
    });

    it("should leave the order alone", () => {
      expect(onChange).not.toHaveBeenCalled();
    });

    describe("and another slide is dragged", () => {
      beforeEach(() => {
        stroke(grip("frame-thunderwrench"), "pen", [middle(2), middle(1) - 10]);
      });

      it("should move that one", () => {
        expect(rows()).toEqual([
          "frame-the-lair",
          "frame-thunderwrench",
          "frame-valley-of-the-sun",
          "frame-registry",
        ]);
      });
    });
  });

  describe("when Escape is pressed during a drag", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      const target = grip("frame-the-lair");
      hold(target, middle(0), middle(2) + 10);
      fireEvent.keyDown(document, { key: KEYS.ESCAPE });
      fireEvent.pointerUp(target, { ...pen, clientY: middle(2) + 10 });
    });

    it("should leave the order alone", () => {
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should keep the drawer open", () => {
      expect(h.state.openSidebar?.tab).toBe(FRAMES_SIDEBAR_TAB);
    });
  });

  describe("when a slide is dropped where it started", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      stroke(grip("frame-valley-of-the-sun"), "pen", [
        middle(1),
        middle(0) + 10,
        middle(2) - 10,
        middle(1) + 5,
      ]);
    });

    it("should leave the order alone", () => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("when a frame above the held slide is deleted mid-drag", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      hold(grip("frame-registry"), middle(3), 2);
      // a collaborator, an agent or an undo takes the first slide's frame
      removeFrame("frame-the-lair");
      fireEvent.pointerUp(grip("frame-registry"), { ...pen, clientY: 2 });
    });

    it("should leave the order alone", () => {
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should stop sorting", () => {
      expect(sorting()).toBe(false);
    });

    it("should list the frames still on the board", () => {
      expect(rows()).toEqual([
        "frame-valley-of-the-sun",
        "frame-thunderwrench",
        "frame-registry",
      ]);
    });

    describe("and the slide is dragged again", () => {
      beforeEach(() => {
        layOut();
        stroke(grip("frame-registry"), "pen", [middle(2), 2]);
      });

      it("should hand the host only the frames on the board", () => {
        expect(onChange.mock.calls).toEqual([
          [
            [
              slide("frame-registry"),
              slide("frame-valley-of-the-sun"),
              slide("frame-thunderwrench"),
            ],
          ],
        ]);
      });
    });
  });

  describe("when the host reorders the talk mid-drag", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      hold(grip("frame-valley-of-the-sun"), middle(1), middle(3) + 10);
      act(() => {
        reorder([
          slide("frame-valley-of-the-sun"),
          slide("frame-the-lair"),
          slide("frame-thunderwrench"),
          slide("frame-registry"),
        ]);
      });
      fireEvent.pointerUp(grip("frame-valley-of-the-sun"), {
        ...pen,
        clientY: middle(3) + 10,
      });
    });

    it("should drop the drag rather than move another slide", () => {
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should show the host's order", () => {
      expect(rows()).toEqual([
        "frame-valley-of-the-sun",
        "frame-the-lair",
        "frame-thunderwrench",
        "frame-registry",
      ]);
    });

    describe("and the slide is dragged again", () => {
      beforeEach(() => {
        layOut();
        stroke(grip("frame-valley-of-the-sun"), "pen", [
          middle(0),
          middle(3) + 10,
        ]);
      });

      it("should move the slide the pen holds", () => {
        expect(onChange.mock.calls).toEqual([
          [
            [
              slide("frame-the-lair"),
              slide("frame-thunderwrench"),
              slide("frame-registry"),
              slide("frame-valley-of-the-sun"),
            ],
          ],
        ]);
      });
    });
  });

  describe("when the host skips another slide mid-drag", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      hold(grip("frame-the-lair"), middle(0), middle(2) + 10);
      act(() => {
        reorder([
          slide("frame-the-lair"),
          slide("frame-valley-of-the-sun"),
          slide("frame-thunderwrench", false),
          slide("frame-registry"),
        ]);
      });
      fireEvent.pointerUp(grip("frame-the-lair"), {
        ...pen,
        clientY: middle(2) + 10,
      });
    });

    it("should still move the held slide, keeping the skip", () => {
      expect(onChange.mock.calls).toEqual([
        [
          [
            slide("frame-valley-of-the-sun"),
            slide("frame-thunderwrench", false),
            slide("frame-the-lair"),
            slide("frame-registry"),
          ],
        ],
      ]);
    });
  });

  describe("when the held slide's frame is deleted mid-drag and the pen lifts off the list", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      hold(grip("frame-registry"), middle(3), middle(2));
      removeFrame("frame-registry");
      // the grip went with its frame, so the lift lands on the canvas
      fireEvent.pointerUp(document.body, { ...pen, clientY: 900 });
    });

    it("should stop sorting", () => {
      expect(sorting()).toBe(false);
    });

    it("should leave the order alone", () => {
      expect(onChange).not.toHaveBeenCalled();
    });

    describe("and another slide is dragged", () => {
      beforeEach(() => {
        layOut();
        stroke(grip("frame-the-lair"), "pen", [middle(0), middle(2) + 10]);
      });

      it("should move it", () => {
        expect(onChange.mock.calls).toEqual([
          [
            [
              slide("frame-valley-of-the-sun"),
              slide("frame-thunderwrench"),
              slide("frame-the-lair"),
            ],
          ],
        ]);
      });
    });
  });

  describe("when the grip loses the pen mid-drag", () => {
    beforeEach(async () => {
      await mount(talk);
      layOut();
      const target = grip("frame-the-lair");
      hold(target, middle(0), middle(2) + 10);
      fireEvent.lostPointerCapture(target, pen);
      fireEvent.pointerUp(document.body, { ...pen, clientY: middle(2) + 10 });
    });

    it("should stop sorting", () => {
      expect(sorting()).toBe(false);
    });

    it("should leave the order alone", () => {
      expect(onChange).not.toHaveBeenCalled();
    });

    describe("and another slide is dragged", () => {
      beforeEach(() => {
        stroke(grip("frame-thunderwrench"), "pen", [middle(2), middle(1) - 10]);
      });

      it("should move that one", () => {
        expect(rows()).toEqual([
          "frame-the-lair",
          "frame-thunderwrench",
          "frame-valley-of-the-sun",
          "frame-registry",
        ]);
      });
    });
  });

  describe("when a slide is held still at the bottom of a list too long for the drawer", () => {
    let scrollTop: number;

    beforeEach(async () => {
      await mount(talk);
      layOut();
      scrollTop = 0;
      const list = document.querySelector<HTMLElement>(".frames-menu__slides")!;
      Object.defineProperties(list, {
        clientHeight: { value: 3 * ROW_PX },
        scrollHeight: { value: 4 * ROW_PX },
        scrollTop: {
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = Math.min(Math.max(value, 0), ROW_PX);
          },
        },
      });
      list.getBoundingClientRect = () => box(0, 3 * ROW_PX);
      const bottom = 3 * ROW_PX - 5;
      const target = grip("frame-the-lair");
      hold(target, middle(0), bottom);
      // the pen rests at the edge for a moment, sending no moves
      act(() => {
        vi.advanceTimersByTime(300);
      });
      fireEvent.pointerUp(target, { ...pen, clientY: bottom });
    });

    it("should scroll the list to its end", () => {
      expect(scrollTop).toBe(ROW_PX);
    });

    it("should carry the slide past the rows scrolled into view", () => {
      expect(rows()).toEqual([
        "frame-valley-of-the-sun",
        "frame-thunderwrench",
        "frame-registry",
        "frame-the-lair",
      ]);
    });
  });

  describe("when Alt+ArrowDown is pressed on a grip", () => {
    beforeEach(async () => {
      await mount(talk);
      grip("frame-the-lair").focus();
      fireEvent.keyDown(grip("frame-the-lair"), {
        key: KEYS.ARROW_DOWN,
        altKey: true,
      });
    });

    it("should move that slide down one", () => {
      expect(onChange).toHaveBeenCalledWith([
        slide("frame-valley-of-the-sun"),
        slide("frame-the-lair"),
        slide("frame-thunderwrench"),
        slide("frame-registry"),
      ]);
    });

    it("should keep focus on its grip", () => {
      expect(document.activeElement).toBe(grip("frame-the-lair"));
    });
  });

  describe("when a slide's eye is tapped", () => {
    beforeEach(async () => {
      await mount(talk);
      fireEvent.click(
        screen.getByRole("button", { name: "Skip frame-valley-of-the-sun" }),
      );
    });

    it("should ask the host to skip it", () => {
      expect(onChange).toHaveBeenCalledWith([
        slide("frame-the-lair"),
        slide("frame-valley-of-the-sun", false),
        slide("frame-thunderwrench"),
        slide("frame-registry"),
      ]);
    });

    it("should offer to include it again", () => {
      expect(
        screen.getByRole("button", { name: "Include frame-valley-of-the-sun" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("when Present is tapped", () => {
    beforeEach(async () => {
      await mount(talk);
      fireEvent.click(screen.getByRole("button", { name: "Present" }));
    });

    it("should ask the host to present", () => {
      expect(onPresent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when every slide is skipped", () => {
    beforeEach(async () => {
      await mount(talk.map(({ frameId }) => slide(frameId, false)));
    });

    it("should not offer to present", () => {
      expect(screen.getByRole("button", { name: "Present" })).toBeDisabled();
    });
  });

  describe("when the board has no frames", () => {
    beforeEach(async () => {
      await mount([], []);
    });

    it("should say how to make the first slide", () => {
      expect(
        screen.getByText("Draw a frame (F) to make your first slide."),
      ).toBeInTheDocument();
    });
  });

  describe("when a slide is tapped", () => {
    beforeEach(async () => {
      await mount(talk);
      fireEvent.click(row("frame-thunderwrench"));
      await settle();
    });

    it("should fly there", () => {
      expect(here()).toBe("frame-thunderwrench");
    });
  });

  describe("when the Frames view is picked", () => {
    beforeEach(async () => {
      await mount(talk);
      fireEvent.click(
        screen.getByRole("button", { name: "Frames", pressed: false }),
      );
    });

    it("should show the frame tree", () => {
      expect(
        document.querySelector(".frames-menu__tree [data-frame]"),
      ).not.toBeNull();
    });

    it("should hide the slides", () => {
      expect(document.querySelector(".frames-menu__slides")).toBeNull();
    });
  });
});

describe("the Frames drawer without a talk", () => {
  beforeEach(async () => {
    const nav: FrameNavigation = {};
    await render(<Excalidraw frameNavigation={nav} initialData={openDrawer} />);
    API.setElements(board);
  });

  it("should offer no Slides view", () => {
    expect(screen.queryByRole("button", { name: "Slides" })).toBeNull();
  });

  it("should show the frame tree", () => {
    expect(
      document.querySelector(".frames-menu__tree [data-frame]"),
    ).not.toBeNull();
  });
});
