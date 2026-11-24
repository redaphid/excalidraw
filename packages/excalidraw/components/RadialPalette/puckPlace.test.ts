import {
  PUCK_EDGE,
  PUCK_RADIUS,
  PUCK_STORAGE_KEY,
  dropPuck,
  loadPuckPlace,
  reachablePuckCenter,
  savePuckPlace,
} from "./puckPlace";

const BOUNDS = { width: 400, height: 800 };

describe("dropPuck", () => {
  describe("when dropped in the open", () => {
    it("keeps where it landed, as fractions of the editor", () => {
      expect(dropPuck({ x: 100, y: 600 }, BOUNDS)).toEqual({
        x: 0.25,
        y: 0.75,
        collapsed: false,
      });
    });
  });

  describe("when dropped past the editor", () => {
    it("keeps it inside", () => {
      expect(dropPuck({ x: 200, y: 900 }, BOUNDS).y).toBe(1);
    });
  });

  describe("when dropped against the right side", () => {
    it("tucks it into a dot on that side", () => {
      expect(dropPuck({ x: 400 - PUCK_EDGE + 1, y: 400 }, BOUNDS)).toEqual({
        x: 1,
        y: 0.5,
        collapsed: true,
      });
    });
  });

  describe("when dropped against the left side", () => {
    it("tucks it into a dot on that side", () => {
      expect(dropPuck({ x: PUCK_EDGE - 1, y: 400 }, BOUNDS)).toEqual({
        x: 0,
        y: 0.5,
        collapsed: true,
      });
    });
  });

  describe("when dropped just clear of a side", () => {
    it("leaves it open", () => {
      expect(dropPuck({ x: PUCK_EDGE, y: 400 }, BOUNDS).collapsed).toBe(false);
    });
  });
});

describe("loadPuckPlace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("when nothing was kept", () => {
    it("has no place, so the puck sits in its corner", () => {
      expect(loadPuckPlace(window)).toBeNull();
    });
  });

  describe("when a place was kept", () => {
    beforeEach(() => {
      savePuckPlace(window, { x: 0.3, y: 0.6, collapsed: true });
    });

    it("reads it back", () => {
      expect(loadPuckPlace(window)).toEqual({
        x: 0.3,
        y: 0.6,
        collapsed: true,
      });
    });
  });

  describe("when what was kept is not a place", () => {
    beforeEach(() => {
      localStorage.setItem(PUCK_STORAGE_KEY, '{"x":"left","y":2}');
    });

    it("ignores it", () => {
      expect(loadPuckPlace(window)).toBeNull();
    });
  });

  describe("when storage throws", () => {
    it("has no place", () => {
      const blocked = {
        get localStorage(): Storage {
          throw new Error("storage-blocked-by-a-grumpy-sandbox");
        },
      } as unknown as Window;
      expect(loadPuckPlace(blocked)).toBeNull();
    });
  });
});

describe("reachablePuckCenter", () => {
  const area = { left: 0, top: 0, width: 390, height: 844 };
  const belowBar = (at: { y: number }) => at.y >= 60;

  it("keeps a center that can already be pressed", () => {
    expect(reachablePuckCenter({ x: 200, y: 400 }, area, belowBar)).toEqual({
      x: 200,
      y: 400,
    });
  });

  it("moves a center under a top bar to the nearest spot below it", () => {
    const at = reachablePuckCenter({ x: 368, y: 22 }, area, belowBar)!;
    expect(at.y - PUCK_RADIUS).toBeGreaterThanOrEqual(60);
    expect(at.y).toBeLessThan(60 + 3 * PUCK_RADIUS);
  });

  it("finds nothing when nothing can be pressed", () => {
    expect(reachablePuckCenter({ x: 200, y: 400 }, area, () => false)).toBe(
      null,
    );
  });
});
