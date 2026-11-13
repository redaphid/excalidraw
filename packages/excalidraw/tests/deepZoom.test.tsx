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

  it("normalizes zoom down to a millionth", () => {
    expect(getNormalizedZoom(0.000_01)).toBe(0.000_01);
    expect(getNormalizedZoom(0.000_001)).toBe(0.000_001);
  });

  it("clamps normalized zoom at a millionth", () => {
    expect(getNormalizedZoom(0.000_000_1)).toBe(0.000_001);
    expect(getNormalizedZoom(0)).toBe(0.000_001);
  });

  it("keeps seven significant figures of a zoom under 10%", () => {
    expect(getNormalizedZoom(0.000_001_4)).toBe(0.000_001_4);
    expect(getNormalizedZoom(0.000_001_234_567_89)).toBe(0.000_001_234_568);
    expect(getNormalizedZoom(0.012_345_678_9)).toBe(0.012_345_68);
  });

  it("rounds a zoom of 10% and up to six decimals, as upstream", () => {
    expect(getNormalizedZoom(0.123_456_78)).toBe(0.123_457);
    expect(getNormalizedZoom(1.234_567_89)).toBe(1.234_568);
    expect(getNormalizedZoom(123_456.789_123_4)).toBe(123_456.789_123);
  });

  it("keeps zooming out from a deep zoom set through updateScene", () => {
    act(() => {
      h.app.updateScene({
        appState: { zoom: { value: 0.000_005 as NormalizedZoomValue } },
      });
    });
    expect(h.state.zoom.value).toBe(0.000_005);
    act(() => {
      h.app.actionManager.executeAction(actionZoomOut, "api");
    });
    expect(h.state.zoom.value).toBeLessThan(0.000_005);
  });

  it("zooms out past 10%", () => {
    API.setAppState({ zoom: { value: 0.1 as NormalizedZoomValue } });
    act(() => {
      h.app.actionManager.executeAction(actionZoomOut, "api");
    });
    expect(h.state.zoom.value).toBeLessThan(0.1);
  });

  it("stops at a millionth", () => {
    API.setAppState({ zoom: { value: 0.000_001_05 as NormalizedZoomValue } });
    act(() => {
      h.app.actionManager.executeAction(actionZoomOut, "api");
    });
    expect(h.state.zoom.value).toBe(0.000_001);
    act(() => {
      h.app.actionManager.executeAction(actionZoomOut, "api");
    });
    expect(h.state.zoom.value).toBe(0.000_001);
  });

  it("shows a zoom under 1% with its significant digits", () => {
    const label = () =>
      document.querySelector(".reset-zoom-button")!.textContent;
    API.setAppState({ zoom: { value: 0.000_001 as NormalizedZoomValue } });
    expect(label()).toBe("0.0001%");
    API.setAppState({ zoom: { value: 0.000_123_4 as NormalizedZoomValue } });
    expect(label()).toBe("0.012%");
    API.setAppState({ zoom: { value: 0.5 as NormalizedZoomValue } });
    expect(label()).toBe("50%");
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

    it("zooms out by the same ratio at 0.001% as at 1x", () => {
      const ratioAt1 = zoomFrom(1, zoomOut) / 1;
      expect(zoomFrom(0.000_01, zoomOut) / 0.000_01).toBeCloseTo(ratioAt1, 6);
    });

    it("zooming out then in returns to the same zoom at 0.001%", () => {
      const zoomedOut = zoomFrom(0.000_01, zoomOut);
      expect(zoomFrom(zoomedOut, zoomIn)).toBe(0.000_01);
    });

    it("resets to 100% from a deep zoom", () => {
      expect(
        zoomFrom(250_000, () => {
          h.app.actionManager.executeAction(actionResetZoom, "api");
        }),
      ).toBe(1);
      expect(
        zoomFrom(0.000_002_5, () => {
          h.app.actionManager.executeAction(actionResetZoom, "api");
        }),
      ).toBe(1);
    });
  });
});
