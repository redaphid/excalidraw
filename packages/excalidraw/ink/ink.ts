import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";

import { inkColor } from "./color";
import { freedrawThrough, indexAfter, newFreedrawAt } from "./element";
import { desynchronizes, dropsForPinch, takesStroke, trailWorks } from "./gate";
import { createInkRenderer } from "./gl";
import { createStroke } from "./stroke";

import type App from "../components/App";
import type { AppState } from "../types";
import type { Rgba } from "./color";
import type { Freedraw } from "./element";
import type { View } from "./gl";
import type { Dab, Sample, Stroke } from "./stroke";

// The editor draws a freedraw stroke by re-rendering its whole React tree and
// rebuilding the full outline on a 2D canvas for every pointer move, work
// that grows with the stroke and the scene. The ink layer takes those strokes
// instead: once a frame it adds every coalesced sample in O(1), draws on the
// GPU, and hands the editor one finished element on pointerup. A finger's
// stroke is taken too while the host's camera layer can pinch, except in pen
// mode, where fingers only navigate. A second finger ends it, dropped within
// PINCH_WINDOW_MS and kept after, and the pair goes to the camera layer. The
// pen's eraser end, other tools and space-to-pan still go to the editor.
//
// On Windows, Chromium also offers a delegated ink trail: after each render
// the OS compositor is told where the drawn stroke ends, and it draws the
// rest of the way to the pen from hardware input, skipping the browser's
// pipeline altogether. Where it exists, it replaces the predicted tail.
//
// Each pointer is in one of three states. Idle: the editor has it. Drawing:
// the ink layer has it, as `active`, until it lifts (committed), is
// cancelled (committed as it stands), or a second finger lands (dropped or
// committed). Hidden: a finger of a pinch, kept from the editor until it
// lifts so the camera layer has it alone.

type TrailStyle = { color: string; diameter: number };
type InkPresenter = {
  updateInkTrailStartPoint(e: PointerEvent, style: TrailStyle): void;
};
type DelegatedInk = {
  requestPresenter(o: { presentationArea?: Element }): Promise<InkPresenter>;
};

export type InkStatus = {
  /** A stroke is being drawn. */
  inking: boolean;
  /** WebGL runs on a GPU, not in software. */
  gpu: boolean;
  /** The OS draws the newest part of the stroke (Chromium on Windows). */
  trail: boolean;
};

export type Ink = {
  detach(): void;
  status(): InkStatus;
};

const STREAM_MS = 80;
/** Half a CSS pixel: finer than any pen reports on purpose. */
const MIN_STEP_PX = 0.5;

const viewOf = (s: AppState, dpr: number): View => ({
  scrollX: s.scrollX,
  scrollY: s.scrollY,
  zoom: s.zoom.value,
  dpr,
});

const resolver = (doc: Document) => {
  const cache = new Map<string, Rgba>();
  const probe = doc.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  return (css: string): Rgba => {
    const known = cache.get(css);
    if (known) {
      return known;
    }
    if (!probe) {
      return [0, 0, 0, 1];
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = probe.getImageData(0, 0, 1, 1).data;
    const rgba: Rgba = [r / 255, g / 255, b / 255, a / 255];
    cache.set(css, rgba);
    return rgba;
  };
};

const samplesOf = (e: PointerEvent) => {
  const coalesced = e.getCoalescedEvents?.() ?? [];
  return coalesced.length > 0 ? coalesced : [e];
};

const cssColor = ([r, g, b, a]: Rgba) =>
  a === 0
    ? "transparent"
    : `rgba(${[r, g, b].map((c) => Math.round((c / a) * 255)).join(",")},${a})`;

type Drawing = {
  pointerId: number;
  pointerType: string;
  /** The pointerdown's timeStamp: when the finger or pen touched. */
  startedAt: number;
  color: string;
  stroke: Stroke;
  /** The element as last streamed, or as it started. */
  element: Freedraw;
  streamed: boolean;
  tip: Sample;
  client: { x: number; y: number };
  streamedAt: number;
};

/** Null when this browser has no WebGL2, which leaves freedraw to the editor. */
export const attachInk = (app: App, canvas: HTMLCanvasElement): Ink | null => {
  const win = app.ownerWindow;
  const nav = win.navigator as Navigator & {
    ink?: DelegatedInk;
    userAgentData?: { platform: string };
  };
  const renderer = createInkRenderer(canvas, {
    desynchronized: desynchronizes(nav),
  });
  if (!renderer) {
    return null;
  }
  const resolve = resolver(app.ownerDocument);
  // Sized ahead of time: resizing a full-screen canvas on pen-down costs the
  // very first frame of the stroke.
  // Without a GPU, a quarter of the pixels at 2x: the ink is only on screen
  // until the crisp committed stroke replaces it.
  const scale = () => (renderer.software ? 1 : win.devicePixelRatio);
  const fit = () => renderer.fit(scale());
  const resized = new win.ResizeObserver(fit);
  resized.observe(canvas);
  fit();
  renderer.clear();
  let presenter: InkPresenter | null = null;
  let detached = false;
  // Elsewhere a presenter exists but draws nothing, and holding one would
  // switch off the predicted tail.
  const delegated = trailWorks(nav.userAgentData ?? nav) ? nav.ink : undefined;
  delegated
    ?.requestPresenter({ presentationArea: canvas })
    .then((p) => {
      if (!detached) {
        presenter = p;
      }
    })
    .catch(() => {});
  let active: Drawing | null = null;
  /** Fingers of a pinch that began on a finger stroke, until they lift. */
  const hidden = new Set<number>();
  let generation = 0;

  const toScene = (e: { clientX: number; clientY: number }) =>
    viewportCoordsToSceneCoords(e, app.state);

  const mine = (e: PointerEvent) => active?.pointerId === e.pointerId;

  // The editor never sees ink's pointers. A finger still reaches the camera
  // layer, a later listener on this window, which tracks fingers to pinch; a
  // pen or mouse does not, so the camera layer's overlay stays up under the
  // ink.
  const hide = (e: PointerEvent) =>
    e.pointerType === "touch"
      ? e.stopPropagation()
      : e.stopImmediatePropagation();

  const feed = (a: Drawing, e: PointerEvent) => {
    for (const c of samplesOf(e)) {
      const sample = { ...toScene(c), pressure: c.pressure };
      const dab = a.stroke.add(sample);
      if (dab) {
        renderer.push(dab);
      }
      a.tip = sample;
    }
    a.client = { x: e.clientX, y: e.clientY };
  };

  const render = (a: Drawing, e: PointerEvent) => {
    const state = app.state;
    const tip = a.stroke.tip(a.tip);
    const tail: Dab[] = [tip];
    const predicted =
      presenter || e.type !== "pointermove"
        ? []
        : e.getPredictedEvents?.() ?? [];
    for (const p of predicted) {
      tail.push(a.stroke.tip({ ...toScene(p), pressure: a.tip.pressure }));
    }
    renderer.draw(viewOf(state, scale()), tail);
    try {
      presenter?.updateInkTrailStartPoint(e, {
        color: a.color,
        diameter: 2 * tip.r * state.zoom.value,
      });
    } catch {
      presenter = null;
    }
  };

  const pointer = (a: Drawing, button: "up" | "down") =>
    app.savePointer(a.client.x, a.client.y, button);

  const stream = (a: Drawing) => {
    const progress = app.props.onFreedrawProgress;
    const now = win.performance.now();
    if (!progress || now - a.streamedAt < STREAM_MS) {
      return;
    }
    a.streamedAt = now;
    a.streamed = true;
    a.element = freedrawThrough(a.element, a.stroke.samples());
    progress(a.element);
  };

  /** Commits the stroke; `last` is where the pointer lifted, if it did. */
  const finish = (a: Drawing, last?: Sample) => {
    active = null;
    if (last) {
      const dab = a.stroke.add(last);
      if (dab) {
        renderer.push(dab);
      }
    }
    const element = freedrawThrough(a.element, a.stroke.samples());
    app.updateScene({
      elements: [...app.scene.getElementsIncludingDeleted(), element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    pointer(a, "up");
    // Keep the ink up until the editor has painted the committed stroke
    // beneath it, so the hand-off never flickers.
    const drawn = generation;
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        if (drawn === generation && !active) {
          renderer.clear();
        }
      }),
    );
  };

  /** Takes the stroke back, from collaborators too if it was streamed. */
  const drop = (a: Drawing) => {
    active = null;
    renderer.clear();
    pointer(a, "up");
    if (a.streamed) {
      app.props.onFreedrawProgress?.(
        newElementWith<ExcalidrawFreeDrawElement>(a.element, {
          isDeleted: true,
        }),
      );
    }
  };

  const onDown = (e: PointerEvent) => {
    // A second finger on a finger stroke makes the pair a pinch.
    if (e.pointerType === "touch" && active?.pointerType === "touch") {
      hidden.add(active.pointerId);
      if (dropsForPinch(e.timeStamp - active.startedAt)) {
        drop(active);
      } else {
        finish(active);
      }
    }
    if (e.pointerType === "touch" && hidden.size > 0) {
      hide(e);
      hidden.add(e.pointerId);
      return;
    }
    const state = app.state;
    const camera = app.props.cameraLayer;
    const press = {
      pointerType: e.pointerType,
      button: e.button,
      buttons: e.buttons,
      isPrimary: e.isPrimary,
      onCanvas: e.target === app.interactiveCanvas,
    };
    const editor = {
      ...state,
      interactive: app.isInteractionEnabled() && !state.viewModeEnabled,
      holdingSpace: app.pan.isSpaceHeld(),
      inking: active !== null,
      pinchable: camera?.ready() ?? false,
    };
    if (!renderer.ready() || camera?.moving() || !takesStroke(press, editor)) {
      return;
    }
    hide(e);
    if (e.pointerType === "pen" && !state.penDetected) {
      app.setState({
        penMode: true,
        penDetected: true,
        currentItemStrokeVariability: "variable",
      });
    }

    const at = toScene(e);
    const element = {
      ...newFreedrawAt(app, at, e),
      index: indexAfter(app.scene.getElementsIncludingDeleted()),
    };
    const color = inkColor(element.strokeColor, {
      dark: state.theme === "dark",
      opacity: element.opacity,
      resolve,
    });
    active = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startedAt: e.timeStamp,
      color: cssColor(color),
      stroke: createStroke({
        strokeWidth: element.strokeWidth,
        simulatePressure: element.simulatePressure,
        streamline: element.strokeOptions.streamline,
        minStep: MIN_STEP_PX / state.zoom.value,
      }),
      element,
      streamed: false,
      tip: { ...at, pressure: e.pressure },
      client: { x: e.clientX, y: e.clientY },
      streamedAt: win.performance.now(),
    };
    generation++;
    renderer.begin(color, at);
    feed(active, e);
    render(active, e);
    if (e.target instanceof win.Element) {
      e.target.setPointerCapture(e.pointerId);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (hidden.has(e.pointerId)) {
      return hide(e);
    }
    if (!active || !mine(e)) {
      return;
    }
    hide(e);
    // Once a frame, with every sample since the last in getCoalescedEvents.
    // Drawing more often than frames are shown only queues GPU work; on
    // Windows the OS trail covers the newest few milliseconds instead.
    feed(active, e);
    render(active, e);
    pointer(active, "down");
    stream(active);
  };

  const onUp = (e: PointerEvent) => {
    if (hidden.delete(e.pointerId)) {
      return hide(e);
    }
    if (!active || !mine(e)) {
      return;
    }
    hide(e);
    // A cancelled pointer reports no position worth keeping (often 0,0), so
    // only a real lift adds the final sample, as the editor's pointerup does.
    if (e.type !== "pointerup") {
      return finish(active);
    }
    active.client = { x: e.clientX, y: e.clientY };
    finish(active, { ...toScene(e), pressure: e.pressure });
  };

  const capture = { capture: true };
  const listeners = [
    ["pointerdown", onDown],
    ["pointermove", onMove],
    ["pointerup", onUp],
    ["pointercancel", onUp],
  ] as [string, EventListener][];
  for (const [type, fn] of listeners) {
    win.addEventListener(type, fn, capture);
  }

  return {
    detach() {
      detached = true;
      resized.disconnect();
      presenter = null;
      for (const [type, fn] of listeners) {
        win.removeEventListener(type, fn, capture);
      }
      renderer.dispose();
    },
    status: () => ({
      inking: active !== null,
      gpu: renderer.ready() && !renderer.software,
      trail: presenter !== null,
    }),
  };
};
