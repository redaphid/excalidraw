import { beforeEach, describe, expect, it } from "vitest";

import {
  type Editor,
  dropsForPinch,
  PINCH_WINDOW_MS,
  type Press,
  simulatesPressure,
  streamlineFor,
  desynchronizes,
  takesStroke,
  trailWorks,
} from "./gate";

describe("takesStroke", () => {
  describe("when the freedraw tool is out and the editor is idle", () => {
    let editor: Editor;
    let press: Press;

    beforeEach(() => {
      editor = {
        activeTool: { type: "freedraw" },
        interactive: true,
        holdingSpace: false,
        inking: false,
        penMode: false,
        pinchable: true,
        currentItemStrokeVariability: "variable",
      };
      press = {
        pointerType: "pen",
        button: 0,
        buttons: 1,
        isPrimary: true,
        onCanvas: true,
      };
    });

    describe("when a pen touches the canvas", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(press, editor);
      });

      it("should take the stroke", () => {
        expect(result).toBe(true);
      });
    });

    describe("when a mouse presses on the canvas", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke({ ...press, pointerType: "mouse" }, editor);
      });

      it("should take the stroke", () => {
        expect(result).toBe(true);
      });
    });

    describe("when a finger touches the canvas", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke({ ...press, pointerType: "touch" }, editor);
      });

      it("should take the stroke, so a pinch can drop it before anyone sees it", () => {
        expect(result).toBe(true);
      });
    });

    describe("when a finger touches the canvas in pen mode", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(
          { ...press, pointerType: "touch" },
          { ...editor, penMode: true },
        );
      });

      it("should leave it to the editor, where fingers only navigate", () => {
        expect(result).toBe(false);
      });
    });

    describe("when a finger touches the canvas with no camera layer to pinch", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(
          { ...press, pointerType: "touch" },
          { ...editor, pinchable: false },
        );
      });

      it("should leave it to the editor, which pinches by itself", () => {
        expect(result).toBe(false);
      });
    });

    describe("when the pen is flipped to its eraser", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke({ ...press, button: 5, buttons: 32 }, editor);
      });

      it("should leave it to the editor, which switches to the eraser", () => {
        expect(result).toBe(false);
      });
    });

    describe("when the press lands on the toolbar", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke({ ...press, onCanvas: false }, editor);
      });

      it("should leave the click alone", () => {
        expect(result).toBe(false);
      });
    });

    describe("when the space bar is held to pan", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(press, { ...editor, holdingSpace: true });
      });

      it("should let the editor pan", () => {
        expect(result).toBe(false);
      });
    });

    describe("when another stroke is still going", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(press, { ...editor, inking: true });
      });

      it("should not start a second", () => {
        expect(result).toBe(false);
      });
    });

    describe("when the freedraw mode is set to constant width", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(press, {
          ...editor,
          currentItemStrokeVariability: "constant",
        });
      });

      it("should leave the stroke to the editor, which draws that width", () => {
        expect(result).toBe(false);
      });
    });

    describe("when the editor is in view mode or not interactive", () => {
      let result: boolean;

      beforeEach(() => {
        result = takesStroke(press, { ...editor, interactive: false });
      });

      it("should not draw", () => {
        expect(result).toBe(false);
      });
    });
  });

  describe("when the rectangle tool is out", () => {
    let result: boolean;

    beforeEach(() => {
      result = takesStroke(
        {
          pointerType: "pen",
          button: 0,
          buttons: 1,
          isPrimary: true,
          onCanvas: true,
        },
        {
          activeTool: { type: "rectangle" },
          interactive: true,
          holdingSpace: false,
          inking: false,
          penMode: false,
          pinchable: true,
          currentItemStrokeVariability: "variable",
        },
      );
    });

    it("should leave the press to the editor", () => {
      expect(result).toBe(false);
    });
  });
});

describe("dropsForPinch", () => {
  describe("when a second finger lands 120ms into a finger stroke", () => {
    let result: boolean;

    beforeEach(() => {
      result = dropsForPinch(120);
    });

    it("should drop the stroke as the start of a pinch", () => {
      expect(result).toBe(true);
    });
  });

  describe("when a second finger lands 900ms into a finger stroke", () => {
    let result: boolean;

    beforeEach(() => {
      result = dropsForPinch(900);
    });

    it("should keep the stroke, which was drawn on purpose", () => {
      expect(result).toBe(false);
    });
  });

  describe("when a second finger lands just as the window closes", () => {
    let result: boolean;

    beforeEach(() => {
      result = dropsForPinch(PINCH_WINDOW_MS);
    });

    it("should keep the stroke", () => {
      expect(result).toBe(false);
    });
  });
});

describe("simulatesPressure", () => {
  describe("when a mouse button goes down", () => {
    let result: boolean;

    beforeEach(() => {
      result = simulatesPressure({ pointerType: "mouse", pressure: 0.5 });
    });

    it("should simulate pressure from speed, as Excalidraw does", () => {
      expect(result).toBe(true);
    });
  });

  describe("when a pen happens to land at exactly half pressure", () => {
    let result: boolean;

    beforeEach(() => {
      result = simulatesPressure({ pointerType: "pen", pressure: 0.5 });
    });

    it("should still trust the pen", () => {
      expect(result).toBe(false);
    });
  });
});

describe("streamlineFor", () => {
  describe("when a pen draws", () => {
    let result: number;

    beforeEach(() => {
      result = streamlineFor("pen");
    });

    it("should smooth it as little as Excalidraw smooths a pen's", () => {
      expect(result).toBe(0.2);
    });
  });

  describe("when a finger draws", () => {
    let result: number;

    beforeEach(() => {
      result = streamlineFor("touch");
    });

    it("should smooth it as little as a pen, as Excalidraw does", () => {
      expect(result).toBe(0.2);
    });
  });

  describe("when a mouse draws", () => {
    let result: number;

    beforeEach(() => {
      result = streamlineFor("mouse");
    });

    it("should smooth it as much as Excalidraw smooths a mouse's", () => {
      expect(result).toBe(0.5);
    });
  });
});

describe("trailWorks", () => {
  describe("when Chromium runs on Windows", () => {
    let result: boolean;

    beforeEach(() => {
      result = trailWorks({ platform: "Windows" });
    });

    it("should let the OS draw the newest ink", () => {
      expect(result).toBe(true);
    });
  });

  describe("when Chromium runs on a Mac", () => {
    let result: boolean;

    beforeEach(() => {
      result = trailWorks({ platform: "macOS" });
    });

    it("should not, because the presenter there draws nothing", () => {
      expect(result).toBe(false);
    });
  });

  describe("when the browser only offers a user agent string", () => {
    let result: boolean;

    beforeEach(() => {
      result = trailWorks({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      });
    });

    it("should read Windows from it", () => {
      expect(result).toBe(true);
    });
  });
});

describe("desynchronizes", () => {
  describe("when Chrome runs on an Android phone", () => {
    let result: boolean;

    beforeEach(() => {
      result = desynchronizes({ userAgentData: { platform: "Android" } });
    });

    it("should not, because the scene goes black under the stroke", () => {
      expect(result).toBe(false);
    });
  });

  describe("when Chrome runs on Windows", () => {
    let result: boolean;

    beforeEach(() => {
      result = desynchronizes({ userAgentData: { platform: "Windows" } });
    });

    it("should skip the compositor for lower pen latency", () => {
      expect(result).toBe(true);
    });
  });

  describe("when the browser offers no userAgentData", () => {
    let result: boolean;

    beforeEach(() => {
      result = desynchronizes({});
    });

    it("should not, because it might be Chrome on Android", () => {
      expect(result).toBe(false);
    });
  });
});
