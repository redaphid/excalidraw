import React from "react";

import { CODES } from "@excalidraw/common";

import {
  actionResetZoom,
  actionZoomIn,
  actionZoomOut,
} from "../actions/actionCanvas";
import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

describe("deep zoom", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("normalizes zoom up to a millionfold", () => {
    expect(getNormalizedZoom(100_000)).toBe(100_000);
  });

  it("clamps normalized zoom at a millionfold", () => {
    expect(getNormalizedZoom(5_000_000)).toBe(1_000_000);
  });

  it("keeps zooming in from a deep zoom set through updateScene", () => {
    act(() => {
      h.app.updateScene({
        appState: { zoom: { value: 500_000 as NormalizedZoomValue } },
      });
    });
    expect(h.state.zoom.value).toBe(500_000);
    act(() => {
      h.app.actionManager.executeAction(actionZoomIn, "api");
    });
    expect(h.state.zoom.value).toBeGreaterThan(500_000);
  });

  it("zooms in past 30x", () => {
    API.setAppState({ zoom: { value: 30 as NormalizedZoomValue } });
    act(() => {
      h.app.actionManager.executeAction(actionZoomIn, "api");
    });
    expect(h.state.zoom.value).toBeGreaterThan(30);
  });

  it("stops at a millionfold", () => {
    API.setAppState({ zoom: { value: 999_999.95 as NormalizedZoomValue } });
    act(() => {
      h.app.actionManager.executeAction(actionZoomIn, "api");
    });
    expect(h.state.zoom.value).toBe(1_000_000);
    act(() => {
      h.app.actionManager.executeAction(actionZoomIn, "api");
    });
    expect(h.state.zoom.value).toBe(1_000_000);
  });

  describe("zoom buttons and keys", () => {
    const zoomFrom = (zoom: number, step: () => void) => {
      API.setAppState({ zoom: { value: zoom as NormalizedZoomValue } });
      act(step);
      return h.state.zoom.value;
    };
    const zoomIn = () => {
      h.app.actionManager.executeAction(actionZoomIn, "api");
    };
    const zoomOut = () => {
      h.app.actionManager.executeAction(actionZoomOut, "api");
    };
    const pressCtrl = (code: string) => () => {
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.codePress(code);
      });
    };

    it("steps from 100% to 110% and back", () => {
      expect(zoomFrom(1, zoomIn)).toBe(1.1);
      expect(zoomFrom(1.1, zoomOut)).toBe(1);
    });

    it("zooms in by the same ratio at 1000x as at 1x", () => {
      const ratioAt1 = zoomFrom(1, zoomIn) / 1;
      expect(zoomFrom(1000, zoomIn) / 1000).toBeCloseTo(ratioAt1, 6);
    });

    it("zooms out by the same ratio at 1000x as at 1x", () => {
      const ratioAt1 = zoomFrom(1, zoomOut) / 1;
      expect(zoomFrom(1000, zoomOut) / 1000).toBeCloseTo(ratioAt1, 6);
    });

    it("ctrl+= and ctrl+- step by the same ratio at 1000x as at 1x", () => {
      const inAt1 = zoomFrom(1, pressCtrl(CODES.EQUAL));
      expect(zoomFrom(1000, pressCtrl(CODES.EQUAL)) / 1000).toBeCloseTo(
        inAt1,
        6,
      );
      const outAt1 = zoomFrom(1, pressCtrl(CODES.MINUS));
      expect(zoomFrom(1000, pressCtrl(CODES.MINUS)) / 1000).toBeCloseTo(
        outAt1,
        6,
      );
    });

    it("zooming in then out returns to the same zoom", () => {
      const zoomedIn = zoomFrom(1000, zoomIn);
      expect(zoomFrom(zoomedIn, zoomOut)).toBe(1000);
    });

    it("resets to 100% from a deep zoom", () => {
      expect(
        zoomFrom(250_000, () => {
          h.app.actionManager.executeAction(actionResetZoom, "api");
        }),
      ).toBe(1);
    });
  });
});
