import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { GlobalTestState, act, fireEvent, render } from "./test-utils";

const { h } = window;

/** Escape where the focus is: the menu takes it when it opens */
const pressEscape = () =>
  Keyboard.keyPress(
    KEYS.ESCAPE,
    (document.activeElement as HTMLElement | null) ?? document,
  );

describe("the context menu and Escape", () => {
  beforeEach(async () => {
    await render(<Excalidraw radialPalette />);
  });

  describe("when the canvas menu is open and Escape is pressed", () => {
    beforeEach(() => {
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 1,
        clientY: 1,
      });
      expect(UI.queryContextMenu()).not.toBeNull();
      pressEscape();
    });

    it("closes the menu", () => {
      expect(h.state.contextMenu).toBeNull();
      expect(UI.queryContextMenu()).toBeNull();
    });
  });

  describe("when the hub's menu is open on a selection and Escape is pressed", () => {
    let rectangleId: string;

    beforeEach(() => {
      const rectangle = API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 80,
        height: 60,
      });
      rectangleId = rectangle.id;
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);
      act(() =>
        h.app.openContextMenu({
          clientX: 600,
          clientY: 500,
          forSelection: true,
        }),
      );
      expect(UI.queryContextMenu()).not.toBeNull();
      pressEscape();
    });

    it("closes the menu", () => {
      expect(h.state.contextMenu).toBeNull();
    });

    it("does only that: the shape stays selected", () => {
      expect(h.state.selectedElementIds).toEqual({ [rectangleId]: true });
    });
  });
});
