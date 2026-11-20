import React from "react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../../index";
import { actionOpenMainMenu } from "../../actions/actionMenu";
import { Keyboard } from "../../tests/helpers/ui";
import { act, render, waitFor, fireEvent } from "../../tests/test-utils";

const openMainMenu = () =>
  act(() => {
    window.h.app.actionManager.executeAction(actionOpenMainMenu);
  });

describe("Test <DropdownMenu/>", () => {
  it("closes on Escape", async () => {
    await render(<Excalidraw />);
    openMainMenu();
    expect(window.h.state.openMenu).toBe("canvas");

    await waitFor(() => {
      Keyboard.keyDown(KEYS.ESCAPE);
      expect(window.h.state.openMenu).toBe(null);
    });
  });

  it("closes main menu on outside pointer and touch events after reopening", async () => {
    const { container } = await render(<Excalidraw />);
    const canvas = container.querySelector<HTMLCanvasElement>("canvas")!;

    for (const event of [fireEvent.pointerDown, fireEvent.touchStart]) {
      openMainMenu();
      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="dropdown-menu"]'),
        ).not.toBeNull();
      });

      event(canvas);
      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="dropdown-menu"]'),
        ).toBeNull();
      });
    }
  });
});
