import React from "react";

import type { ExcalidrawFrameLikeElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getDefaultAppState } from "../appState";
import { API } from "../tests/helpers/api";
import {
  act,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "../tests/test-utils";

import { renderFrameOverlay } from "./frameOverlay";

import type { FrameOverlayAppState } from "./frameOverlay";

const { h } = window;

const canvasTheme = { frameWidth: 1, frameNameSize: 12, frameRadius: 4 };

const record = () => {
  const context = document.createElement("canvas").getContext("2d")!;
  const strokes: number[] = [];
  const names: string[] = [];
  const fonts: string[] = [];
  vi.spyOn(context, "stroke").mockImplementation(() => {
    strokes.push(context.lineWidth);
  });
  vi.spyOn(context, "fillText").mockImplementation((text: string) => {
    names.push(text);
    fonts.push(context.font);
  });
  return { context, strokes, names, fonts };
};

const appStateAt = (
  zoom: number,
  frameRendering = getDefaultAppState().frameRendering,
): FrameOverlayAppState => ({
  zoom: { value: zoom as FrameOverlayAppState["zoom"]["value"] },
  scrollX: 0,
  scrollY: 0,
  width: 1200,
  height: 1000,
  frameRendering,
  theme: "light",
});

const wideFrames = () => [
  {
    ...API.createElement({
      type: "frame",
      id: "frame-rusty-conquistador",
      x: 40,
      y: 60,
      width: 400,
      height: 300,
    }),
    name: "The Rusty Conquistador",
  },
  {
    ...API.createElement({
      type: "frame",
      id: "frame-valley-of-the-sun",
      x: 40,
      y: 600,
      width: 400,
      height: 300,
    }),
    name: "Valley of the Sun",
  },
];

describe("renderFrameOverlay", () => {
  let frames: ExcalidrawFrameLikeElement[];
  let recorded: ReturnType<typeof record>;

  beforeEach(() => {
    frames = wideFrames();
    recorded = record();
  });

  describe("when frames are hidden", () => {
    beforeEach(() => {
      renderFrameOverlay(recorded.context, {
        frames,
        appState: appStateAt(1, {
          ...getDefaultAppState().frameRendering,
          enabled: false,
        }),
        canvasTheme,
      });
    });

    it("strokes no outline", () => {
      expect(recorded.strokes).toEqual([]);
    });

    it("draws no name", () => {
      expect(recorded.names).toEqual([]);
    });
  });

  describe("when names are off but outlines are on", () => {
    beforeEach(() => {
      renderFrameOverlay(recorded.context, {
        frames,
        appState: appStateAt(1, {
          ...getDefaultAppState().frameRendering,
          name: false,
        }),
        canvasTheme,
      });
    });

    it("strokes both outlines without names", () => {
      expect({
        strokes: recorded.strokes.length,
        names: recorded.names,
      }).toEqual({ strokes: 2, names: [] });
    });
  });

  describe("when the view zooms from half to four times", () => {
    let zoomedIn: ReturnType<typeof record>;

    beforeEach(() => {
      renderFrameOverlay(recorded.context, {
        frames,
        appState: appStateAt(0.5),
        canvasTheme,
        dpr: 2,
      });
      zoomedIn = record();
      renderFrameOverlay(zoomedIn.context, {
        frames,
        appState: { ...appStateAt(4), scrollX: -40, scrollY: -60 },
        canvasTheme,
        dpr: 2,
      });
    });

    it("keeps the outline width in screen pixels", () => {
      expect([...recorded.strokes, ...zoomedIn.strokes]).toEqual([1, 1, 1]);
    });

    it("keeps the name size in screen pixels", () => {
      expect(
        [...recorded.fonts, ...zoomedIn.fonts].map(
          (font) => font.split(" ")[0],
        ),
      ).toEqual(["12px", "12px", "12px"]);
    });
  });
});

describe("renderFrameOverlay beside the editor's frame names", () => {
  let domNames: string[];
  let drawnNames: string[];

  beforeEach(async () => {
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
    await render(<Excalidraw />);
    await waitFor(() => expect(h.state.width).toBe(1200));
    const crowd = ["Thunderwrench", "The Lair", "Valley", "Lighthouse"].map(
      (name, i) => ({
        ...API.createElement({
          type: "frame",
          id: `frame-crowd-${i}`,
          x: 100 + i * 30,
          y: 100 + i * 20,
          width: 500,
          height: 400,
        }),
        name,
      }),
    );
    API.setElements(crowd);
    act(() => h.setState({ scrollX: 0, scrollY: 0 }));
    domNames = [
      ...GlobalTestState.renderResult.container.querySelectorAll(".frame-name"),
    ].map((node) => node.textContent ?? "");

    const recorded = record();
    renderFrameOverlay(recorded.context, {
      frames: crowd,
      appState: h.state,
    });
    drawnNames = recorded.names;
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it("hides the crowded names the editor hides", () => {
    expect(drawnNames).toEqual(domNames);
  });

  it("hides some of the crowd", () => {
    expect(drawnNames.length).toBeLessThan(4);
  });
});
