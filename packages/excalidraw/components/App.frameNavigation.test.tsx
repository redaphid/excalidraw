import React from "react";
import { vi } from "vitest";

import {
  DEFAULT_SIDEBAR,
  FRAMES_SIDEBAR_TAB,
  KEYS,
  LIBRARY_SIDEBAR_TAB,
  POINTER_BUTTON,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { frameModel, slideOrder } from "../frameNavigation";
import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import {
  arrowBetween,
  breadcrumb,
  fakeClock,
  frame,
  here,
  realClock,
  settle,
  showView,
} from "../tests/helpers/frames";
import { Keyboard, Pointer, UI } from "../tests/helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  screen,
  waitFor,
} from "../tests/test-utils";

import App from "./App";
import { CommandPalette } from "./CommandPalette/CommandPalette";

import type { MockInstance } from "vitest";

import type { FrameNavigation, Slide } from "../types";

const { h } = window;
const mouse = new Pointer("mouse");

type Box = { x: number; y: number; width: number; height: number };

/** `null` mounts the editor without frame navigation */
const mount = async (
  elements: readonly ExcalidrawElement[],
  nav: FrameNavigation | null = {},
) => {
  await render(
    <Excalidraw handleKeyboardGlobally frameNavigation={nav ?? undefined} />,
  );
  fakeClock();
  API.setElements(elements);
};

const press = async (key: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(document, { key, ...init });
  fireEvent.keyUp(document, { key, ...init });
  await settle();
};

afterEach(realClock);

describe("the frame the view is in", () => {
  const board = [
    frame("frame-overview", 0, 0, 1700, 980),
    frame("frame-board-do", 1300, 260, 340, 330),
    frame("frame-the-lair", 3000, 0),
    frame("frame-tiny-centre", 800, 450, 100, 80),
  ];
  const cases: [string, ExcalidrawElement[], Box, string | null][] = [
    [
      "the overview, not a frame nested in it, when the view shows the whole overview",
      board,
      { x: -50, y: -50, width: 1800, height: 1080 },
      "frame-overview",
    ],
    [
      "the nested frame when the view is zoomed into it",
      board,
      { x: 1280, y: 250, width: 380, height: 350 },
      "frame-board-do",
    ],
    [
      "the overview when the whole of it is in view around a large frame at its centre",
      [...board, frame("frame-big-middle", 450, 240, 800, 500)],
      { x: -50, y: -50, width: 1800, height: 1080 },
      "frame-overview",
    ],
    [
      "still the overview when the view is zoomed far into its corner",
      board,
      { x: 10, y: 10, width: 100, height: 60 },
      "frame-overview",
    ],
    [
      "the nested frame, not the overview, when the view fits it with a margin",
      board,
      { x: 1200, y: 200, width: 540, height: 450 },
      "frame-board-do",
    ],
    [
      "none when the view shows empty canvas with a frame barely at its edge",
      board,
      { x: 2000, y: 0, width: 1050, height: 600 },
      null,
    ],
    [
      "the overview when frames have fractional coordinates",
      [
        frame("frame-overview", 12.4, -30.8, 1700.3, 980.6),
        frame("frame-hero", 512.7, 230.1, 800.9, 500.3),
      ],
      { x: -37.6, y: -80.8, width: 1800.3, height: 1080.6 },
      "frame-overview",
    ],
    [
      "the section, not the slide inside it, when zoom rounding leaves its edge a hair outside",
      [
        frame("frame-section", 0, 2000, 1400, 700),
        frame("frame-slide", 20, 2020, 1360, 660),
      ],
      { x: 0, y: 1900, width: 1399.9999, height: 900 },
      "frame-section",
    ],
    [
      "a tall narrow frame just fitted, though it covers little of the view",
      [frame("frame-tall-tower", 0, 0, 400, 1600)],
      { x: -1265, y: -100, width: 2930, height: 1800 },
      "frame-tall-tower",
    ],
    [
      "a wide title strip just fitted",
      [frame("frame-title-strip", 0, 0, 2000, 100)],
      { x: -60, y: -610, width: 2120, height: 1320 },
      "frame-title-strip",
    ],
    [
      "none when a small frame alone sits under the centre of a whole-board view",
      [frame("frame-pebble", 1900, 600, 300, 200)],
      { x: 0, y: 0, width: 4200, height: 1400 },
      null,
    ],
    [
      "the one under the centre when the smaller of two side-by-side frames fills a third of the view",
      [
        frame("frame-valley-of-the-sun", 0, 0, 400, 300),
        frame("frame-the-lair", 450, 0, 200, 300),
      ],
      { x: 50, y: 0, width: 600, height: 300 },
      "frame-valley-of-the-sun",
    ],
  ];

  describe.each(cases)(
    "when it should be %s",
    (_, elements, view, expected) => {
      beforeEach(async () => {
        await mount(elements);
        showView(view);
      });

      it("should show it in the breadcrumb", () => {
        expect(here()).toBe(expected);
      });
    },
  );

  describe("when a whole-board view shows a wide header above a four by three grid of slides", () => {
    beforeEach(async () => {
      await mount([
        frame("frame-header", 0, 0, 4000, 300),
        ...[0, 1, 2].flatMap((row) =>
          [0, 1, 2, 3].map((col) =>
            frame(
              `frame-slide-${row}-${col}`,
              col * 1000,
              500 + row * 700,
              900,
              600,
            ),
          ),
        ),
      ]);
      showView({ x: -100, y: -100, width: 4200, height: 2700 });
    });

    it("should not pick the header just because it is fully on screen", () => {
      expect(here()).not.toBe("frame-header");
    });
  });

  describe("when the view is in a nested frame", () => {
    beforeEach(async () => {
      await mount([
        frame("frame-overview", 0, 0, 1700, 980),
        frame("frame-board-do", 1300, 260, 340, 330),
        frame("frame-element-row", 1333, 345, 130, 110),
      ]);
      showView({ x: 1333, y: 345, width: 130, height: 110 });
    });

    it("should show the path from the outermost frame down to it", () => {
      expect(breadcrumb()).toEqual([
        "frame-overview",
        "frame-board-do",
        "frame-element-row",
      ]);
    });
  });

  describe("when an unnamed frame is current", () => {
    beforeEach(async () => {
      await mount([{ ...frame("frame-nameless", 0, 0), name: null }]);
      showView({ x: 0, y: 0, width: 400, height: 300 });
    });

    it("should use the title the canvas shows", () => {
      expect(here()).toBe("Frame");
    });
  });

  describe("when a frame is renamed with no change to the view", () => {
    beforeEach(async () => {
      await mount([frame("frame-valley-of-the-sun", 0, 0)]);
      showView({ x: 0, y: 0, width: 400, height: 300 });
      act(() => {
        h.app.scene.mutateElement(h.app.scene.getNonDeletedFramesLikes()[0], {
          name: "The Lair",
        });
      });
    });

    it("should show the new name", () => {
      expect(here()).toBe("The Lair");
    });
  });

  describe("when frameNavigation is off", () => {
    beforeEach(async () => {
      await mount([frame("frame-valley-of-the-sun", 0, 0)], null);
      showView({ x: 0, y: 0, width: 400, height: 300 });
    });

    it("should show no breadcrumb", () => {
      expect(document.querySelector(".frame-breadcrumb")).toBeNull();
    });
  });
});

describe("arrow keys", () => {
  const valley = { x: 0, y: 0, width: 400, height: 300 };
  const row = [
    frame("frame-valley-of-the-sun", 0, 0),
    frame("frame-the-lair", 600, 0),
    frame("frame-far-east", 3000, 400),
    frame("frame-thunderwrench", 0, 600),
    frame("frame-rusty-conquistador", -600, 0),
  ];
  const sunToEast = () =>
    arrowBetween(
      "arrow-sun-to-east",
      "frame-valley-of-the-sun",
      "frame-far-east",
    );
  const cases: [string, ExcalidrawElement[], string, string | null][] = [
    [
      "follow a link past the nearer unlinked frame",
      [...row, sunToEast()],
      KEYS.ARROW_RIGHT,
      "frame-far-east",
    ],
    [
      "fall back to the nearest frame that way where no link points",
      [...row, sunToEast()],
      KEYS.ARROW_LEFT,
      "frame-rusty-conquistador",
    ],
    [
      "take the link whose direction matches best",
      [
        ...row,
        sunToEast(),
        arrowBetween(
          "arrow-sun-to-lair",
          "frame-valley-of-the-sun",
          "frame-the-lair",
        ),
      ],
      KEYS.ARROW_RIGHT,
      "frame-the-lair",
    ],
    [
      "take the straighter link, not the nearer one",
      [
        ...row,
        frame("frame-slanted-shack", 300, 400),
        arrowBetween(
          "arrow-sun-to-shack",
          "frame-valley-of-the-sun",
          "frame-slanted-shack",
        ),
        arrowBetween(
          "arrow-sun-to-thunder",
          "frame-valley-of-the-sun",
          "frame-thunderwrench",
        ),
      ],
      KEYS.ARROW_DOWN,
      "frame-thunderwrench",
    ],
    [
      "follow an arrow that points into the current frame back",
      [
        ...row,
        arrowBetween(
          "arrow-east-to-sun",
          "frame-far-east",
          "frame-valley-of-the-sun",
        ),
      ],
      KEYS.ARROW_RIGHT,
      "frame-far-east",
    ],
    [
      "go to the nearest frame below when nothing links",
      row,
      KEYS.ARROW_DOWN,
      "frame-thunderwrench",
    ],
    [
      "stay put when nothing lies that way",
      row,
      KEYS.ARROW_UP,
      "frame-valley-of-the-sun",
    ],
    [
      "not jump to the only frame that way when it is well off the axis",
      [
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-thunderwrench", 500, 1500),
      ],
      KEYS.ARROW_RIGHT,
      "frame-valley-of-the-sun",
    ],
    [
      "not follow deleted, half-bound, shape-bound or looping arrows, or lines",
      [
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-off-axis", 500, 3000),
        API.createElement({ type: "rectangle", id: "rect-rusty", x: 3000 }),
        {
          ...arrowBetween(
            "arrow-deleted",
            "frame-valley-of-the-sun",
            "frame-off-axis",
          ),
          isDeleted: true,
        },
        {
          ...arrowBetween(
            "arrow-loose",
            "frame-valley-of-the-sun",
            "frame-off-axis",
          ),
          endBinding: null,
        },
        arrowBetween("arrow-to-rect", "frame-valley-of-the-sun", "rect-rusty"),
        arrowBetween(
          "arrow-loop",
          "frame-valley-of-the-sun",
          "frame-valley-of-the-sun",
        ),
        {
          ...API.createElement({ type: "line", id: "line-sun-to-off-axis" }),
          ...arrowBetween("x", "frame-valley-of-the-sun", "frame-off-axis"),
          id: "line-sun-to-off-axis",
          type: "line",
        },
      ],
      KEYS.ARROW_RIGHT,
      "frame-valley-of-the-sun",
    ],
  ];

  describe.each(cases)("when they should %s", (_, elements, key, expected) => {
    beforeEach(async () => {
      await mount(elements);
      showView(valley);
      await press(key);
    });

    it("should land there", () => {
      expect(here()).toBe(expected);
    });
  });

  describe("when the current frame sits inside a parent with a sibling beside it", () => {
    beforeEach(async () => {
      await mount([
        frame("frame-overview", -100, -100, 1400, 600),
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-the-lair", 600, 0),
      ]);
      showView(valley);
      await press(KEYS.ARROW_RIGHT);
    });

    it("should go to the sibling, never the parent around it", () => {
      expect(here()).toBe("frame-the-lair");
    });
  });

  describe("when no frame is current", () => {
    beforeEach(async () => {
      await mount(row);
      showView({ x: -1400, y: 0, width: 400, height: 300 });
      await press(KEYS.ARROW_RIGHT);
    });

    it("should go to the nearest frame right of the view", () => {
      expect(here()).toBe("frame-rusty-conquistador");
    });
  });

  describe("when two are pressed in quick succession", () => {
    beforeEach(async () => {
      await mount([
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-the-lair", 600, 0),
        frame("frame-rusty-conquistador", 1200, 0),
      ]);
      showView(valley);
      Keyboard.keyPress(KEYS.ARROW_RIGHT);
      await press(KEYS.ARROW_RIGHT);
    });

    it("should step on from where the first one lands", () => {
      expect(here()).toBe("frame-rusty-conquistador");
    });
  });

  describe.each([
    ["an element is selected", {}, true],
    ["shift is held", { shiftKey: true }, false],
    ["cmd is held", { metaKey: true }, false],
  ])("when %s", (_, init, select) => {
    beforeEach(async () => {
      await mount(row);
      showView(valley);
      if (select) {
        API.setSelectedElements([h.app.scene.getNonDeletedElements()[0]]);
      }
      await press(KEYS.ARROW_RIGHT, init);
    });

    it("should leave the view where it was", () => {
      expect(here()).toBe("frame-valley-of-the-sun");
    });
  });

  describe("when frameNavigation is off", () => {
    let before: { scrollX: number; scrollY: number };

    beforeEach(async () => {
      await mount(row, null);
      showView(valley);
      before = { scrollX: h.state.scrollX, scrollY: h.state.scrollY };
      await press(KEYS.ARROW_RIGHT);
    });

    it("should leave the view where it was", () => {
      expect({ scrollX: h.state.scrollX, scrollY: h.state.scrollY }).toEqual(
        before,
      );
    });
  });
});

describe("bookmark keys", () => {
  beforeEach(async () => {
    await mount(
      [
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-the-lair", 600, 0),
        frame("frame-thunderwrench", 0, 600),
      ],
      {
        bookmarks: [
          "frame-ghost-town",
          "frame-the-lair",
          "frame-thunderwrench",
        ],
      },
    );
    showView({ x: 0, y: 0, width: 400, height: 300 });
  });

  describe("when ⌥2 is pressed, which macOS turns into a symbol", () => {
    beforeEach(async () => {
      await press("™", { code: "Digit2", altKey: true });
    });

    it("should fly to the second bookmark still on the board", () => {
      expect(here()).toBe("frame-thunderwrench");
    });
  });

  describe.each([
    ["a bare digit", { key: "2", code: "Digit2" }],
    ["⌥0", { key: "º", code: "Digit0", altKey: true }],
    [
      "⌥ with a bookmark past the end",
      { key: "ª", code: "Digit9", altKey: true },
    ],
  ])("when %s is pressed", (_, { key, ...init }) => {
    beforeEach(async () => {
      await press(key, init);
    });

    it("should leave the view where it was", () => {
      expect(here()).toBe("frame-valley-of-the-sun");
    });
  });
});

describe("slideOrder", () => {
  const model = frameModel([
    frame("frame-valley-of-the-sun", 0, 0),
    frame("frame-the-lair", 600, 0),
    frame("frame-thunderwrench", 0, 600),
  ]);
  const cases: [string, Slide[], Slide[]][] = [
    [
      "keep the host's order and what it skips",
      [
        { frameId: "frame-thunderwrench", included: true },
        { frameId: "frame-valley-of-the-sun", included: false },
        { frameId: "frame-the-lair", included: true },
      ],
      [
        { frameId: "frame-thunderwrench", included: true },
        { frameId: "frame-valley-of-the-sun", included: false },
        { frameId: "frame-the-lair", included: true },
      ],
    ],
    [
      "drop a frame no longer on the board and a repeat",
      [
        { frameId: "frame-the-lair", included: false },
        { frameId: "frame-ghost-town", included: true },
        { frameId: "frame-the-lair", included: true },
        { frameId: "frame-valley-of-the-sun", included: true },
        { frameId: "frame-thunderwrench", included: true },
      ],
      [
        { frameId: "frame-the-lair", included: false },
        { frameId: "frame-valley-of-the-sun", included: true },
        { frameId: "frame-thunderwrench", included: true },
      ],
    ],
    [
      "append the frames it lacks in scene order, included",
      [{ frameId: "frame-thunderwrench", included: false }],
      [
        { frameId: "frame-thunderwrench", included: false },
        { frameId: "frame-valley-of-the-sun", included: true },
        { frameId: "frame-the-lair", included: true },
      ],
    ],
  ];

  it.each(cases)("should %s", (_, order, expected) => {
    expect(slideOrder(model, order)).toEqual(expected);
  });
});

describe("the drawer key", () => {
  const board = [
    frame("frame-valley-of-the-sun", 0, 0),
    frame("frame-the-lair", 600, 0),
  ];

  describe("when M is pressed with an element selected", () => {
    beforeEach(async () => {
      await mount(board);
      API.setSelectedElements([h.app.scene.getNonDeletedElements()[0]]);
      Keyboard.keyPress("m");
    });

    it("should open the Frames tab of the default sidebar", () => {
      expect(h.state.openSidebar).toEqual({
        name: DEFAULT_SIDEBAR.name,
        tab: FRAMES_SIDEBAR_TAB,
      });
    });
  });

  describe("when M is pressed twice", () => {
    beforeEach(async () => {
      await mount(board);
      Keyboard.keyPress("m");
      Keyboard.keyPress("m");
    });

    it("should close it again", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when M closes the drawer while a frame row has focus", () => {
    beforeEach(async () => {
      await mount(board);
      Keyboard.keyPress("m");
      document
        .querySelector<HTMLButtonElement>('[data-frame="frame-the-lair"]')!
        .focus();
      fireEvent.keyDown(document.activeElement!, { key: "m" });
    });

    it("should hand focus back to the editor", () => {
      expect(document.activeElement).toBe(
        document.querySelector(".excalidraw-container"),
      );
    });
  });

  describe("when M is pressed with cmd held", () => {
    beforeEach(async () => {
      await mount(board);
      fireEvent.keyDown(document, { key: "m", metaKey: true });
    });

    it("should leave the sidebar closed", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe.each([
    ["on a board without frames", [], {}],
    ["with frameNavigation off", board, null],
  ])("when M is pressed %s", (_, elements, nav) => {
    beforeEach(async () => {
      await mount(elements, nav);
      Keyboard.keyPress("m");
    });

    it("should leave the sidebar closed", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when the help dialog is open", () => {
    beforeEach(async () => {
      await mount(board);
      Keyboard.keyPress("?");
    });

    it("should list the drawer key", () => {
      expect(document.querySelector(".HelpDialog")?.textContent).toContain(
        "FramesM",
      );
    });
  });
});

describe("the frame tool", () => {
  const board = [
    frame("frame-valley-of-the-sun", 0, 0),
    frame("frame-the-lair", 600, 0),
  ];
  const drawer = { name: DEFAULT_SIDEBAR.name, tab: FRAMES_SIDEBAR_TAB };

  const mountOnPhone = async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally
        frameNavigation={{}}
        UIOptions={{ getFormFactor: () => "phone" }}
      />,
    );
    fireEvent.resize(window);
    await waitFor(() => expect(h.app.editorInterface.formFactor).toBe("phone"));
    fakeClock();
    API.setElements(board);
  };

  const closeDrawer = () =>
    act(() => {
      h.app.toggleSidebar({ name: null });
    });

  /** the pen turned over, its eraser end pressed to the canvas and lifted */
  const eraserEnd = () => {
    const pen = {
      button: POINTER_BUTTON.ERASER,
      pointerType: "pen",
      clientX: 100,
      clientY: 400,
    };
    fireEvent.pointerDown(GlobalTestState.interactiveCanvas, pen);
    fireEvent.pointerUp(GlobalTestState.interactiveCanvas, pen);
  };

  describe.each([
    ["from the toolbar", () => UI.clickExtraTool("frame")],
    ["with F", () => Keyboard.keyPress("f")],
  ])("when it is picked %s", (_, pick) => {
    let focused: Element | null;

    beforeEach(async () => {
      await mount(board);
      focused = document.activeElement;
      pick();
    });

    it("should open the Frames drawer", () => {
      expect(h.state.openSidebar).toEqual(drawer);
    });

    it("should keep the frame tool", () => {
      expect(h.state.activeTool.type).toBe("frame");
    });

    it("should leave focus where it was", () => {
      expect(document.activeElement).toBe(focused);
    });
  });

  describe("when it is picked from the command palette", () => {
    beforeEach(async () => {
      await render(
        <Excalidraw handleKeyboardGlobally frameNavigation={{}}>
          <CommandPalette />
        </Excalidraw>,
      );
      fakeClock();
      API.setElements(board);
      fireEvent.keyDown(document, { key: KEYS.SLASH, ctrlKey: true });
      fireEvent.click(screen.getByText("Frame tool"));
    });

    it("should pick the tool", () => {
      expect(h.state.activeTool.type).toBe("frame");
    });

    it("should open the Frames drawer", () => {
      expect(h.state.openSidebar).toEqual(drawer);
    });
  });

  describe("when it is picked with the library open", () => {
    beforeEach(async () => {
      await mount(board);
      act(() => {
        h.app.toggleSidebar({
          name: DEFAULT_SIDEBAR.name,
          tab: LIBRARY_SIDEBAR_TAB,
        });
      });
      Keyboard.keyPress("f");
    });

    it("should switch the sidebar to the Frames drawer", () => {
      expect(h.state.openSidebar).toEqual(drawer);
    });
  });

  describe("when a frame is drawn on the canvas with the drawer it opened", () => {
    beforeEach(async () => {
      await mount(board);
      Keyboard.keyPress("f");
      mouse.reset();
      mouse.downAt(100, 400);
      mouse.moveTo(300, 550);
      mouse.up();
    });

    it("should keep the drawer open", () => {
      expect(h.state.openSidebar).toEqual(drawer);
    });

    it("should list the new frame", () => {
      const drawn = h.elements.find(
        (element) =>
          element.type === "frame" &&
          !board.some((listed) => listed.id === element.id),
      )!;
      expect(
        document.querySelector(`.frames-menu [data-frame="${drawn.id}"]`),
      ).not.toBeNull();
    });
  });

  describe("when another tool is picked after it", () => {
    beforeEach(async () => {
      await mount(board);
      Keyboard.keyPress("f");
      Keyboard.keyPress("r");
    });

    it("should leave the drawer open", () => {
      expect(h.state.openSidebar).toEqual(drawer);
    });
  });

  /** keys pressed one after another */
  const keys =
    (...pressed: string[]) =>
    () =>
      pressed.forEach((key) => Keyboard.keyPress(key));

  // a pick opens the drawer; a return to the frame tool from the eraser or
  // the hand does not, so a drawer closed meanwhile stays closed
  describe.each([
    ["E then F", keys("e", "f"), drawer],
    ["H then F", keys("h", "f"), drawer],
    [
      "H then the toolbar's frame tool",
      () => {
        Keyboard.keyPress("h");
        UI.clickExtraTool("frame");
      },
      drawer,
    ],
    ["F again", keys("f"), drawer],
    ["E, V then F", keys("e", "v", "f"), drawer],
    ["the pen's eraser end, pressed and lifted", eraserEnd, null],
    ["E twice", keys("e", "e"), null],
    ["H twice", keys("h", "h"), null],
    ["E then Escape", keys("e", KEYS.ESCAPE), null],
  ])(
    "when the drawer is closed with the frame tool in hand, then %s",
    (_, then, expected) => {
      beforeEach(async () => {
        await mount(board);
        Keyboard.keyPress("f");
        closeDrawer();
        then();
      });

      it("should be on the frame tool", () => {
        expect(h.state.activeTool.type).toBe("frame");
      });

      it(
        expected ? "should open the drawer" : "should leave the drawer closed",
        () => {
          expect(h.state.openSidebar).toEqual(expected);
        },
      );
    },
  );

  describe("when two frames are drawn with the tool locked and the drawer closed", () => {
    beforeEach(async () => {
      await mount(board);
      Keyboard.keyPress("f");
      Keyboard.keyPress("q");
      closeDrawer();
      mouse.reset();
      mouse.downAt(100, 400);
      mouse.moveTo(300, 550);
      mouse.up();
      mouse.downAt(400, 400);
      mouse.moveTo(600, 550);
      mouse.up();
    });

    it("should draw both with the frame tool still in hand", () => {
      expect(
        h.elements.filter((element) => element.type === "frame"),
      ).toHaveLength(board.length + 2);
      expect(h.state.activeTool).toMatchObject({ type: "frame", locked: true });
    });

    it("should leave the drawer closed", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when F is pressed while the host holds another tool", () => {
    beforeEach(async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await render(
        <Excalidraw
          handleKeyboardGlobally
          frameNavigation={{}}
          activeTool={{ type: "rectangle" }}
        />,
      );
      fakeClock();
      API.setElements(board);
      Keyboard.keyPress("f");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should keep the host's tool", () => {
      expect(h.state.activeTool.type).toBe("rectangle");
    });

    it("should leave the sidebar closed", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when it is picked with frameNavigation off", () => {
    beforeEach(async () => {
      await mount(board, null);
      Keyboard.keyPress("f");
    });

    it("should pick the tool", () => {
      expect(h.state.activeTool.type).toBe("frame");
    });

    it("should leave the sidebar closed", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when it is picked on a phone", () => {
    beforeEach(async () => {
      await mountOnPhone();
      Keyboard.keyPress("f");
    });

    it("should pick the tool", () => {
      expect(h.state.activeTool.type).toBe("frame");
    });

    it("should leave the sidebar closed, off the canvas", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });

  describe("when a frame is started on a phone with the drawer opened by hand", () => {
    beforeEach(async () => {
      await mountOnPhone();
      act(() => {
        h.app.toggleSidebar(drawer);
      });
      Keyboard.keyPress("f");
      mouse.reset();
      mouse.downAt(100, 400);
      mouse.up();
    });

    it("should close the drawer, as any press outside it does", () => {
      expect(h.state.openSidebar).toBeNull();
    });
  });
});

describe("frames changed after mount", () => {
  const valley = { x: 0, y: 0, width: 400, height: 300 };

  describe("when an arrow is bound between two frames after mount", () => {
    beforeEach(async () => {
      await mount([
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-off-axis", 500, 3000),
      ]);
      showView(valley);
      API.setElements([
        ...h.elements,
        arrowBetween(
          "arrow-sun-to-off-axis",
          "frame-valley-of-the-sun",
          "frame-off-axis",
        ),
      ]);
      await press(KEYS.ARROW_RIGHT);
    });

    it("should follow the new link", () => {
      expect(here()).toBe("frame-off-axis");
    });
  });

  describe("when a collaborator's rename wins a tie at the same version", () => {
    beforeEach(async () => {
      await mount([frame("frame-valley-of-the-sun", 0, 0)]);
      showView(valley);
      const [mine] = h.app.scene.getNonDeletedFramesLikes();
      API.updateScene({
        elements: [
          { ...mine, name: "The Lair", versionNonce: mine.versionNonce + 1 },
        ],
      });
    });

    it("should show their name", () => {
      expect(here()).toBe("The Lair");
    });
  });
});

describe("cost", () => {
  const board = [
    frame("frame-valley-of-the-sun", 0, 0),
    frame("frame-the-lair", 600, 0),
    API.createElement({ type: "rectangle", id: "rect-thunderwrench" }),
  ];

  describe("when an element that is no frame moves", () => {
    let before: unknown;

    beforeEach(async () => {
      await mount(board);
      before = h.app.frameNavigation.model();
      API.updateElement(h.elements[2], { x: 50 });
    });

    it("should keep the frame model", () => {
      expect(h.app.frameNavigation.model()).toBe(before);
    });
  });

  describe("when a frame moves", () => {
    let before: unknown;

    beforeEach(async () => {
      await mount(board);
      before = h.app.frameNavigation.model();
      API.updateElement(h.elements[1], { x: 650 });
    });

    it("should rebuild the frame model", () => {
      expect(h.app.frameNavigation.model()).not.toBe(before);
    });
  });

  describe("when a rectangle joined to another by a bound arrow is dragged", () => {
    let rebuilds: number;

    beforeEach(async () => {
      await mount(board);
      const thunderwrench = UI.createElement("rectangle", {
        x: 0,
        y: 400,
        width: 100,
        height: 100,
      });
      UI.createElement("rectangle", {
        x: 400,
        y: 400,
        width: 100,
        height: 100,
      });
      UI.createElement("arrow", { x: 50, y: 450, width: 400, height: 0 });
      mouse.reset();
      mouse.clickOn(thunderwrench);
      rebuilds = 0;
      let last = h.app.frameNavigation.model();
      mouse.downAt(50, 450);
      for (let i = 1; i <= 5; i++) {
        mouse.moveTo(50 + i * 10, 450);
        const model = h.app.frameNavigation.model();
        rebuilds += model === last ? 0 : 1;
        last = model;
      }
      mouse.up();
    });

    it("should keep the frame model", () => {
      expect(rebuilds).toBe(0);
    });
  });

  describe("when the view scrolls ten times with the drawer and breadcrumb showing", () => {
    let measures: MockInstance<typeof h.app.viewport.getOffsets>;

    beforeEach(async () => {
      await mount(board);
      showView({ x: 0, y: 0, width: 400, height: 300 });
      Keyboard.keyPress("m");
      await settle();
      measures = vi.spyOn(h.app.viewport, "getOffsets");
      for (let i = 1; i <= 10; i++) {
        API.setAppState({ scrollX: 24 - i });
      }
    });

    it("should measure the UI once per scroll", () => {
      expect(measures).toHaveBeenCalledTimes(10);
    });
  });

  describe("when the host re-renders with an equal inlined frameNavigation", () => {
    let renders: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      const onBookmarkChange = () => {};
      const onChange = () => {};
      const onPresent = () => {};
      const Host = () => (
        <Excalidraw
          frameNavigation={{
            bookmarks: ["frame-the-lair"],
            onBookmarkChange,
            slides: {
              order: [{ frameId: "frame-the-lair", included: true }],
              onChange,
              onPresent,
            },
          }}
        />
      );
      const { rerender } = await render(<Host />);
      renders = vi.spyOn(App.prototype, "render");
      rerender(<Host />);
    });

    afterEach(() => {
      renders.mockRestore();
    });

    it("should not re-render the editor", () => {
      expect(renders).not.toHaveBeenCalled();
    });
  });
});
