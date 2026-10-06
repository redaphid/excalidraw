import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { UI } from "../tests/helpers/ui";
import { act, fireEvent, GlobalTestState, render } from "../tests/test-utils";

import { isBarrel } from "./App.barrel";

const { h } = window;

type Press = { button?: number; buttons?: number };

const BARREL = { button: 2, buttons: 3 };
const TIP = { button: 0, buttons: 1 };

const pen = (type: string, x: number, y: number, press: Press) =>
  act(() => {
    fireEvent[type as "pointerDown"](GlobalTestState.interactiveCanvas, {
      clientX: x,
      clientY: y,
      pointerType: "pen",
      pointerId: 3,
      pressure: 0.5,
      isPrimary: true,
      ...press,
    });
  });

/** A pen drag from (x1, y1) to (x2, y2), with the barrel held or not. */
const drag = (
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  press: Press,
) => {
  pen("pointerDown", x1, y1, press);
  pen("pointerMove", (x1 + x2) / 2, (y1 + y2) / 2, {
    button: -1,
    buttons: press.buttons,
  });
  pen("pointerMove", x2, y2, { button: -1, buttons: press.buttons });
  pen("pointerUp", x2, y2, { button: press.button, buttons: 0 });
};

const settled = () => act(() => new Promise((r) => setTimeout(r, 0)));

const selected = () =>
  Object.keys(h.state.selectedElementIds).filter(
    (id) => h.state.selectedElementIds[id],
  );

describe("isBarrel", () => {
  it("is the pen touching down with its side button held", () => {
    expect(isBarrel({ pointerType: "pen", button: 2, buttons: 3 })).toBe(true);
  });

  it("is not the pen's eraser end", () => {
    expect(isBarrel({ pointerType: "pen", button: 5, buttons: 32 })).toBe(
      false,
    );
  });

  it("is not a mouse's right-click, which keeps its context menu", () => {
    expect(isBarrel({ pointerType: "mouse", button: 2, buttons: 2 })).toBe(
      false,
    );
  });
});

describe("penBarrelSelects", () => {
  let boathouse: ExcalidrawElement;

  afterEach(async () => {
    await act(async () => {});
  });

  describe("when the host opts in and the freedraw tool is out", () => {
    beforeEach(async () => {
      await render(<Excalidraw penBarrelSelects />);
      boathouse = API.createElement({
        type: "rectangle",
        x: 200,
        y: 200,
        width: 100,
        height: 100,
      });
      API.setElements([boathouse]);
      UI.clickTool("freedraw");
    });

    describe("when the pen drags a box around a rectangle with the barrel held", () => {
      beforeEach(async () => {
        drag([150, 150], [350, 350], BARREL);
        await settled();
      });

      it("should select the rectangle", () => {
        expect(selected()).toEqual([boathouse.id]);
      });

      it("should draw nothing", () => {
        expect(h.elements).toHaveLength(1);
      });

      it("should keep the selection tool while something is selected", () => {
        expect(h.state.activeTool.type).toBe("selection");
      });

      describe("when the barrel's right-click arrives after the release", () => {
        beforeEach(() => {
          act(() => {
            fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
              clientX: 350,
              clientY: 350,
              button: 2,
            });
          });
        });

        it("should swallow it", () => {
          expect(h.state.contextMenu).toBeNull();
        });
      });

      describe("when the pen taps empty space", () => {
        beforeEach(async () => {
          drag([600, 600], [600, 600], TIP);
          await settled();
        });

        it("should give the freedraw tool back", () => {
          expect(h.state.activeTool.type).toBe("freedraw");
        });
      });
    });

    describe("when the pen drags across empty space with the barrel held", () => {
      beforeEach(async () => {
        drag([600, 600], [700, 700], BARREL);
        await settled();
      });

      it("should give the freedraw tool straight back", () => {
        expect(h.state.activeTool.type).toBe("freedraw");
      });

      it("should not scroll the canvas as a pan would", () => {
        expect([h.state.scrollX, h.state.scrollY]).toEqual([0, 0]);
      });
    });
  });

  describe("when the host leaves it off", () => {
    beforeEach(async () => {
      await render(<Excalidraw />);
      UI.clickTool("freedraw");
      drag([150, 150], [350, 350], BARREL);
      await settled();
    });

    it("should keep the freedraw tool", () => {
      expect(h.state.activeTool.type).toBe("freedraw");
    });

    it("should leave the secondary-button press to pan", () => {
      expect(h.state.scrollX).not.toBe(0);
    });
  });
});
