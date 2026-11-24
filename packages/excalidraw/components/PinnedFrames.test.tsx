import React from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { actionPinFrame, actionUnpinFrame } from "../actions/actionFrame";
import {
  clearAppStateForLocalStorage,
  cleanAppStateForExport,
} from "../appState";
import { API } from "../tests/helpers/api";
import { act, fireEvent, render, waitFor } from "../tests/test-utils";

const { h } = window;

/** an element as the scene holds it now */
const sceneElement = (id: string) =>
  h.elements.find((e) => e.id === id)! as NonDeletedExcalidrawElement;

const shown = () => document.querySelector<HTMLElement>(".PinnedFrame");

const boxOf = (el: HTMLElement) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
  width: parseFloat(el.style.width),
  height: parseFloat(el.style.height),
});

const press = (el: Element, x: number, y: number, pointerId = 1) =>
  fireEvent.pointerDown(el, {
    pointerId,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
  });
const move = (el: Element, x: number, y: number, pointerId = 1) =>
  fireEvent.pointerMove(el, { pointerId, clientX: x, clientY: y });
const lift = (el: Element, x: number, y: number, pointerId = 1) =>
  fireEvent.pointerUp(el, { pointerId, clientX: x, clientY: y });

describe("pin a frame to the screen (#240)", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
    const legend = API.createElement({
      type: "frame",
      id: "legend",
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
    const dot = API.createElement({
      type: "rectangle",
      id: "dot",
      x: 120,
      y: 70,
      width: 40,
      height: 40,
      frameId: "legend",
    });
    API.setElements([legend, dot]);
    API.setAppState({
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as any },
      width: 390,
      height: 844,
    });
    API.setSelectedElements([legend]);
  });

  it("offers Pin to screen for a selected frame, and not Unpin", () => {
    expect(h.app.actionManager.isActionEnabled(actionPinFrame)).toBe(true);
    expect(h.app.actionManager.isActionEnabled(actionUnpinFrame)).toBe(false);
  });

  it("does not offer it for a plain shape", () => {
    API.setSelectedElements([sceneElement("dot")]);
    expect(h.app.actionManager.isActionEnabled(actionPinFrame)).toBe(false);
  });

  describe("once pinned", () => {
    beforeEach(async () => {
      API.executeAction(actionPinFrame);
      await waitFor(() => expect(shown()).not.toBeNull());
    });

    it("shows the frame where it was, at the size it was", () => {
      expect(h.state.pinnedFrames.legend).toEqual({ x: 100, y: 50, scale: 1 });
      expect(boxOf(shown()!)).toEqual({
        left: 100,
        top: 50,
        width: 200,
        height: 100,
      });
      // its contents, drawn
      expect(shown()!.querySelector("svg")).not.toBeNull();
    });

    it("stays put, at its size, while the board pans and zooms", () => {
      const before = boxOf(shown()!);
      act(() => {
        API.setAppState({
          scrollX: -350,
          scrollY: 120,
          zoom: { value: 2.5 as any },
        });
      });
      expect(boxOf(shown()!)).toEqual(before);
    });

    it("is not shared: it stays out of the saved file and the server", () => {
      expect(cleanAppStateForExport(h.state)).not.toHaveProperty(
        "pinnedFrames",
      );
      expect(clearAppStateForLocalStorage(h.state).pinnedFrames).toEqual(
        h.state.pinnedFrames,
      );
    });

    it("does not change the scene", () => {
      const legend = h.elements.find((e) => e.id === "legend")!;
      expect([legend.x, legend.y]).toEqual([100, 50]);
    });

    it("moves where it is dragged, and the frame on the board does not", () => {
      const el = shown()!;
      press(el, 150, 80);
      move(el, 170, 90);
      move(el, 210, 120);
      lift(el, 210, 120);
      expect(h.state.pinnedFrames.legend).toMatchObject({ x: 160, y: 90 });
      expect(boxOf(shown()!)).toMatchObject({ left: 160, top: 90 });
      const legend = h.elements.find((e) => e.id === "legend")!;
      expect([legend.x, legend.y]).toEqual([100, 50]);
    });

    it("goes back on the board, where it was shown, on two quick taps", () => {
      // pan and zoom first, so going back has to move the board
      act(() => {
        API.setAppState({
          scrollX: -350,
          scrollY: 120,
          zoom: { value: 2.5 as any },
        });
      });
      const el = shown()!;
      press(el, 150, 80);
      lift(el, 150, 80);
      press(el, 152, 81);
      lift(el, 152, 81);
      expect(h.state.pinnedFrames.legend).toBeUndefined();
      expect(shown()).toBeNull();
      // the board moved so the frame sits where the pin was: no jump
      const { scrollX, scrollY, zoom } = h.state;
      expect(zoom.value).toBe(1);
      expect((100 + scrollX) * zoom.value).toBeCloseTo(100);
      expect((50 + scrollY) * zoom.value).toBeCloseTo(50);
      expect(h.state.selectedElementIds).toEqual({ legend: true });
    });

    it("a slow second tap does not unpin", () => {
      vi.useFakeTimers({ toFake: ["Date", "performance"] });
      try {
        const el = shown()!;
        press(el, 150, 80);
        lift(el, 150, 80);
        vi.advanceTimersByTime(800);
        press(el, 150, 80);
        lift(el, 150, 80);
        expect(h.state.pinnedFrames.legend).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("unpins from the menu", () => {
      API.setSelectedElements([sceneElement("legend")]);
      expect(h.app.actionManager.isActionEnabled(actionUnpinFrame)).toBe(true);
      API.executeAction(actionUnpinFrame);
      expect(h.state.pinnedFrames.legend).toBeUndefined();
      expect(shown()).toBeNull();
    });

    it("goes away when its frame is deleted", () => {
      act(() => {
        API.setElements(
          h.elements.map((e) =>
            e.id === "legend" ? { ...e, isDeleted: true } : e,
          ),
        );
      });
      expect(shown()).toBeNull();
    });
  });
});
