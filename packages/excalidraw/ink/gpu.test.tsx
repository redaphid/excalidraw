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

import type { FakeGPU } from "../tests/helpers/webgl";

// How the ink layer treats the browser's GPU and pen APIs, seen through the
// editor.

const { h } = window;

let gpu: FakeGPU;

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
  gpu = installWebGL2();
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

    it("should give each attach a canvas of its own", () => {
      expect(gpu.canvases).toHaveLength(2);
    });

    it("should release the first canvas's context", () => {
      expect(gpu.contexts[0].calls).toContain("loseContext");
    });

    it("should take the first canvas out of the page", () => {
      expect(gpu.canvases[0].isConnected).toBe(false);
    });

    it("should run the layer on the second", () => {
      expect(h.app.api.getInkStatus()?.gpu).toBe(true);
    });

    it("should draw strokes on it", () => {
      expect(gpu.contexts[1].frames.length).toBeGreaterThan(0);
    });

    it("should free each shader once its program is linked", () => {
      expect(
        gpu.contexts.map(
          (gl) => gl.calls.filter((c) => c === "deleteShader").length,
        ),
      ).toEqual([2, 2]);
    });
  });

  describe("when the host turns the layer off", () => {
    beforeEach(async () => {
      const { rerender } = await render(
        <Excalidraw freedrawRenderer="webgl" />,
      );
      rerender(<Excalidraw freedrawRenderer="canvas" />);
    });

    it("should release the context, rather than leave it for the garbage collector", () => {
      expect(gpu.gl.calls).toContain("loseContext");
    });

    it("should take its canvas out of the page", () => {
      expect(gpu.canvases.every((c) => !c.isConnected)).toBe(true);
    });

    it("should run no ink layer", () => {
      expect(h.app.api.getInkStatus()).toBeNull();
    });
  });

  describe("when the canvas hands back a context that was lost", () => {
    beforeEach(async () => {
      uninstallWebGL2();
      installWebGL2(() => Object.assign(new FakeWebGL2(), { lost: true }));
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

  describe("when the window moves to a screen of another pixel density", () => {
    beforeEach(async () => {
      await render(<Excalidraw freedrawRenderer="webgl" />);
      Object.defineProperties(gpu.canvases[0], {
        clientWidth: { value: 400 },
        clientHeight: { value: 300 },
      });
      vi.stubGlobal("devicePixelRatio", 2);
      draw();
    });

    it("should size the canvas for that density by the next stroke", () => {
      expect([gpu.canvases[0].width, gpu.canvases[0].height]).toEqual([
        800, 600,
      ]);
    });
  });

  describe("when WebGL runs in software, without a GPU", () => {
    beforeEach(async () => {
      uninstallWebGL2();
      installWebGL2(() =>
        Object.assign(new FakeWebGL2(), { renderer: "Google SwiftShader" }),
      );
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
