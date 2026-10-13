import React from "react";

import type {
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { CommandPalette, Excalidraw, MainMenu } from "../index";
import { clearAppStateForLocalStorage } from "../appState";
import { restoreAppState } from "../data/restore";

import { API } from "./helpers/api";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
  within,
} from "./test-utils";

const { h } = window;

const queryContainer = (selector: string) =>
  GlobalTestState.renderResult.container.querySelector(selector);

const frameName = () => queryContainer(".frame-name")?.textContent ?? null;

const withShowFramesItem = async <T,>(use: (item: HTMLElement) => T) => {
  fireEvent.click(queryContainer(".main-menu-trigger")!);
  fireEvent.click(await GlobalTestState.renderResult.findByText("Preferences"));
  const item = (
    await GlobalTestState.renderResult.findByText("Show frames")
  ).closest(".dropdown-menu-item") as HTMLElement;
  const result = use(item);
  fireEvent.click(queryContainer(".main-menu-trigger")!);
  return result;
};

const toggleFromMenu = () =>
  withShowFramesItem((item) => fireEvent.click(item));

const menuShowsCheckmark = () =>
  withShowFramesItem(
    (item) => item.querySelector(".dropdown-menu-item__icon polyline") !== null,
  );

const toggleFromPalette = async () => {
  act(() => h.setState({ openDialog: { name: "commandPalette" } }));
  const palette = await waitFor(() => {
    const dialog = document.querySelector(".command-palette-dialog");
    expect(dialog).not.toBe(null);
    return dialog as HTMLElement;
  });
  fireEvent.click(
    within(palette).getByText("Show frames").closest(".command-item")!,
  );
  await waitFor(() => expect(h.state.openDialog).toBe(null));
};

describe("Show frames", () => {
  let frame: NonDeleted<ExcalidrawFrameElement>;
  let rects: ReturnType<typeof vi.spyOn>;
  let strokes: ReturnType<typeof vi.spyOn>;
  let clips: ReturnType<typeof vi.spyOn>;

  const paint = () => {
    for (const spy of [rects, strokes, clips]) {
      spy.mockClear();
    }
    act(() => h.setState({ scrollX: h.state.scrollX + 1 }));
    const nextCall = (spy: typeof clips, after: number) =>
      Math.min(...spy.mock.invocationCallOrder.filter((at) => at > after));
    const frameRects = rects.mock.invocationCallOrder.filter((_, i) => {
      const [x, y, width, height] = rects.mock.calls[i];
      return (
        x === 0 && y === 0 && width === frame.width && height === frame.height
      );
    });
    return {
      outlined: frameRects.some(
        (at) => nextCall(strokes, at) < nextCall(clips, at),
      ),
      clipped: frameRects.some(
        (at) => nextCall(clips, at) < nextCall(strokes, at),
      ),
    };
  };

  beforeEach(async () => {
    localStorage.clear();
    mockBoundingClientRect({
      width: 1200,
      height: 1000,
      x: 0,
      left: 0,
      y: 0,
      top: 0,
      right: 1200,
      bottom: 1000,
    });
    strokes = vi.spyOn(CanvasRenderingContext2D.prototype, "stroke");
    clips = vi.spyOn(CanvasRenderingContext2D.prototype, "clip");
    await render(
      <Excalidraw>
        <MainMenu>
          <MainMenu.DefaultItems.Preferences />
        </MainMenu>
        <CommandPalette />
      </Excalidraw>,
    );
    await waitFor(() => expect(h.state.width).toBe(1200));
    rects = vi.spyOn(CanvasRenderingContext2D.prototype, "roundRect");
    frame = API.createElement({
      type: "frame",
      id: "frame-chrome",
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    });
    const halfOutside = API.createElement({
      type: "rectangle",
      x: 300,
      y: 150,
      width: 200,
      height: 100,
      frameId: frame.id,
    });
    API.setElements([halfOutside, frame]);
    API.updateElement(frame, { name: "Board" });
    act(() => h.setState({ scrollX: 0, scrollY: 0 }));
  });

  afterEach(() => {
    for (const spy of [rects, strokes, clips]) {
      spy.mockRestore();
    }
    restoreOriginalGetBoundingClientRect();
  });

  it("draws the outline and the name by default", async () => {
    expect(paint()).toEqual({ outlined: true, clipped: true });
    expect(frameName()).toBe("Board");
    expect(await menuShowsCheckmark()).toBe(true);
  });

  describe("toggled off from the menu", () => {
    beforeEach(toggleFromMenu);

    it("hides the outline and the name and keeps clipping", () => {
      expect(paint()).toEqual({ outlined: false, clipped: true });
      expect(frameName()).toBe(null);
    });

    it("drops the menu checkmark", async () => {
      expect(await menuShowsCheckmark()).toBe(false);
    });

    describe("then toggled on again", () => {
      beforeEach(toggleFromMenu);

      it("restores the outline and the name", async () => {
        expect(paint()).toEqual({ outlined: true, clipped: true });
        expect(frameName()).toBe("Board");
        expect(await menuShowsCheckmark()).toBe(true);
      });
    });
  });

  describe("toggled off from the command palette", () => {
    beforeEach(toggleFromPalette);

    it("hides the outline and the name and keeps clipping", () => {
      expect(paint()).toEqual({ outlined: false, clipped: true });
      expect(frameName()).toBe(null);
    });

    describe("then toggled on again", () => {
      beforeEach(toggleFromPalette);

      it("restores the outline and the name", () => {
        expect(paint()).toEqual({ outlined: true, clipped: true });
        expect(frameName()).toBe("Board");
      });
    });
  });

  describe("toggled off, saved and restored", () => {
    beforeEach(toggleFromMenu);

    it("stays hidden and keeps clipping", () => {
      const saved = JSON.stringify(clearAppStateForLocalStorage(h.state));
      expect(restoreAppState(JSON.parse(saved), null).frameRendering).toEqual({
        enabled: true,
        clip: true,
        name: false,
        outline: false,
      });
    });
  });
});
