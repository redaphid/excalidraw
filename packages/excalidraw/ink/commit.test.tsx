import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";
import { API } from "../tests/helpers/api";
import { UI } from "../tests/helpers/ui";
import {
  FakeWebGL2,
  installWebGL2,
  sendStroke,
  uninstallWebGL2,
} from "../tests/helpers/webgl";
import { act, render } from "../tests/test-utils";

// The element the ink layer commits, read back from the scene.

const { h } = window;

const committed = () =>
  h.elements.find(
    (e): e is ExcalidrawFreeDrawElement => e.type === "freedraw",
  )!;

beforeEach(() => {
  installWebGL2(new FakeWebGL2());
});

afterEach(async () => {
  await act(async () => {});
  uninstallWebGL2();
});

describe("a stroke committed by the ink layer", () => {
  describe("when the keeper sketches a wave with a pen", () => {
    beforeEach(async () => {
      await render(<Excalidraw freedrawRenderer="webgl" />);
      API.setAppState({
        currentItemStrokeVariability: "variable",
        currentItemStrokeColor: "#e03131",
      });
      UI.clickTool("freedraw");
      sendStroke(
        [
          [100, 50],
          [130, 20],
          [90, 70],
        ],
        { pointerType: "pen" },
        { pressures: [0.4, 0.8, 0.6] },
      );
    });

    it("should anchor the element where the nib landed", () => {
      expect([committed().x, committed().y]).toEqual([100, 50]);
    });

    it("should keep its points relative to the anchor", () => {
      expect(committed().points).toEqual([
        [0, 0],
        [30, -30],
        [-10, 20],
      ]);
    });

    it("should keep the pressures the pen reported", () => {
      expect(committed().pressures).toEqual([0.4, 0.8, 0.6]);
    });

    it("should size the element to its points", () => {
      expect([committed().width, committed().height]).toEqual([40, 50]);
    });

    it("should take the current stroke colour", () => {
      expect(committed().strokeColor).toBe("#e03131");
    });

    it("should smooth a pen as little as the editor does", () => {
      expect(committed().strokeOptions).toEqual({
        variability: "variable",
        streamline: 0.2,
      });
    });

    it("should carry its creation time, as master's format does", () => {
      expect(committed().created).toEqual(expect.any(Number));
    });

    it("should carry no lastCommittedPoint, which master's format dropped", () => {
      expect(committed()).not.toHaveProperty("lastCommittedPoint");
    });
  });

  describe("when the keeper draws a hundredfold zoomed in, in screen units", () => {
    beforeEach(async () => {
      await render(
        <Excalidraw
          freedrawRenderer="webgl"
          authoringUnits="screen"
          freedrawStrokeWidth={3}
        />,
      );
      API.setAppState({
        currentItemStrokeVariability: "variable",
        zoom: { value: getNormalizedZoom(100) },
      });
      UI.clickTool("freedraw");
      sendStroke(
        [
          [100, 100],
          [140, 120],
        ],
        { pointerType: "pen" },
      );
    });

    it("should draw as wide on screen as the editor's own strokes", () => {
      expect(committed().strokeWidth).toBeCloseTo(0.03, 12);
    });

    it("should carry the authoring scale the fork sizes details by", () => {
      expect(committed().authoringScale).toBeCloseTo(0.01, 12);
    });
  });

  describe("when the stroke starts inside a frame", () => {
    let frameId: string;

    beforeEach(async () => {
      await render(<Excalidraw freedrawRenderer="webgl" />);
      const frame = API.createElement({
        type: "frame",
        x: 0,
        y: 0,
        width: 500,
        height: 300,
      });
      frameId = frame.id;
      API.setElements([frame]);
      API.setAppState({ currentItemStrokeVariability: "variable" });
      UI.clickTool("freedraw");
      sendStroke(
        [
          [250, 150],
          [280, 160],
        ],
        { pointerType: "pen" },
      );
    });

    it("should put the stroke in that frame", () => {
      expect(committed().frameId).toBe(frameId);
    });
  });

  describe("when a short tick ends near where it began", () => {
    beforeEach(async () => {
      await render(<Excalidraw freedrawRenderer="webgl" />);
      API.setAppState({ currentItemStrokeVariability: "variable" });
      UI.clickTool("freedraw");
      sendStroke(
        [
          [100, 100],
          [103, 101],
          [105, 104],
        ],
        { pointerType: "pen" },
      );
    });

    it("should keep its end where the pen lifted, as the ink drew it", () => {
      expect(committed().points.at(-1)).toEqual([5, 4]);
    });
  });
});
