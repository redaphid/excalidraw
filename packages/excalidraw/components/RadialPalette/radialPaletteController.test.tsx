import { queryByTestId } from "@testing-library/react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { Keyboard, UI } from "../../tests/helpers/ui";
import { act, render } from "../../tests/test-utils";

import { RADIAL_TOOLS } from "./radialPaletteController";

import type { ExcalidrawImperativeAPI } from "../../types";
import type { RadialPaletteState } from "./radialPaletteController";

const { h } = window;

const ring = () => queryByTestId(document.body, "radial-palette");

const highlighted = () =>
  ring()
    ?.querySelector(".RadialPalette__segment--highlight")
    ?.getAttribute("data-testid");

describe("the tools ring", () => {
  it("holds the eleven tools, hand and sticky note among them", () => {
    expect(RADIAL_TOOLS).toEqual([
      "selection",
      "hand",
      "rectangle",
      "diamond",
      "ellipse",
      "arrow",
      "line",
      "freedraw",
      "text",
      "stickynote",
      "frame",
    ]);
  });
});

describe("the radial palette's controller API", () => {
  let api: ExcalidrawImperativeAPI["radialPalette"];

  afterEach(async () => {
    await act(async () => {});
  });

  describe("with the palette on", () => {
    let excalidrawAPI: ExcalidrawImperativeAPI | null;

    beforeEach(async () => {
      excalidrawAPI = null;
      await render(
        <Excalidraw
          radialPalette
          onExcalidrawAPI={(value) => {
            excalidrawAPI = value;
          }}
        />,
      );
      API.setAppState({ width: 1000, height: 800 });
      api = h.app.radialPalette.api;
    });

    it("is the one on the Excalidraw API", () => {
      expect(excalidrawAPI?.radialPalette).toBe(api);
    });

    describe("when nothing has opened it", () => {
      it("reports it closed, on the tools", () => {
        expect(api.state()).toMatchObject({
          open: false,
          ring: "tools",
          index: 0,
        });
      });

      it("steps and chooses nothing", () => {
        api.step(3);
        api.choose();
        expect(api.state().open).toBe(false);
        expect(h.state.activeTool.type).toBe("selection");
      });
    });

    describe("when it opens on the tools", () => {
      beforeEach(() => {
        act(() => api.open());
      });

      it("opens the ring, highlighting the tool in use", () => {
        expect(ring()).not.toBeNull();
        expect(api.state()).toMatchObject({
          open: true,
          ring: "tools",
          index: 0,
        });
        expect(highlighted()).toBe("radial-tool-selection");
      });

      it("lists the shapes and tools, and nothing named for a role", () => {
        expect(api.state().items.map(({ id }) => id)).toEqual([
          ...RADIAL_TOOLS,
        ]);
      });

      it("keeps the highlight when opened again on the same ring", () => {
        act(() => api.step(2));
        act(() => api.open({ ring: "tools" }));
        expect(api.state().index).toBe(2);
      });

      it("ignores a ring it does not have", () => {
        act(() => api.open({ ring: "colour" as "colors" }));
        expect(api.state()).toMatchObject({ open: true, ring: "tools" });
      });

      it("steps forward and back, wrapping both ways", () => {
        act(() => api.step(-1));
        expect(api.state().index).toBe(RADIAL_TOOLS.length - 1);
        act(() => api.step(2));
        expect(highlighted()).toBe("radial-tool-hand");
      });

      it("chooses the highlighted shape and closes", () => {
        act(() => api.step(RADIAL_TOOLS.indexOf("ellipse")));
        act(() => api.choose());
        expect(h.state.activeTool.type).toBe("ellipse");
        expect(ring()).toBeNull();
        expect(api.state().open).toBe(false);
      });

      it("closes without choosing", () => {
        act(() => api.step(1));
        act(() => api.close());
        expect(ring()).toBeNull();
        expect(h.state.activeTool.type).toBe("selection");
      });

      describe("and then on the colors", () => {
        beforeEach(() => {
          act(() => api.open({ ring: "colors" }));
        });

        it("moves the highlight to the color in use, keeping the ring", () => {
          const state = api.state();
          expect(state.ring).toBe("colors");
          expect(state.items[state.index].id.toLowerCase()).toBe(
            h.state.currentItemStrokeColor.toLowerCase(),
          );
          expect(ring()).not.toBeNull();
        });

        it("gives the fill chip the index the ring draws it at, past empty recent slots", () => {
          const drawn = document.body.querySelectorAll(
            '[data-testid^="radial-color-"]:not([data-testid="radial-color-fill"])',
          ).length;
          expect(api.state().items.findIndex(({ id }) => id === "fill")).toBe(
            drawn,
          );
        });

        it("inks with the chosen color", () => {
          act(() => api.step(1));
          const { items, index } = api.state();
          act(() => api.choose());
          expect(h.state.currentItemStrokeColor).toBe(items[index].id);
        });
      });
    });

    describe("when it opens at a point", () => {
      beforeEach(() => {
        act(() => api.open({ ring: "pens", at: { x: 300, y: 250 } }));
      });

      it("centers the ring there", () => {
        const { left, top, width, height } = ring()!.style;
        expect({
          x: parseFloat(left) + parseFloat(width) / 2,
          y: parseFloat(top) + parseFloat(height) / 2,
        }).toEqual({ x: 300, y: 250 });
      });

      it("chooses the eraser at the end of the pens", () => {
        act(() => api.step(-1));
        expect(api.state().items[api.state().index].id).toBe("eraser");
        act(() => api.choose());
        expect(h.state.activeTool.type).toBe("eraser");
      });
    });

    describe("when a see-through pen is followed by a shape from the toolbar", () => {
      beforeEach(() => {
        act(() => api.open({ ring: "pens" }));
        const wash = api.state().items.findIndex(({ id }) => id === "wash");
        act(() => api.step(wash - api.state().index));
        act(() => api.choose());
      });

      it("draws the shape opaque", () => {
        expect(h.state.currentItemOpacity).toBeLessThan(100);
        UI.clickTool("rectangle");
        expect(h.state.activeTool.type).toBe("rectangle");
        expect(h.state.currentItemOpacity).toBe(100);
      });
    });

    describe("when something subscribes", () => {
      let seen: RadialPaletteState[];
      let unsubscribe: () => void;

      beforeEach(() => {
        seen = [];
        unsubscribe = api.onChange((state) => seen.push(state));
      });

      it("hears every change, from the API and the keyboard alike", () => {
        act(() => api.open());
        act(() => api.step(1));
        Keyboard.keyPress(KEYS.ARROW_RIGHT);
        Keyboard.keyPress(KEYS.ESCAPE);
        expect(
          seen.map(({ open, ring, index }) => ({ open, ring, index })),
        ).toEqual([
          { open: true, ring: "tools", index: 0 },
          { open: true, ring: "tools", index: 1 },
          { open: true, ring: "tools", index: 2 },
          { open: false, ring: "tools", index: 2 },
        ]);
      });

      it("hears nothing when nothing changed", () => {
        act(() => api.open());
        act(() => api.step(0));
        act(() => api.step(api.state().items.length));
        act(() => api.open({ ring: "tools" }));
        expect(seen).toHaveLength(1);
      });

      it("hears nothing after unsubscribing", () => {
        unsubscribe();
        act(() => api.open());
        expect(seen).toEqual([]);
      });
    });

    describe("when the keyboard drives it", () => {
      beforeEach(() => {
        Keyboard.keyPress(KEYS.COMMA);
        Keyboard.keyPress(KEYS.ARROW_RIGHT);
      });

      it("moves the same highlight the API reads", () => {
        expect(api.state().index).toBe(1);
      });

      it("chooses with Enter", () => {
        Keyboard.keyPress(KEYS.ENTER);
        expect(h.state.activeTool.type).toBe("hand");
        expect(ring()).toBeNull();
      });

      it("moves out to the pens with the up arrow", () => {
        Keyboard.keyPress(KEYS.ARROW_UP);
        expect(api.state().ring).toBe("pens");
      });
    });
  });

  describe("with the palette off", () => {
    beforeEach(async () => {
      await render(<Excalidraw />);
      api = h.app.radialPalette.api;
    });

    it("does nothing", () => {
      act(() => api.open());
      expect(api.state().open).toBe(false);
      expect(ring()).toBeNull();
    });
  });
});
