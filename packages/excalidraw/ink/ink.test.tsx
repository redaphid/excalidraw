import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Keyboard, UI } from "../tests/helpers/ui";
import { act, GlobalTestState, render } from "../tests/test-utils";

import type { ExcalidrawProps } from "../types";
import type { InkRenderer } from "./gl";

const { h } = window;

const gpu = vi.hoisted(() => ({
  renderer: null as InkRenderer | null,
  begun: 0,
}));

vi.mock("./gl", () => ({
  createInkRenderer: () => gpu.renderer,
}));

const fakeRenderer = (): InkRenderer => ({
  ready: () => true,
  software: false,
  fit: () => {},
  begin: () => {
    gpu.begun++;
  },
  push: () => {},
  draw: () => {},
  clear: () => {},
  dispose: () => {},
});

let now = 0;
/** Ends the window listeners a test adds, as the camera layer would add them. */
let listening = new AbortController();

/** Records which pointer events reach a window listener added after the editor's. */
const listenLater = () => {
  const heard: string[] = [];
  const listen = (e: Event) => heard.push(e.type);
  for (const type of ["pointerdown", "pointerup"]) {
    window.addEventListener(type, listen, {
      capture: true,
      signal: listening.signal,
    });
  }
  return heard;
};

type Init = {
  pointerType: "pen" | "mouse" | "touch";
  pointerId?: number;
  pressure?: number;
  isPrimary?: boolean;
  button?: number;
  buttons?: number;
};

/** A pointer event as a browser sends it, at `now` and at client (x, y). */
const send = (type: string, x: number, y: number, init: Init) => {
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
    timeStamp: { value: now },
  });
  act(() => {
    GlobalTestState.interactiveCanvas.dispatchEvent(event);
  });
  return event;
};

/** Draws a stroke from (x, y) to the right, `steps` moves of 20px, `ms` apart. */
const stroke = (init: Init, { x = 100, y = 100, steps = 4, ms = 30 } = {}) => {
  send("pointerdown", x, y, init);
  for (let i = 1; i <= steps; i++) {
    now += ms;
    send("pointermove", x + i * 20, y + (i % 2) * 10, init);
  }
  send("pointerup", x + steps * 20 + 5, y, init);
};

const freedraws = () =>
  h.elements.filter(
    (e): e is ExcalidrawFreeDrawElement => e.type === "freedraw",
  );

const setup = async (props: Partial<ExcalidrawProps> = {}) => {
  await render(
    <Excalidraw freedrawRenderer="webgl" handleKeyboardGlobally {...props} />,
  );
  API.setAppState({ currentItemStrokeVariability: "variable" });
  UI.clickTool("freedraw");
};

beforeEach(() => {
  gpu.renderer = fakeRenderer();
  gpu.begun = 0;
  now = 1_000;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window.performance, "now").mockImplementation(() => now);
  listening = new AbortController();
});

afterEach(async () => {
  listening.abort();
  await act(async () => {});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the webgl freedraw renderer", () => {
  describe("when a pen draws a stroke", () => {
    let pointerDowns: number;
    let later: string[];

    beforeEach(async () => {
      await setup();
      pointerDowns = 0;
      h.app.onPointerDownEmitter.on(() => pointerDowns++);
      later = listenLater();
      stroke({ pointerType: "pen", pressure: 0.5 });
    });

    it("should draw it on the GPU", () => {
      expect(gpu.begun).toBe(1);
    });

    it("should keep the stroke from the editor while it is drawn", () => {
      expect(pointerDowns).toBe(0);
    });

    it("should keep the pen from the camera layer's window listeners", () => {
      expect(later).toEqual([]);
    });

    it("should commit one freedraw element", () => {
      expect(freedraws()).toHaveLength(1);
    });

    it("should keep every point the pen passed through", () => {
      expect(freedraws()[0].points).toHaveLength(6);
    });

    it("should trust the pen's pressure, even at exactly half", () => {
      expect(freedraws()[0].simulatePressure).toBe(false);
    });

    it("should draw the variable-width line the GPU drew", () => {
      expect(freedraws()[0].strokeOptions.variability).toBe("variable");
    });

    it("should leave no stroke in progress", () => {
      expect(h.state.newElement).toBeNull();
    });

    describe("when the keeper undoes", () => {
      beforeEach(() => {
        Keyboard.undo();
      });

      it("should take the whole stroke back in one step", () => {
        expect(freedraws().filter((e) => !e.isDeleted)).toHaveLength(0);
      });

      describe("when the keeper redoes", () => {
        beforeEach(() => {
          Keyboard.redo();
        });

        it("should put the whole stroke back", () => {
          expect(freedraws().filter((e) => !e.isDeleted)).toHaveLength(1);
        });
      });
    });
  });

  describe("when a mouse draws a stroke", () => {
    beforeEach(async () => {
      await setup();
      stroke({ pointerType: "mouse" });
    });

    it("should simulate its pressure", () => {
      expect(freedraws()[0].simulatePressure).toBe(true);
    });

    it("should smooth it as the editor smooths a mouse", () => {
      expect(freedraws()[0].strokeOptions.streamline).toBe(0.5);
    });
  });

  describe("when the freedraw mode is set to constant width", () => {
    beforeEach(async () => {
      await setup();
      API.setAppState({ currentItemStrokeVariability: "constant" });
      stroke({ pointerType: "pen" });
    });

    it("should leave the stroke to the editor", () => {
      expect(gpu.begun).toBe(0);
    });

    it("should still draw it", () => {
      expect(freedraws()[0].strokeOptions.variability).toBe("constant");
    });
  });

  describe("when the browser has no WebGL2", () => {
    beforeEach(async () => {
      gpu.renderer = null;
      await setup();
      stroke({ pointerType: "pen" });
    });

    it("should report no ink layer", () => {
      expect(h.app.api.getInkStatus()).toBeNull();
    });

    it("should draw the stroke the editor's way", () => {
      expect(freedraws()).toHaveLength(1);
    });
  });

  describe("when the renderer is left at its default", () => {
    beforeEach(async () => {
      await render(<Excalidraw />);
    });

    it("should run no ink layer", () => {
      expect(h.app.api.getInkStatus()).toBeNull();
    });
  });

  describe("when asked for its status mid-stroke", () => {
    let mid: boolean | undefined;
    let after: boolean | undefined;

    beforeEach(async () => {
      await setup();
      send("pointerdown", 100, 100, { pointerType: "pen" });
      mid = h.app.api.getInkStatus()?.inking;
      send("pointerup", 140, 100, { pointerType: "pen" });
      after = h.app.api.getInkStatus()?.inking;
    });

    it("should be inking while the pen is down", () => {
      expect(mid).toBe(true);
    });

    it("should stop once it lifts", () => {
      expect(after).toBe(false);
    });
  });

  describe("when the host streams strokes to collaborators", () => {
    let progress: ExcalidrawFreeDrawElement[];

    beforeEach(async () => {
      progress = [];
      await setup({ onFreedrawProgress: (e) => progress.push(e) });
      stroke({ pointerType: "pen" }, { steps: 6, ms: 30 });
    });

    it("should report the stroke so far about every 80ms", () => {
      expect(progress).toHaveLength(2);
    });

    it("should report the element that is then committed", () => {
      expect(new Set(progress.map((e) => e.id))).toEqual(
        new Set([freedraws()[0].id]),
      );
    });

    it("should commit a version newer than any it reported", () => {
      expect(freedraws()[0].version).toBeGreaterThan(
        Math.max(...progress.map((e) => e.version)),
      );
    });

    it("should report each with a stable place in the stacking order", () => {
      expect(progress.map((e) => e.index)).toEqual([
        freedraws()[0].index,
        freedraws()[0].index,
      ]);
    });
  });

  describe("when a finger draws", () => {
    describe("when the host has no camera layer to pinch", () => {
      beforeEach(async () => {
        await setup();
        stroke({ pointerType: "touch" });
      });

      it("should leave the finger to the editor, which pinches by itself", () => {
        expect(gpu.begun).toBe(0);
      });
    });

    describe("when the host's camera layer is up to pinch", () => {
      let progress: ExcalidrawFreeDrawElement[];
      let pointerDowns: number;

      const finger = { pointerType: "touch" as const, pointerId: 1 };
      const second = {
        pointerType: "touch" as const,
        pointerId: 2,
        isPrimary: false,
      };

      beforeEach(async () => {
        progress = [];
        await setup({
          cameraLayer: { ready: () => true, moving: () => false },
          onFreedrawProgress: (e) => progress.push(e),
        });
        pointerDowns = 0;
        h.app.onPointerDownEmitter.on(() => pointerDowns++);
        send("pointerdown", 100, 100, finger);
      });

      it("should draw the finger's stroke", () => {
        expect(gpu.begun).toBe(1);
      });

      describe("when a second finger lands 120ms in, to pinch", () => {
        let later: string[];

        beforeEach(() => {
          later = listenLater();
          for (let i = 1; i <= 4; i++) {
            now += 30;
            send("pointermove", 100 + i * 5, 100, finger);
          }
          send("pointerdown", 300, 300, second);
          send("pointermove", 320, 320, second);
          send("pointerup", 320, 320, second);
          send("pointerup", 130, 100, finger);
        });

        it("should drop the stroke", () => {
          expect(freedraws()).toHaveLength(0);
        });

        it("should take the stroke back from collaborators", () => {
          expect(progress.at(-1)?.isDeleted).toBe(true);
        });

        it("should keep both fingers from the editor", () => {
          expect(pointerDowns).toBe(0);
        });

        it("should leave the fingers to the camera layer's window listeners", () => {
          expect(later).toEqual(["pointerdown", "pointerup", "pointerup"]);
        });
      });

      describe("when a second finger lands 900ms in", () => {
        beforeEach(() => {
          now += 900;
          send("pointermove", 160, 100, finger);
          send("pointerdown", 300, 300, second);
          send("pointerup", 300, 300, second);
          send("pointerup", 160, 100, finger);
        });

        it("should keep the stroke, which was drawn on purpose", () => {
          expect(freedraws()).toHaveLength(1);
        });

        it("should keep both fingers from the editor", () => {
          expect(pointerDowns).toBe(0);
        });
      });
    });

    describe("when the host's camera layer is mid-gesture", () => {
      beforeEach(async () => {
        await setup({ cameraLayer: { ready: () => true, moving: () => true } });
        send("pointerdown", 100, 100, { pointerType: "pen" });
      });

      it("should not start a stroke that would land in the wrong place", () => {
        expect(gpu.begun).toBe(0);
      });
    });
  });

  describe("when pen mode is on and a finger draws", () => {
    beforeEach(async () => {
      await setup({ cameraLayer: { ready: () => true, moving: () => false } });
      API.setAppState({ penMode: true, penDetected: true });
      send("pointerdown", 100, 100, { pointerType: "touch" });
    });

    it("should leave the finger to navigate", () => {
      expect(gpu.begun).toBe(0);
    });
  });
});
