import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEEP_CENTER } from "./scenes";

import type { SceneName } from "./scenes";

export type Scenario = {
  id: string;
  scene: SceneName;
  steps: number;
  begin: (api: ExcalidrawImperativeAPI, canvas: HTMLCanvasElement) => void;
  step: (canvas: HTMLCanvasElement, i: number) => void;
  end: (canvas: HTMLCanvasElement) => void;
};

type PointerInit = {
  id?: number;
  kind?: "mouse" | "touch" | "pen";
  buttons?: number;
};

const pointer = (
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  { id = 1, kind = "mouse", buttons = 1 }: PointerInit = {},
) =>
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: kind,
      isPrimary: id === 1 || id === 11,
      button: type === "pointermove" ? -1 : 0,
      buttons: type === "pointerup" ? 0 : buttons,
      pressure: type === "pointerup" ? 0 : 0.5,
    }),
  );

const wheel = (canvas: HTMLCanvasElement, x: number, y: number, dy: number) =>
  canvas.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      deltaY: dy,
      ctrlKey: true,
    }),
  );

const center = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

const select = (api: ExcalidrawImperativeAPI) =>
  api.setActiveTool({ type: "selection" });

const pan = (scene: SceneName, steps: number): Scenario => {
  let origin = { x: 0, y: 0 };
  return {
    id: `${scene}/pan`,
    scene,
    steps,
    begin: (api, canvas) => {
      api.setActiveTool({ type: "hand" });
      origin = center(canvas);
      pointer(canvas, "pointerdown", origin.x, origin.y);
    },
    step: (canvas, i) =>
      pointer(
        canvas,
        "pointermove",
        origin.x - 9 * i,
        origin.y - 4 * i + Math.sin(i / 10) * 30,
      ),
    end: (canvas) =>
      pointer(canvas, "pointerup", origin.x - 9 * steps, origin.y - 4 * steps),
  };
};

const zoom = (
  scene: SceneName,
  outSteps: number,
  inSteps: number,
  tick: number,
  anchor: (
    api: ExcalidrawImperativeAPI,
    canvas: HTMLCanvasElement,
  ) => {
    x: number;
    y: number;
  },
): Scenario => {
  let at = { x: 0, y: 0 };
  return {
    id: `${scene}/zoom`,
    scene,
    steps: outSteps + inSteps,
    begin: (api, canvas) => {
      select(api);
      at = anchor(api, canvas);
      pointer(canvas, "pointermove", at.x, at.y, { buttons: 0 });
    },
    step: (canvas, i) => wheel(canvas, at.x, at.y, i < outSteps ? tick : -tick),
    end: () => {},
  };
};

const pinch = (scene: SceneName, steps: number): Scenario => {
  let mid = { x: 0, y: 0 };
  const at = (i: number) => {
    const t = i / steps;
    const spread = 60 + 240 * Math.sin(t * Math.PI);
    const angle = t * Math.PI * 2;
    return {
      x: mid.x + Math.cos(angle) * 60,
      y: mid.y + Math.sin(angle) * 60,
      spread,
    };
  };
  return {
    id: `${scene}/pinch`,
    scene,
    steps,
    begin: (api, canvas) => {
      select(api);
      mid = center(canvas);
      const { x, y, spread } = at(0);
      pointer(canvas, "pointerdown", x - spread, y, { id: 11, kind: "touch" });
      pointer(canvas, "pointerdown", x + spread, y, { id: 12, kind: "touch" });
    },
    step: (canvas, i) => {
      const { x, y, spread } = at(i);
      pointer(canvas, "pointermove", x - spread, y, { id: 11, kind: "touch" });
      pointer(canvas, "pointermove", x + spread, y, { id: 12, kind: "touch" });
    },
    end: (canvas) => {
      const { x, y, spread } = at(steps);
      pointer(canvas, "pointerup", x - spread, y, { id: 11, kind: "touch" });
      pointer(canvas, "pointerup", x + spread, y, { id: 12, kind: "touch" });
    },
  };
};

const freedraw = (scene: SceneName, steps: number): Scenario => {
  let origin = { x: 0, y: 0 };
  let width = 0;
  const at = (i: number) => ({
    x: origin.x + (i / steps) * width + Math.sin(i / 4) * 30,
    y: origin.y + Math.cos(i / 4) * 40,
  });
  return {
    id: `${scene}/freedraw`,
    scene,
    steps,
    begin: (api, canvas) => {
      api.setActiveTool({ type: "freedraw" });
      const rect = canvas.getBoundingClientRect();
      width = rect.width * 0.6;
      origin = { x: rect.left + rect.width * 0.2, y: center(canvas).y };
      const { x, y } = at(0);
      pointer(canvas, "pointerdown", x, y, { kind: "pen" });
    },
    step: (canvas, i) => {
      const { x, y } = at(i);
      pointer(canvas, "pointermove", x, y, { kind: "pen" });
    },
    end: (canvas) => {
      const { x, y } = at(steps);
      pointer(canvas, "pointerup", x, y, { kind: "pen" });
    },
  };
};

const deepAnchor = (
  api: ExcalidrawImperativeAPI,
  canvas: HTMLCanvasElement,
) => {
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = api.getAppState();
  const rect = canvas.getBoundingClientRect();
  return {
    x:
      rect.left -
      offsetLeft +
      (DEEP_CENTER.x + scrollX) * zoom.value +
      offsetLeft,
    y:
      rect.top - offsetTop + (DEEP_CENTER.y + scrollY) * zoom.value + offsetTop,
  };
};

export const SCENARIOS: Scenario[] = [
  pan("mixed", 200),
  zoom("mixed", 60, 120, 3, (_, canvas) => center(canvas)),
  pinch("mixed", 160),
  freedraw("mixed", 240),
  pan("freedraw", 200),
  zoom("freedraw", 40, 100, 3, (_, canvas) => center(canvas)),
  pinch("freedraw", 160),
  freedraw("freedraw", 240),
  zoom("deep", 0, 130, 10, deepAnchor),
  pinch("deep", 120),
  pan("deep", 120),
];
