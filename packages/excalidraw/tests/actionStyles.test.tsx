import React from "react";

import {
  CODES,
  COLOR_PALETTE,
  ROUNDNESS,
  STROKE_WIDTH,
} from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  actionChangeBackgroundColor,
  actionChangeFillStyle,
  actionChangeOpacity,
  actionChangeRoundness,
  actionChangeSloppiness,
  actionChangeStrokeColor,
  actionChangeStrokeStyle,
  actionChangeStrokeWidth,
} from "../actions/actionProperties";
import { copiedStyles } from "../actions/actionStyles";
import { Excalidraw } from "../index";

import type { Action } from "../actions/types";
import { API } from "../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../tests/helpers/ui";
import { act, render } from "../tests/test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

describe("actionStyles", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    // https://github.com/floating-ui/floating-ui/issues/1908#issuecomment-1301553793
    // affects node v16+
    await act(async () => {});
  });

  it("should copy & paste styles via keyboard", async () => {
    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);

    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(20, 20);

    // Change some styles of second rectangle
    const run = (action: Action, value: unknown) =>
      act(() => {
        h.app.actionManager.executeAction(action, "ui", value);
      });
    run(actionChangeStrokeColor, { color: COLOR_PALETTE.red[4] });
    run(actionChangeBackgroundColor, { color: COLOR_PALETTE.blue[1] });
    run(actionChangeFillStyle, "cross-hatch");
    run(actionChangeStrokeWidth, "bold");
    run(actionChangeStrokeStyle, "dotted");
    run(actionChangeSloppiness, 2);
    run(actionChangeOpacity, 60);

    mouse.reset();

    API.setSelectedElements([h.elements[1]] as NonDeletedExcalidrawElement[]);

    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.C);
    });
    const secondRect = JSON.parse(copiedStyles)[0];
    expect(secondRect.id).toBe(h.elements[1].id);

    mouse.reset();
    // Paste styles to first rectangle
    API.setSelectedElements([h.elements[0]] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () => {
      Keyboard.codeDown(CODES.V);
    });

    const firstRect = API.getSelectedElement();
    expect(firstRect.id).toBe(h.elements[0].id);
    expect(firstRect.strokeColor).toBe("#e03131");
    expect(firstRect.backgroundColor).toBe("#a5d8ff");
    expect(firstRect.fillStyle).toBe("cross-hatch");
    expect(firstRect.strokeWidth).toBe(STROKE_WIDTH.bold);
    expect(firstRect.strokeStyle).toBe("dotted");
    expect(firstRect.roughness).toBe(2); // Cartoonist: 2
    expect(firstRect.opacity).toBe(60);
  });

  it("should show and apply roughness for sticky notes", async () => {
    const stickyNote = API.createElement({
      type: "stickynote",
      roughness: 0,
    });

    API.setElements([stickyNote]);
    API.setSelectedElements([stickyNote]);

    act(() => {
      h.app.actionManager.executeAction(actionChangeSloppiness, "ui", 2);
    });

    expect(API.getSelectedElement().roughness).toBe(2);
  });

  it("should show and apply roundness for sticky notes", async () => {
    const stickyNote = API.createElement({
      type: "stickynote",
      roundness: null,
    });

    API.setElements([stickyNote]);
    API.setSelectedElements([stickyNote]);

    act(() => {
      h.app.actionManager.executeAction(actionChangeRoundness, "ui", "round");
    });

    expect(API.getSelectedElement().roundness).toEqual({
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
    });
  });

  it("should track sticky note stroke color separately", async () => {
    API.setAppState({
      currentItemStrokeColor: COLOR_PALETTE.red[4],
      currentItemStickynoteStrokeColor: COLOR_PALETTE.black,
    });
    const stickyNote = API.createElement({
      type: "stickynote",
      strokeColor: COLOR_PALETTE.black,
    });

    API.setElements([stickyNote]);
    API.setSelectedElements([stickyNote]);

    act(() => {
      h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
        color: COLOR_PALETTE.blue[4],
      });
    });

    expect(API.getSelectedElement().strokeColor).toBe(COLOR_PALETTE.blue[4]);
    expect(h.state.currentItemStickynoteStrokeColor).toBe(
      COLOR_PALETTE.blue[4],
    );
    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.red[4]);
  });
});
