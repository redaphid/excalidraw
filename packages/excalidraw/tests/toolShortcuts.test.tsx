import React from "react";

import { Excalidraw } from "../index";

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
    await render(<Excalidraw radialPalette />);
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
});
