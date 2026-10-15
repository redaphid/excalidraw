import React from "react";

import { CODES } from "@excalidraw/common";

import { Excalidraw, MainMenu } from "../index";
import { API } from "../tests/helpers/api";
import { Keyboard } from "../tests/helpers/ui";
import { act, fireEvent, render, screen } from "../tests/test-utils";

import type { AppState } from "../types";

const { h } = window;

// outline and clip off, so a toggle that resets them to the defaults shows
const hiddenFrames: AppState["frameRendering"] = {
  enabled: false,
  outline: false,
  name: true,
  clip: false,
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
          <MainMenu.DefaultItems.PreferencesToggleFramesItem />
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
    beforeEach(async () => {
      act(() => h.setState({ openMenu: "canvas" }));
      fireEvent.click(await screen.findByText("Show frames"));
    });

    it("shows frames", () => {
      expect(h.state.frameRendering.enabled).toBe(true);
    });
  });

  describe("when the host shows frames with updateScene", () => {
    beforeEach(() => {
      API.updateScene({
        appState: { frameRendering: { ...hiddenFrames, enabled: true } },
      });
    });

    it("tells the host through onChange", () => {
      expect(lastFrameRendering().enabled).toBe(true);
    });
  });

  describe("when the host shows frames with updateFrameRendering", () => {
    beforeEach(() => {
      act(() => h.app.updateFrameRendering({ enabled: true }));
    });

    it("keeps the other flags and tells the host through onChange", () => {
      expect(lastFrameRendering()).toEqual({ ...hiddenFrames, enabled: true });
    });
  });
});
