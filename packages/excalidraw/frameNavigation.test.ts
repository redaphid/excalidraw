import {
  currentFrame,
  frameKey,
  frameModel,
  framePath,
  liveBookmarks,
  nextFrame,
  viewBounds,
} from "./frameNavigation";

import type {
  Bounds,
  Direction,
  Frame,
  FrameKey,
  FrameNode,
  FrameSource,
} from "./frameNavigation";

const frame = (
  id: string,
  x: number,
  y: number,
  width = 400,
  height = 300,
): FrameSource => ({
  id,
  type: "frame",
  isDeleted: false,
  name: id,
  x,
  y,
  width,
  height,
});

const arrow = (id: string, from: string, to: string): FrameSource => ({
  id,
  type: "arrow",
  isDeleted: false,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  startBinding: { elementId: from },
  endBinding: { elementId: to },
});

const ids = (frames: readonly Frame[]) => frames.map((f) => f.id);
const shape = (nodes: readonly FrameNode[]): unknown[] =>
  nodes.map((n) => [n.frame.id, shape(n.children)]);
const current = (elements: readonly FrameSource[], view: Bounds) =>
  currentFrame(frameModel(elements), view)?.id ?? null;

describe("frameModel", () => {
  describe("when the scene mixes frames, a magic frame, deleted frames and shapes", () => {
    let result: Frame[];

    beforeEach(() => {
      result = [
        ...frameModel([
          frame("frame-valley-of-the-sun", 0, 0),
          { ...frame("frame-the-lair", 500, 0), type: "magicframe" },
          { ...frame("frame-ghost-town", 900, 0), isDeleted: true },
          { ...frame("frame-unnamed", 0, 400), name: null },
          { ...frame("rect-rusty-conquistador", 0, 0), type: "rectangle" },
        ]).frames,
      ];
    });

    it("should keep the live frames with their bounds, naming unnamed ones by position", () => {
      expect(result).toEqual([
        {
          id: "frame-valley-of-the-sun",
          name: "frame-valley-of-the-sun",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        },
        {
          id: "frame-the-lair",
          name: "frame-the-lair",
          x: 500,
          y: 0,
          width: 400,
          height: 300,
        },
        {
          id: "frame-unnamed",
          name: "Frame 3",
          x: 0,
          y: 400,
          width: 400,
          height: 300,
        },
      ]);
    });
  });

  describe("links", () => {
    let elements: FrameSource[];

    beforeEach(() => {
      elements = [
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-the-lair", 600, 0),
        frame("frame-thunderwrench", 0, 600),
        { ...frame("rect-rusty-conquistador", 1200, 0), type: "rectangle" },
      ];
    });

    describe("when an arrow binds two frames", () => {
      let result: ReadonlyMap<string, ReadonlySet<string>>;

      beforeEach(() => {
        result = frameModel([
          ...elements,
          arrow(
            "arrow-sun-to-lair",
            "frame-valley-of-the-sun",
            "frame-the-lair",
          ),
        ]).links;
      });

      it("should link them both ways", () => {
        expect(result).toEqual(
          new Map([
            ["frame-valley-of-the-sun", new Set(["frame-the-lair"])],
            ["frame-the-lair", new Set(["frame-valley-of-the-sun"])],
          ]),
        );
      });
    });

    describe("when arrows are deleted, half-bound, bound to a shape or to the same frame", () => {
      let result: ReadonlyMap<string, ReadonlySet<string>>;

      beforeEach(() => {
        result = frameModel([
          ...elements,
          {
            ...arrow(
              "arrow-deleted",
              "frame-valley-of-the-sun",
              "frame-the-lair",
            ),
            isDeleted: true,
          },
          { ...arrow("arrow-loose", "frame-the-lair", "x"), endBinding: null },
          arrow("arrow-to-rect", "frame-the-lair", "rect-rusty-conquistador"),
          arrow("arrow-loop", "frame-thunderwrench", "frame-thunderwrench"),
          {
            ...arrow(
              "line-sun-to-lair",
              "frame-valley-of-the-sun",
              "frame-the-lair",
            ),
            type: "line",
          },
        ]).links;
      });

      it("should link nothing", () => {
        expect(result.size).toBe(0);
      });
    });
  });

  describe("tree", () => {
    describe("when frames nest inside each other", () => {
      let result: readonly FrameNode[];

      beforeEach(() => {
        result = frameModel([
          frame("frame-board-do", 1300, 260, 340, 330),
          frame("frame-overview", 0, 0, 1700, 980),
          frame("frame-element-row", 1333, 345, 130, 110),
          frame("frame-registry", 1300, 0, 300, 200),
          frame("frame-the-lair", 2000, 0),
        ]).tree;
      });

      it("should hang each under the smallest frame around it, in reading order", () => {
        expect(shape(result)).toEqual([
          [
            "frame-overview",
            [
              ["frame-registry", []],
              ["frame-board-do", [["frame-element-row", []]]],
            ],
          ],
          ["frame-the-lair", []],
        ]);
      });
    });

    describe("when frames have fractional coordinates", () => {
      let result: readonly FrameNode[];

      beforeEach(() => {
        result = frameModel([
          frame("frame-overview", 12.4, -30.8, 1700.3, 980.6),
          frame("frame-hero", 512.7, 230.1, 800.9, 500.3),
        ]).tree;
      });

      it("should still nest the inner frame", () => {
        expect(shape(result)).toEqual([
          ["frame-overview", [["frame-hero", []]]],
        ]);
      });
    });
  });
});

describe("frameKey", () => {
  const press = (key: string, rest: Partial<KeyboardEventInit> = {}) => ({
    key,
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...rest,
  });
  let result: FrameKey | null;

  describe("when an arrow key is pressed with nothing selected", () => {
    beforeEach(() => {
      result = frameKey(press("ArrowUp"), { selecting: false });
    });

    it("should step up", () => {
      expect(result).toEqual({ kind: "step", direction: "up" });
    });
  });

  describe("when an arrow key is pressed with an element selected", () => {
    beforeEach(() => {
      result = frameKey(press("ArrowLeft"), { selecting: true });
    });

    it("should leave it to the editor to nudge the selection", () => {
      expect(result).toBeNull();
    });
  });

  describe("when shift is held with an arrow key", () => {
    beforeEach(() => {
      result = frameKey(press("ArrowRight", { shiftKey: true }), {
        selecting: false,
      });
    });

    it("should be null", () => {
      expect(result).toBeNull();
    });
  });

  describe("when the drawer key is pressed with an element selected", () => {
    beforeEach(() => {
      result = frameKey(press("m"), { selecting: true });
    });

    it("should toggle the drawer", () => {
      expect(result).toEqual({ kind: "drawer" });
    });
  });

  describe("when option and a digit are pressed, which macOS turns into a symbol", () => {
    beforeEach(() => {
      result = frameKey(press("™", { code: "Digit2", altKey: true }), {
        selecting: false,
      });
    });

    it("should jump to the second bookmark", () => {
      expect(result).toEqual({ kind: "bookmark", index: 1 });
    });
  });

  describe("when a bare digit is pressed", () => {
    beforeEach(() => {
      result = frameKey(press("2", { code: "Digit2" }), { selecting: false });
    });

    it("should leave it to the editor as a tool shortcut", () => {
      expect(result).toBeNull();
    });
  });

  describe("when option and zero are pressed", () => {
    beforeEach(() => {
      result = frameKey(press("º", { code: "Digit0", altKey: true }), {
        selecting: false,
      });
    });

    it("should be null", () => {
      expect(result).toBeNull();
    });
  });

  describe("when the frame tool key is pressed", () => {
    beforeEach(() => {
      result = frameKey(press("f"), { selecting: false });
    });

    it("should leave it to the editor", () => {
      expect(result).toBeNull();
    });
  });

  describe("when cmd is held with the drawer key", () => {
    beforeEach(() => {
      result = frameKey(press("m", { metaKey: true }), { selecting: false });
    });

    it("should be null", () => {
      expect(result).toBeNull();
    });
  });
});

describe("liveBookmarks", () => {
  describe("when a bookmarked frame was deleted", () => {
    let result: string[];

    beforeEach(() => {
      result = ids(
        liveBookmarks(
          frameModel([
            frame("frame-valley-of-the-sun", 0, 0),
            frame("frame-the-lair", 600, 0),
          ]),
          ["frame-the-lair", "frame-ghost-town", "frame-valley-of-the-sun"],
        ),
      );
    });

    it("should keep the live ones in bookmark order", () => {
      expect(result).toEqual(["frame-the-lair", "frame-valley-of-the-sun"]);
    });
  });
});

describe("viewBounds", () => {
  const view = {
    scrollX: -100,
    scrollY: -50,
    width: 1200,
    height: 800,
    zoom: { value: 2 },
  };
  let result: Bounds;

  describe("when the viewport is scrolled and zoomed in", () => {
    beforeEach(() => {
      result = viewBounds(view);
    });

    it("should cover the scene box the screen shows", () => {
      expect(result).toEqual({ x: 100, y: 50, width: 600, height: 400 });
    });
  });

  describe("when the toolbar, a drawer and padding inset the view", () => {
    beforeEach(() => {
      result = viewBounds(view, { top: 88, right: 332, bottom: 24, left: 24 });
    });

    it("should leave them out", () => {
      expect(result).toEqual({ x: 112, y: 94, width: 422, height: 344 });
    });
  });
});

describe("framePath", () => {
  const elements = [
    frame("frame-overview", 0, 0, 1700, 980),
    frame("frame-board-do", 1300, 260, 340, 330),
    frame("frame-element-row", 1333, 345, 130, 110),
  ];

  describe("when the frame is nested", () => {
    let result: string[];

    beforeEach(() => {
      result = ids(framePath(frameModel(elements), "frame-element-row"));
    });

    it("should run from the outermost frame down to it", () => {
      expect(result).toEqual([
        "frame-overview",
        "frame-board-do",
        "frame-element-row",
      ]);
    });
  });

  describe("when the frame is gone", () => {
    let result: Frame[];

    beforeEach(() => {
      result = framePath(frameModel(elements), "frame-ghost-town");
    });

    it("should be empty", () => {
      expect(result).toEqual([]);
    });
  });
});

describe("currentFrame", () => {
  const elements = [
    frame("frame-overview", 0, 0, 1700, 980),
    frame("frame-board-do", 1300, 260, 340, 330),
    frame("frame-the-lair", 3000, 0),
    frame("frame-tiny-centre", 800, 450, 100, 80),
  ];
  let result: string | null;

  describe("when the view shows the whole overview", () => {
    beforeEach(() => {
      result = current(elements, { x: -50, y: -50, width: 1800, height: 1080 });
    });

    it("should be the overview, not the frame nested in it", () => {
      expect(result).toBe("frame-overview");
    });
  });

  describe("when the view is zoomed into the nested frame", () => {
    beforeEach(() => {
      result = current(elements, { x: 1280, y: 250, width: 380, height: 350 });
    });

    it("should be the nested frame", () => {
      expect(result).toBe("frame-board-do");
    });
  });

  describe("when the whole overview is in view around a large frame at its centre", () => {
    beforeEach(() => {
      result = current(
        [...elements, frame("frame-big-middle", 450, 240, 800, 500)],
        { x: -50, y: -50, width: 1800, height: 1080 },
      );
    });

    it("should be the overview", () => {
      expect(result).toBe("frame-overview");
    });
  });

  describe("when the view is zoomed far into a corner of the overview", () => {
    beforeEach(() => {
      result = current(elements, { x: 10, y: 10, width: 100, height: 60 });
    });

    it("should still be the overview", () => {
      expect(result).toBe("frame-overview");
    });
  });

  describe("when the view fits the nested frame with a margin around it", () => {
    beforeEach(() => {
      result = current(elements, { x: 1200, y: 200, width: 540, height: 450 });
    });

    it("should be the nested frame, not the overview around the view", () => {
      expect(result).toBe("frame-board-do");
    });
  });

  describe("when the view shows empty canvas with a frame barely at its edge", () => {
    beforeEach(() => {
      result = current(elements, { x: 2000, y: 0, width: 1050, height: 600 });
    });

    it("should be null", () => {
      expect(result).toBeNull();
    });
  });

  describe("when frames have fractional coordinates and the whole overview is in view", () => {
    beforeEach(() => {
      result = current(
        [
          frame("frame-overview", 12.4, -30.8, 1700.3, 980.6),
          frame("frame-hero", 512.7, 230.1, 800.9, 500.3),
        ],
        { x: -37.6, y: -80.8, width: 1800.3, height: 1080.6 },
      );
    });

    it("should be the overview", () => {
      expect(result).toBe("frame-overview");
    });
  });

  describe("when zoom rounding leaves a section's right edge a hair outside the view", () => {
    beforeEach(() => {
      result = current(
        [
          frame("frame-section", 0, 2000, 1400, 700),
          frame("frame-slide", 20, 2020, 1360, 660),
        ],
        { x: 0, y: 1900, width: 1399.9999, height: 900 },
      );
    });

    it("should be the section, not the slide inside it", () => {
      expect(result).toBe("frame-section");
    });
  });

  describe("when the view has just fitted a tall narrow frame", () => {
    beforeEach(() => {
      result = current([frame("frame-tall-tower", 0, 0, 400, 1600)], {
        x: -1265,
        y: -100,
        width: 2930,
        height: 1800,
      });
    });

    it("should be current though it covers little of the view", () => {
      expect(result).toBe("frame-tall-tower");
    });
  });

  describe("when a wide title strip has been fitted into the view", () => {
    beforeEach(() => {
      result = current([frame("frame-title-strip", 0, 0, 2000, 100)], {
        x: -60,
        y: -610,
        width: 2120,
        height: 1320,
      });
    });

    it("should be current", () => {
      expect(result).toBe("frame-title-strip");
    });
  });

  describe("when a whole-board view shows a wide header above a four by three grid of slides", () => {
    beforeEach(() => {
      result = current(
        [
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
        ],
        { x: -100, y: -100, width: 4200, height: 2700 },
      );
    });

    it("should not pick the header just because it is fully on screen", () => {
      expect(result).not.toBe("frame-header");
    });
  });

  describe("when a small frame alone sits under the centre of a whole-board view", () => {
    beforeEach(() => {
      result = current([frame("frame-pebble", 1900, 600, 300, 200)], {
        x: 0,
        y: 0,
        width: 4200,
        height: 1400,
      });
    });

    it("should be null", () => {
      expect(result).toBeNull();
    });
  });

  describe("when the view centre sits in the larger of two side-by-side frames and the smaller fills a third of the view", () => {
    beforeEach(() => {
      result = current(
        [
          frame("frame-valley-of-the-sun", 0, 0, 400, 300),
          frame("frame-the-lair", 450, 0, 200, 300),
        ],
        { x: 50, y: 0, width: 600, height: 300 },
      );
    });

    it("should be the one under the centre of the view", () => {
      expect(result).toBe("frame-valley-of-the-sun");
    });
  });
});

describe("nextFrame", () => {
  let elements: FrameSource[];
  let from: string | null;
  let view: Bounds;
  let result: string | null;

  const next = (direction: Direction) => {
    const model = frameModel(elements);
    return (
      nextFrame(model, {
        current: (from && model.byId.get(from)) || null,
        view,
        direction,
      })?.id ?? null
    );
  };

  beforeEach(() => {
    elements = [
      frame("frame-valley-of-the-sun", 0, 0),
      frame("frame-the-lair", 600, 0),
      frame("frame-far-east", 3000, 400),
      frame("frame-thunderwrench", 0, 600),
      frame("frame-rusty-conquistador", -600, 0),
    ];
    from = "frame-valley-of-the-sun";
    view = { x: 0, y: 0, width: 400, height: 300 };
  });

  describe("when the current frame links to a frame off to the right and down", () => {
    beforeEach(() => {
      elements.push(
        arrow("arrow-sun-to-east", "frame-valley-of-the-sun", "frame-far-east"),
      );
    });

    describe("when pressing right", () => {
      beforeEach(() => {
        result = next("right");
      });

      it("should follow the link past the nearer unlinked frame", () => {
        expect(result).toBe("frame-far-east");
      });
    });

    describe("when pressing left, where no link points", () => {
      beforeEach(() => {
        result = next("left");
      });

      it("should fall back to the nearest frame that way", () => {
        expect(result).toBe("frame-rusty-conquistador");
      });
    });
  });

  describe("when two links point roughly right", () => {
    beforeEach(() => {
      elements.push(
        arrow("arrow-sun-to-east", "frame-valley-of-the-sun", "frame-far-east"),
        arrow("arrow-sun-to-lair", "frame-valley-of-the-sun", "frame-the-lair"),
      );
      result = next("right");
    });

    it("should take the link whose direction matches best", () => {
      expect(result).toBe("frame-the-lair");
    });
  });

  describe("when a nearer link points down at a slant and a farther one points straight down", () => {
    beforeEach(() => {
      elements.push(
        frame("frame-slanted-shack", 300, 400),
        arrow(
          "arrow-sun-to-shack",
          "frame-valley-of-the-sun",
          "frame-slanted-shack",
        ),
        arrow(
          "arrow-sun-to-thunder",
          "frame-valley-of-the-sun",
          "frame-thunderwrench",
        ),
      );
      result = next("down");
    });

    it("should take the straighter link, not the nearer one", () => {
      expect(result).toBe("frame-thunderwrench");
    });
  });

  describe("when the arrow points into the current frame", () => {
    beforeEach(() => {
      elements.push(
        arrow("arrow-east-to-sun", "frame-far-east", "frame-valley-of-the-sun"),
      );
      result = next("right");
    });

    it("should still follow it back", () => {
      expect(result).toBe("frame-far-east");
    });
  });

  describe("when nothing links and pressing down", () => {
    beforeEach(() => {
      result = next("down");
    });

    it("should go to the nearest frame below", () => {
      expect(result).toBe("frame-thunderwrench");
    });
  });

  describe("when nothing lies that way", () => {
    beforeEach(() => {
      result = next("up");
    });

    it("should be null", () => {
      expect(result).toBeNull();
    });
  });

  describe("when the only frame that way is well off the axis", () => {
    beforeEach(() => {
      elements = [
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-thunderwrench", 500, 1500),
      ];
      result = next("right");
    });

    it("should not jump there", () => {
      expect(result).toBeNull();
    });
  });

  describe("when the current frame sits inside a parent with a sibling beside it", () => {
    beforeEach(() => {
      elements = [
        frame("frame-overview", -100, -100, 1400, 600),
        frame("frame-valley-of-the-sun", 0, 0),
        frame("frame-the-lair", 600, 0),
      ];
      result = next("right");
    });

    it("should go to the sibling, never the parent around it", () => {
      expect(result).toBe("frame-the-lair");
    });
  });

  describe("when no frame is current", () => {
    beforeEach(() => {
      from = null;
      view = { x: -1400, y: 0, width: 400, height: 300 };
      result = next("right");
    });

    it("should go to the nearest frame right of the view", () => {
      expect(result).toBe("frame-rusty-conquistador");
    });
  });
});
