import { createInkRenderer } from "./gl";

/** A WebGL2 context that accepts every call and records which were made. */
const fakeContext = (lost: { now: boolean }) => {
  const calls: string[] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, key: string) {
      if (key === "isContextLost") {
        return () => lost.now;
      }
      if (key === "getExtension") {
        return (name: string) =>
          name === "WEBGL_lose_context"
            ? {
                loseContext: () => {
                  calls.push("loseContext");
                  lost.now = true;
                },
              }
            : null;
      }
      if (key === "getShaderParameter" || key === "getProgramParameter") {
        return () => true;
      }
      if (key === "getParameter") {
        return () => "Lighthouse GPU";
      }
      return () => {
        calls.push(key);
        return {};
      };
    },
  });
  return { gl, calls };
};

const canvasWith = (gl: unknown) => {
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => gl) as HTMLCanvasElement["getContext"];
  return canvas;
};

describe("createInkRenderer", () => {
  describe("when the canvas hands back a context that was lost", () => {
    let result: ReturnType<typeof createInkRenderer>;

    beforeEach(() => {
      const { gl } = fakeContext({ now: true });
      result = createInkRenderer(canvasWith(gl), { desynchronized: false });
    });

    it("should give up, so the editor draws the strokes itself", () => {
      expect(result).toBeNull();
    });
  });

  describe("when a renderer is disposed and another attached to the same canvas, as strict mode does", () => {
    let calls: string[];
    let second: ReturnType<typeof createInkRenderer>;

    beforeEach(() => {
      const fake = fakeContext({ now: false });
      calls = fake.calls;
      const canvas = canvasWith(fake.gl);
      createInkRenderer(canvas, { desynchronized: false })?.dispose();
      second = createInkRenderer(canvas, { desynchronized: false });
    });

    it("should keep the context alive", () => {
      expect(calls).not.toContain("loseContext");
    });

    it("should draw with the second", () => {
      expect(second?.ready()).toBe(true);
    });

    it("should free what the first one made", () => {
      expect(calls).toEqual(
        expect.arrayContaining([
          "deleteProgram",
          "deleteBuffer",
          "deleteVertexArray",
        ]),
      );
    });
  });
});
