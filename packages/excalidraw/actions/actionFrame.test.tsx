import React from "react";

import { CODES } from "@excalidraw/common";

import { Excalidraw, MainMenu } from "../index";
import { getDefaultAppState } from "../appState";
import { Keyboard } from "../tests/helpers/ui";
import { act, fireEvent, render, screen } from "../tests/test-utils";

import type { AppState } from "../types";

const { h } = window;

const hiddenFrames = {
  ...getDefaultAppState().frameRendering,
  enabled: false,
};

describe("show frames", () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    onChange = vi.fn();
    await render(
      <Excalidraw
        initialData={{ appState: { frameRendering: hiddenFrames } }}
        onChange={onChange}
        handleKeyboardGlobally
      >
        <MainMenu>
          <MainMenu.DefaultItems.ToggleFrames />
        </MainMenu>
      </Excalidraw>,
    );
  });

  const lastFrameRendering = (): AppState["frameRendering"] =>
    onChange.mock.calls.at(-1)![1].frameRendering;

  describe("when the host starts with frames hidden", () => {
    it("keeps them hidden", () => {
      expect(h.state.frameRendering.enabled).toBe(false);
    });
  });

  describe("when Shift+Alt+F is pressed", () => {
    beforeEach(() => {
      Keyboard.withModifierKeys({ shift: true, alt: true }, () => {
        Keyboard.codePress(CODES.F);
      });
    });

    it("shows frames", () => {
      expect(h.state.frameRendering.enabled).toBe(true);
    });

    it("tells the host through onChange", () => {
      expect(lastFrameRendering().enabled).toBe(true);
    });

    it("leaves outline, name and clip as they were", () => {
      expect(lastFrameRendering()).toEqual({ ...hiddenFrames, enabled: true });
    });
  });

  describe("when the menu item is picked", () => {
    let item: HTMLElement;

    beforeEach(async () => {
      act(() => h.setState({ openMenu: "canvas" }));
      item = await screen.findByText("Show frames");
      fireEvent.click(item);
    });

    it("shows frames", () => {
      expect(h.state.frameRendering.enabled).toBe(true);
    });
  });
});
