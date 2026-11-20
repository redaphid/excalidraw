import {
  FREEDRAW_STROKE_WIDTH,
  STROKE_WIDTH,
} from "@excalidraw/common";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { act, render } from "../tests/test-utils";

import { actionChangeStrokeWidth } from "./actionProperties";

const { h } = window;

describe("element properties", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  describe("properties when elements selected", () => {
    it("should apply stroke width by element type", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.thin,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      act(() => {
        h.app.actionManager.executeAction(
          actionChangeStrokeWidth,
          "ui",
          "bold",
        );
      });

      const selectedElements = API.getSelectedElements();
      const selectedRect = selectedElements.find(
        (element) => element.type === "rectangle",
      );
      const selectedFreedraw = selectedElements.find(
        (element) => element.type === "freedraw",
      );

      expect(selectedRect?.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(selectedFreedraw?.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });

    it("should create new elements with stroke width by element type", () => {
      API.setAppState({ currentItemStrokeWidthKey: "bold" });

      const rect = API.createElement({ type: "rectangle" });
      const freedraw = API.createElement({ type: "freedraw" });

      expect(rect.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(freedraw.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });
  });
});
