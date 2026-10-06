import { StrictMode } from "react";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { UI } from "../tests/helpers/ui";
import {
  FakeWebGL2,
  installWebGL2,
  sendStroke,
  uninstallWebGL2,
} from "../tests/helpers/webgl";
import { act, render } from "../tests/test-utils";

// How the ink layer treats the browser's GPU and pen APIs, seen through the
// editor.

const { h } = window;

let gl: FakeWebGL2;

const draw = () => {
  API.setAppState({ currentItemStrokeVariability: "variable" });
  UI.clickTool("freedraw");
  sendStroke(
    [
      [100, 100],
      [140, 110],
    ],
    { pointerType: "pen" },
  );
};

beforeEach(() => {
  gl = new FakeWebGL2();
  installWebGL2(gl);
});

afterEach(async () => {
  await act(async () => {});
  uninstallWebGL2();
});

describe("the ink layer's GPU", () => {
  describe("when the editor mounts in strict mode, which attaches the layer twice", () => {
    beforeEach(async () => {
      await render(
        <StrictMode>
          <Excalidraw freedrawRenderer="webgl" />
        </StrictMode>,
      );
      draw();
    });

    it("should keep the canvas's context alive for the second attach", () => {
      expect(gl.calls).not.toContain("loseContext");
    });

    it("should run the layer", () => {
      expect(h.app.api.getInkStatus()?.gpu).toBe(true);
    });

    it("should draw strokes on it", () => {
      expect(gl.frames.length).toBeGreaterThan(0);
    });
  });

  describe("when the canvas hands back a context that was lost", () => {
    beforeEach(async () => {
      gl.lost = true;
      await render(<Excalidraw freedrawRenderer="webgl" />);
      draw();
    });

    it("should run no ink layer", () => {
      expect(h.app.api.getInkStatus()).toBeNull();
    });

    it("should leave the strokes to the editor", () => {
      expect(h.elements).toHaveLength(1);
    });
  });

  describe("when WebGL runs in software, without a GPU", () => {
    beforeEach(async () => {
      gl.renderer = "Google SwiftShader";
      await render(<Excalidraw freedrawRenderer="webgl" />);
    });

    it("should say so", () => {
      expect(h.app.api.getInkStatus()?.gpu).toBe(false);
    });
  });
});

describe("the ink layer on each platform", () => {
  const contextOptions = () => {
    const asked: unknown[] = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) {
      if (type === "webgl2") {
        asked.push(options);
      }
      return getContext.call(this, type as "2d", options);
    } as HTMLCanvasElement["getContext"];
    return asked as { desynchronized: boolean }[];
  };

  const onPlatform = (platform: string | null, presenter = vi.fn()) => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: navigator.userAgent,
      ...(platform ? { userAgentData: { platform } } : {}),
      ink: {
        requestPresenter: vi.fn().mockResolvedValue({
          updateInkTrailStartPoint: presenter,
        }),
      },
    });
    return presenter;
  };

  describe("when Chrome runs on Windows", () => {
    let asked: { desynchronized: boolean }[];

    beforeEach(async () => {
      onPlatform("Windows");
      asked = contextOptions();
      await render(<Excalidraw freedrawRenderer="webgl" />);
    });

    it("should skip the compositor for lower pen latency", () => {
      expect(asked[0].desynchronized).toBe(true);
    });

    it("should let the OS draw the newest ink", () => {
      expect(h.app.api.getInkStatus()?.trail).toBe(true);
    });
  });

  describe("when Chrome runs on an Android phone", () => {
    let asked: { desynchronized: boolean }[];

    beforeEach(async () => {
      onPlatform("Android");
      asked = contextOptions();
      await render(<Excalidraw freedrawRenderer="webgl" />);
    });

    it("should stay in step with the compositor, which would black out the scene", () => {
      expect(asked[0].desynchronized).toBe(false);
    });
  });

  describe("when Chrome runs on a Mac", () => {
    beforeEach(async () => {
      onPlatform("macOS");
      await render(<Excalidraw freedrawRenderer="webgl" />);
    });

    it("should not hold a presenter there, which draws nothing", () => {
      expect(h.app.api.getInkStatus()?.trail).toBe(false);
    });
  });

  describe("when the browser offers no userAgentData", () => {
    let asked: { desynchronized: boolean }[];

    beforeEach(async () => {
      onPlatform(null);
      asked = contextOptions();
      await render(<Excalidraw freedrawRenderer="webgl" />);
    });

    it("should not desynchronize, because it might be Chrome on Android", () => {
      expect(asked[0].desynchronized).toBe(false);
    });
  });
});
