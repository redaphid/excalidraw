import React from "react";

import { COLOR_PALETTE, TAP_TWICE_TIMEOUT } from "@excalidraw/common";

import { Excalidraw } from "../../index";
import { UI } from "../../tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  togglePopover,
} from "../../tests/test-utils";

const { h } = window;

const tap = (testId: string, detail = 1) => {
  const swatch = screen.getByTestId(testId);
  fireEvent.pointerDown(swatch);
  fireEvent.pointerUp(swatch);
  fireEvent.click(swatch, { detail });
};

describe("color picker double tap", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    UI.clickTool("rectangle");
    togglePopover("Stroke");
    expect(h.state.openPopup).toBe("elementStroke");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // https://github.com/floating-ui/floating-ui/issues/1908#issuecomment-1301553793
    await act(async () => {});
  });

  it("keeps the picker open on a single tap", () => {
    tap("color-red");

    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.red[4]);
    expect(h.state.openPopup).toBe("elementStroke");
  });

  it("applies the color and closes the picker on a double tap", () => {
    tap("color-blue");
    tap("color-blue");

    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.blue[4]);
    expect(h.state.openPopup).toBe(null);
  });

  it("closes on a double click slower than the tap window", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    tap("color-blue");
    now.mockReturnValue(1_000 + TAP_TWICE_TIMEOUT + 200);
    tap("color-blue", 2);

    expect(h.state.openPopup).toBe(null);
  });

  it("closes on a double tap of a shade", () => {
    tap("color-blue");
    const shade = screen.getAllByLabelText("Shade")[1];
    fireEvent.click(shade, { detail: 1 });
    fireEvent.click(shade, { detail: 2 });

    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.blue[1]);
    expect(h.state.openPopup).toBe(null);
  });

  it("stays open when two different swatches are tapped quickly", () => {
    tap("color-red");
    tap("color-blue");

    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.blue[4]);
    expect(h.state.openPopup).toBe("elementStroke");
  });

  it("stays open when the same swatch is tapped twice slowly", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    tap("color-red");
    now.mockReturnValue(1_000 + TAP_TWICE_TIMEOUT + 1);
    tap("color-red");

    expect(h.state.openPopup).toBe("elementStroke");
  });

  it("stays open when a swatch is activated twice from the keyboard", () => {
    tap("color-red", 0);
    tap("color-red", 0);

    expect(h.state.currentItemStrokeColor).toBe(COLOR_PALETTE.red[4]);
    expect(h.state.openPopup).toBe("elementStroke");
  });

  it("stays open when the same hotkey is pressed twice", () => {
    const picker = document.querySelector(".color-picker-content")!;
    fireEvent.keyDown(picker, { key: "r" });
    fireEvent.keyDown(picker, { key: "r" });

    expect(h.state.openPopup).toBe("elementStroke");
  });
});
