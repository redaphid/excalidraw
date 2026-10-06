import { act } from "@testing-library/react";

import { GlobalTestState } from "../test-utils";

/** One dab the ink layer drew, in scene coordinates. */
export type DrawnDab = { x: number; y: number; r: number };

/** What one `drawArraysInstanced` call put on the ink canvas. */
export type InkFrame = {
  dabs: DrawnDab[];
  /** premultiplied rgba */
  color: number[];
};

/**
 * A WebGL2 context for jsdom, which has none: it takes every call, keeps the
 * buffer the ink layer uploads, and records each frame it draws as dabs in
 * scene coordinates (at the scene's scroll when the test reads them, which
 * these tests leave at 0).
 */
export class FakeWebGL2 {
  frames: InkFrame[] = [];
  calls: string[] = [];
  lost = false;
  renderer = "Lighthouse GPU";

  private data = new Float32Array(0);
  private uniforms: Record<string, number[]> = {};

  /** the context handed to the ink canvas */
  readonly context = new Proxy(this, {
    get: (target, key: string) => {
      if (key in target) {
        const value = (target as unknown as Record<string, unknown>)[key];
        return typeof value === "function" ? value.bind(target) : value;
      }
      return () => {
        target.calls.push(key);
        return {};
      };
    },
  }) as unknown as WebGL2RenderingContext;

  isContextLost() {
    return this.lost;
  }

  getExtension(name: string) {
    return name === "WEBGL_lose_context"
      ? {
          loseContext: () => {
            this.calls.push("loseContext");
            this.lost = true;
          },
        }
      : null;
  }

  getParameter() {
    return this.renderer;
  }

  getShaderParameter() {
    return true;
  }

  getProgramParameter() {
    return true;
  }

  getUniformLocation(_: unknown, name: string) {
    return name;
  }

  uniform1f(name: string, x: number) {
    this.uniforms[name] = [x];
  }

  uniform2f(name: string, x: number, y: number) {
    this.uniforms[name] = [x, y];
  }

  uniform4f(name: string, ...rgba: number[]) {
    this.uniforms[name] = rgba;
  }

  bufferData(_: number, bytes: number) {
    this.data = new Float32Array(bytes / 4);
  }

  bufferSubData(
    _: number,
    byteOffset: number,
    source: Float32Array,
    from: number,
    length: number,
  ) {
    this.data.set(source.subarray(from, from + length), byteOffset / 4);
  }

  drawArraysInstanced(_: number, __: number, ___: number, segments: number) {
    const [scrollX, scrollY] = this.uniforms.u_scroll;
    const dabs = Array.from({ length: segments + 1 }, (_, i) => ({
      x: this.data[i * 3] + scrollX,
      y: this.data[i * 3 + 1] + scrollY,
      r: this.data[i * 3 + 2],
    }));
    this.frames.push({ dabs, color: this.uniforms.u_color });
  }
}

// jsdom's canvas context comes from vitest-canvas-mock, itself a mock, so it
// is wrapped here rather than spied on.
const getContext = HTMLCanvasElement.prototype.getContext;

/** Hands `gl` to every canvas asking for WebGL2, until `uninstallWebGL2`. */
export const installWebGL2 = (gl: FakeWebGL2 | null) => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    options?: unknown,
  ) {
    if (type === "webgl2") {
      return gl?.context ?? null;
    }
    return getContext.call(this, type as "2d", options);
  } as HTMLCanvasElement["getContext"];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
};

export const uninstallWebGL2 = () => {
  HTMLCanvasElement.prototype.getContext = getContext;
  vi.unstubAllGlobals();
};

export type PointerInit = {
  pointerType: "pen" | "mouse" | "touch";
  pointerId?: number;
  pressure?: number;
  isPrimary?: boolean;
  button?: number;
  buttons?: number;
  timeStamp?: number;
};

/**
 * A pointer event as a browser sends it to the interactive canvas, at client
 * (x, y). jsdom has no PointerEvent, so its fields are defined on an Event.
 */
export const sendPointer = (
  type: string,
  x: number,
  y: number,
  init: PointerInit,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerType: { value: init.pointerType },
    pointerId: { value: init.pointerId ?? 1 },
    pressure: {
      value: init.pressure ?? (init.pointerType === "pen" ? 0.6 : 0.5),
    },
    isPrimary: { value: init.isPrimary ?? true },
    button: { value: init.button ?? (type === "pointermove" ? -1 : 0) },
    buttons: { value: init.buttons ?? (type === "pointerup" ? 0 : 1) },
    timeStamp: { value: init.timeStamp ?? window.performance.now() },
  });
  act(() => {
    GlobalTestState.interactiveCanvas.dispatchEvent(event);
  });
  return event;
};

/** A stroke through client points; the pen lifts where it last moved. */
export const sendStroke = (
  points: readonly (readonly [number, number])[],
  init: PointerInit,
  { pressures }: { pressures?: readonly number[] } = {},
) => {
  const at = (i: number) => ({
    ...init,
    pressure: pressures?.[i] ?? init.pressure,
  });
  const [first, ...rest] = points;
  sendPointer("pointerdown", first[0], first[1], at(0));
  rest.forEach(([x, y], i) => sendPointer("pointermove", x, y, at(i + 1)));
  const last = points[points.length - 1];
  sendPointer("pointerup", last[0], last[1], at(points.length - 1));
};
