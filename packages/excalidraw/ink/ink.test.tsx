import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { Keyboard, UI } from "../tests/helpers/ui";
import {
  installWebGL2,
  sendPointer,
  sendStroke,
  uninstallWebGL2,
} from "../tests/helpers/webgl";
import { act, render } from "../tests/test-utils";

import type { FakeGPU, PointerInit } from "../tests/helpers/webgl";
import type { ExcalidrawProps } from "../types";

const { h } = window;

let gpu: FakeGPU;
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

/** `steps` moves of 20px to the right, `ms` apart, then a lift. */
const stroke = (
  init: PointerInit,
  { x = 100, y = 100, steps = 4, ms = 30 } = {},
) => {
  sendPointer("pointerdown", x, y, { ...init, timeStamp: now });
  for (let i = 1; i <= steps; i++) {
    now += ms;
    sendPointer("pointermove", x + i * 20, y + (i % 2) * 10, {
      ...init,
      timeStamp: now,
    });
  }
  sendPointer("pointerup", x + steps * 20 + 5, y, { ...init, timeStamp: now });
};

const freedraws = () =>
  h.elements.filter(
    (e): e is ExcalidrawFreeDrawElement => e.type === "freedraw",
  );

const inked = () => gpu.contexts.some((gl) => gl.frames.length > 0);

const setup = async (props: Partial<ExcalidrawProps> = {}) => {
  await render(
    <Excalidraw freedrawRenderer="webgl" handleKeyboardGlobally {...props} />,
  );
  API.setAppState({ currentItemStrokeVariability: "variable" });
  UI.clickTool("freedraw");
};

beforeEach(() => {
  gpu = installWebGL2();
  now = 1_000;
  vi.spyOn(window.performance, "now").mockImplementation(() => now);
  listening = new AbortController();
});

afterEach(async () => {
  listening.abort();
  await act(async () => {});
  uninstallWebGL2();
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
      expect(inked()).toBe(true);
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

    it("should switch the editor to pen mode", () => {
      expect(h.state.penMode).toBe(true);
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

  describe("when the press is one the editor keeps", () => {
    const cases: [string, () => void][] = [
      [
        "the freedraw mode is set to constant width",
        () => API.setAppState({ currentItemStrokeVariability: "constant" }),
      ],
      [
        "the editor is in view mode",
        () => API.setAppState({ viewModeEnabled: true }),
      ],
      ["the rectangle tool is out", () => UI.clickTool("rectangle")],
    ];

    for (const [when, arrange] of cases) {
      describe(`when ${when}`, () => {
        beforeEach(async () => {
          await setup();
          arrange();
          stroke({ pointerType: "pen" });
        });

        it("should leave the press to the editor", () => {
          expect(inked()).toBe(false);
        });
      });
    }

    describe("when the pen is flipped to its eraser", () => {
      let tool: string;

      beforeEach(async () => {
        await setup();
        sendPointer("pointerdown", 100, 100, {
          pointerType: "pen",
          button: 5,
          buttons: 32,
        });
        tool = h.state.activeTool.type;
        sendPointer("pointerup", 100, 100, { pointerType: "pen", button: 5 });
      });

      it("should leave it to the editor, which erases with it", () => {
        expect(tool).toBe("eraser");
      });
    });

    describe("when the space bar is held to pan", () => {
      beforeEach(async () => {
        await setup();
        Keyboard.keyDown(" ");
        stroke({ pointerType: "pen" });
        Keyboard.keyUp(" ");
      });

      it("should let the editor pan", () => {
        expect(inked()).toBe(false);
      });
    });

    describe("when a mouse presses while a pen stroke is going", () => {
      let pointerDowns: number;

      beforeEach(async () => {
        await setup();
        pointerDowns = 0;
        h.app.onPointerDownEmitter.on(() => pointerDowns++);
        sendPointer("pointerdown", 100, 100, { pointerType: "pen" });
        sendPointer("pointerdown", 300, 300, {
          pointerType: "mouse",
          pointerId: 9,
        });
        sendPointer("pointerup", 300, 300, {
          pointerType: "mouse",
          pointerId: 9,
        });
        sendPointer("pointerup", 140, 100, { pointerType: "pen" });
      });

      it("should leave the mouse to the editor rather than start a second", () => {
        expect(pointerDowns).toBe(1);
      });
    });
  });

  describe("when the browser has no WebGL2", () => {
    beforeEach(async () => {
      uninstallWebGL2();
      installWebGL2(null);
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
      sendPointer("pointerdown", 100, 100, { pointerType: "pen" });
      mid = h.app.api.getInkStatus()?.inking;
      sendPointer("pointerup", 140, 100, { pointerType: "pen" });
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
      API.setElements([
        API.createElement({ type: "rectangle", x: 400, y: 400 }),
      ]);
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

    it("should report the place in the stacking order it is committed at", () => {
      expect(progress.map((e) => e.index)).toEqual([
        freedraws()[0].index,
        freedraws()[0].index,
      ]);
    });

    it("should stack the stroke above everything already there", () => {
      expect(h.elements.at(-1)?.id).toBe(freedraws()[0].id);
    });
  });

  describe("when the host turns the layer off mid-stroke", () => {
    let progress: ExcalidrawFreeDrawElement[];

    beforeEach(async () => {
      progress = [];
      const props = {
        handleKeyboardGlobally: true,
        onFreedrawProgress: (e: ExcalidrawFreeDrawElement) => progress.push(e),
      };
      const { rerender } = await render(
        <Excalidraw freedrawRenderer="webgl" {...props} />,
      );
      API.setAppState({ currentItemStrokeVariability: "variable" });
      UI.clickTool("freedraw");
      sendPointer("pointerdown", 100, 100, { pointerType: "pen" });
      for (let i = 1; i <= 4; i++) {
        now += 30;
        sendPointer("pointermove", 100 + i * 20, 100, { pointerType: "pen" });
      }
      rerender(<Excalidraw freedrawRenderer="canvas" {...props} />);
    });

    it("should take the stroke back from collaborators", () => {
      expect(progress.at(-1)?.isDeleted).toBe(true);
    });

    it("should commit nothing", () => {
      expect(freedraws()).toHaveLength(0);
    });
  });

  describe("when a finger draws", () => {
    describe("when the host has no camera layer to pinch", () => {
      beforeEach(async () => {
        await setup();
        stroke({ pointerType: "touch" });
      });

      it("should leave the finger to the editor, which pinches by itself", () => {
        expect(inked()).toBe(false);
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
        sendPointer("pointerdown", 100, 100, { ...finger, timeStamp: now });
      });

      it("should draw the finger's stroke", () => {
        expect(inked()).toBe(true);
      });

      describe("when a second finger lands 120ms in, to pinch", () => {
        let later: string[];

        beforeEach(() => {
          later = listenLater();
          for (let i = 1; i <= 4; i++) {
            now += 30;
            sendPointer("pointermove", 100 + i * 5, 100, {
              ...finger,
              timeStamp: now,
            });
          }
          sendPointer("pointerdown", 300, 300, { ...second, timeStamp: now });
          sendPointer("pointermove", 320, 320, second);
          sendPointer("pointerup", 320, 320, second);
          sendPointer("pointerup", 130, 100, finger);
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

      describe("when a second finger lands just as the pinch window closes", () => {
        beforeEach(() => {
          now += 300;
          sendPointer("pointermove", 160, 100, { ...finger, timeStamp: now });
          sendPointer("pointerdown", 300, 300, { ...second, timeStamp: now });
          sendPointer("pointerup", 300, 300, second);
          sendPointer("pointerup", 160, 100, finger);
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
        sendPointer("pointerdown", 100, 100, { pointerType: "pen" });
        sendPointer("pointerup", 100, 100, { pointerType: "pen" });
      });

      it("should not start a stroke that would land in the wrong place", () => {
        expect(inked()).toBe(false);
      });
    });

    describe("when pen mode is on", () => {
      beforeEach(async () => {
        await setup({
          cameraLayer: { ready: () => true, moving: () => false },
        });
        API.setAppState({ penMode: true, penDetected: true });
        sendPointer("pointerdown", 100, 100, { pointerType: "touch" });
        sendPointer("pointerup", 100, 100, { pointerType: "touch" });
      });

      it("should leave the finger to navigate", () => {
        expect(inked()).toBe(false);
      });
    });
  });

  describe("when the host renders with a new camera layer object each time", () => {
    let renders: number;

    beforeEach(async () => {
      const camera = () => ({ ready: () => true, moving: () => false });
      const { rerender } = await render(
        <Excalidraw freedrawRenderer="webgl" cameraLayer={camera()} />,
      );
      const render_ = vi.spyOn(h.app, "render");
      rerender(<Excalidraw freedrawRenderer="webgl" cameraLayer={camera()} />);
      renders = render_.mock.calls.length;
    });

    it("should not re-render the editor", () => {
      expect(renders).toBe(0);
    });
  });

  describe("when a pen taps without moving", () => {
    beforeEach(async () => {
      await setup();
      sendStroke([[200, 200]], { pointerType: "pen", pressure: 0.7 });
    });

    it("should nudge a second point off the first so the dot renders", () => {
      expect(freedraws()[0].points).toEqual([
        [0, 0],
        [0.0001, 0.0001],
      ]);
    });

    it("should give the nudge the tap's pressure", () => {
      expect(freedraws()[0].pressures).toEqual([0.7, 0.7]);
    });
  });
});
