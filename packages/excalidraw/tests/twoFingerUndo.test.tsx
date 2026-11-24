import React from "react";
import { vi } from "vitest";

import { fireEvent } from "@testing-library/react";

import { CLASSES } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import {
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";

const { h } = window;

let clock = 1_000_000;
const wait = (ms: number) => {
  clock += ms;
  vi.setSystemTime(clock);
};

let nextPointerId = 10;
const fingers = () => [
  new Pointer("touch", nextPointerId++),
  new Pointer("touch", nextPointerId++),
];

const twoFingerTap = ({ hold = 80, x = 120, y = 120 } = {}) => {
  const [a, b] = fingers();
  a.downAt(x, y);
  b.downAt(x + 40, y + 10);
  wait(hold);
  a.upAt();
  b.upAt();
};

const twoFingerPinch = () => {
  const [a, b] = fingers();
  a.downAt(100, 120);
  b.downAt(140, 120);
  a.moveTo(60, 120);
  b.moveTo(180, 120);
  wait(80);
  a.up();
  b.up();
};

const liveIds = () =>
  h.elements.filter((element) => !element.isDeleted).map(({ id }) => id);

describe("double two-finger tap", () => {
  let first: string;
  let second: string;

  const drawTwo = (tool: "rectangle" | "freedraw") => {
    first = UI.createElement(tool, { x: 10, y: 10 }).id;
    second = UI.createElement(tool, { x: 40, y: 40 }).id;
    wait(1000);
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(h.state.width).toBe(200));
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
    vi.useRealTimers();
  });

  it.each(["rectangle", "freedraw"] as const)(
    "undoes the %s just drawn, and only it",
    (tool) => {
      drawTwo(tool);
      twoFingerTap();
      wait(150);
      twoFingerTap();

      expect(liveIds()).toEqual([first]);
      expect(h.elements.map(({ id }) => id)).toEqual([first, second]);
      expect(h.history.isRedoStackEmpty).toBe(false);
    },
  );

  it("undoes the last shape when the fingers land on it", () => {
    drawTwo("rectangle");
    twoFingerTap({ x: 45, y: 45 });
    wait(150);
    twoFingerTap({ x: 45, y: 45 });

    expect(liveIds()).toEqual([first]);
  });

  it("undoes the last shape with the rectangle tool still in hand", () => {
    drawTwo("rectangle");
    React.act(() => h.app.setActiveTool({ type: "rectangle" }));
    twoFingerTap();
    wait(150);
    twoFingerTap();

    expect(liveIds()).toEqual([first]);
    expect(h.elements).toHaveLength(2);
  });

  it("undoes twice for two double taps", () => {
    drawTwo("rectangle");
    twoFingerTap();
    wait(150);
    twoFingerTap();
    wait(600);
    twoFingerTap();
    wait(150);
    twoFingerTap();

    expect(liveIds()).toEqual([]);
  });

  it("still undoes after a touch lifted off the canvas, on a frame's name", async () => {
    drawTwo("rectangle");
    const frame = API.createElement({
      type: "frame",
      x: 20,
      y: 40,
      width: 170,
      height: 100,
    });
    API.updateScene({
      elements: [...h.elements, frame],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const label = await waitFor(() => {
      const found = GlobalTestState.renderResult.container.querySelector(
        `.${CLASSES.FRAME_NAME}`,
      );
      expect(found).not.toBeNull();
      return found!;
    });
    const touch = { pointerType: "touch", pointerId: 9, button: 0 };
    fireEvent.pointerDown(label, { ...touch, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(label, { ...touch, clientX: 30, clientY: 30 });
    wait(1000);

    twoFingerTap();
    wait(150);
    twoFingerTap();

    expect(liveIds()).toEqual([first, second]);
  });

  it("does nothing on a single two-finger tap", () => {
    drawTwo("rectangle");
    twoFingerTap();

    expect(liveIds()).toEqual([first, second]);
    expect(h.elements).toHaveLength(2);
  });

  it("does nothing when the second tap comes too late", () => {
    drawTwo("rectangle");
    twoFingerTap();
    wait(500);
    twoFingerTap();

    expect(liveIds()).toEqual([first, second]);
  });

  it("does nothing when the fingers rest too long", () => {
    drawTwo("rectangle");
    twoFingerTap({ hold: 400 });
    wait(100);
    twoFingerTap({ hold: 400 });

    expect(liveIds()).toEqual([first, second]);
  });

  it("does nothing for two quick pinches", () => {
    drawTwo("rectangle");
    const zoom = h.state.zoom.value;
    twoFingerPinch();
    wait(100);
    twoFingerPinch();

    expect(h.state.zoom.value).not.toBe(zoom);
    expect(liveIds()).toEqual([first, second]);
  });

  it("does nothing for a pinch then a tap", () => {
    drawTwo("rectangle");
    twoFingerPinch();
    wait(100);
    twoFingerTap();

    expect(liveIds()).toEqual([first, second]);
  });

  it("does nothing in view mode", () => {
    drawTwo("rectangle");
    React.act(() => h.setState({ viewModeEnabled: true }));
    twoFingerTap();
    wait(150);
    twoFingerTap();

    expect(liveIds()).toEqual([first, second]);
  });

  it("does nothing for two quick one-finger taps", () => {
    drawTwo("rectangle");
    const finger = new Pointer("touch", nextPointerId++);
    finger.downAt(150, 150);
    finger.upAt();
    wait(100);
    finger.downAt(150, 150);
    finger.upAt();

    expect(liveIds()).toEqual([first, second]);
  });
});
