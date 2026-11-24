import React from "react";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, fireEvent, render } from "./test-utils";

const { h } = window;

// #244: draw mounts the editor with the radial palette and without
// `handleKeyboardGlobally`, and nothing focuses the container after a board
// loads, so the keys land on `document.body`.
const TOOL_KEYS = [
  ["h", "hand"],
  ["v", "selection"],
  ["r", "rectangle"],
  ["d", "diamond"],
  ["o", "ellipse"],
  ["a", "arrow"],
  ["l", "line"],
  ["p", "freedraw"],
  ["t", "text"],
  ["e", "eraser"],
] as const;

describe("tool shortcuts with nothing focused", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  describe.each(TOOL_KEYS)("when %s is pressed on the body", (key, tool) => {
    beforeEach(() => {
      act(() => {
        h.app.setActiveTool({
          type: tool === "selection" ? "rectangle" : "selection",
        });
      });
      (document.activeElement as HTMLElement | null)?.blur();
      fireEvent.keyDown(document.body, { key });
    });

    it(`switches to the ${tool} tool`, () => {
      expect(h.state.activeTool.type).toBe(tool);
    });
  });

  describe("when h is pressed in the focused editor container", () => {
    beforeEach(() => {
      const container = document.querySelector<HTMLElement>(
        ".excalidraw-container",
      )!;
      container.focus();
      // `hand` toggles: a second delivery would put the selection back
      fireEvent.keyDown(container, { key: "h" });
    });

    it("switches to the hand tool once", () => {
      expect(h.state.activeTool.type).toBe("hand");
    });
  });

  describe("when h is pressed on a focused host button outside the editor", () => {
    let button: HTMLButtonElement;

    beforeEach(() => {
      button = document.createElement("button");
      document.body.appendChild(button);
      button.focus();
      fireEvent.keyDown(button, { key: "h" });
    });

    afterEach(() => {
      button.remove();
    });

    it("leaves the tool alone", () => {
      expect(h.state.activeTool.type).toBe("selection");
    });
  });

  describe("when a key is typed into a field outside the editor", () => {
    let field: HTMLInputElement;

    beforeEach(() => {
      field = document.createElement("input");
      document.body.appendChild(field);
      field.focus();
      fireEvent.keyDown(field, { key: "h" });
    });

    afterEach(() => {
      field.remove();
    });

    it("leaves the tool alone", () => {
      expect(h.state.activeTool.type).toBe("selection");
    });
  });

  describe("when Ctrl+F is pressed on the body", () => {
    let notPrevented: boolean;

    beforeEach(() => {
      notPrevented = fireEvent.keyDown(document.body, {
        key: "f",
        ctrlKey: true,
      });
    });

    it("leaves it to the browser's find", () => {
      expect(notPrevented).toBe(true);
    });
  });

  describe("when Escape is pressed on the body with a shape selected", () => {
    let heard: boolean;
    const listen = () => {
      heard = true;
    };

    beforeEach(() => {
      const rectangle = API.createElement({ type: "rectangle" });
      API.setElements([rectangle]);
      API.setSelectedElements([rectangle]);
      heard = false;
      window.addEventListener("keydown", listen);
      fireEvent.keyDown(document.body, { key: "Escape" });
    });

    afterEach(() => {
      window.removeEventListener("keydown", listen);
    });

    it("still reaches the host's window listeners", () => {
      expect(heard).toBe(true);
    });
  });
});
