import {
  DEFAULT_STROKE_STREAMLINE,
  DEFAULT_STROKE_STREAMLINE_PRECISE,
} from "@excalidraw/common";

export type Press = {
  pointerType: string;
  button: number;
  buttons: number;
  isPrimary: boolean;
  /** The press landed on the interactive canvas, not the UI. */
  onCanvas: boolean;
};

export type Editor = {
  activeTool: { type: string };
  /** Off in view mode, or while the host has turned interaction off. */
  interactive: boolean;
  holdingSpace: boolean;
  inking: boolean;
  /** Pen mode, on once a pen has touched: fingers only navigate. */
  penMode: boolean;
  /** The host's camera layer is up to pinch; without one, the editor keeps the fingers. */
  pinchable: boolean;
  /** The ink layer only draws perfect-freehand's variable-width line. */
  currentItemStrokeVariability: "variable" | "constant";
};

export const ERASER_BUTTONS = 32;

/** Whether the ink layer draws this press instead of the editor. */
export const takesStroke = (p: Press, e: Editor) =>
  e.activeTool.type === "freedraw" &&
  e.interactive &&
  !e.holdingSpace &&
  !e.inking &&
  e.currentItemStrokeVariability === "variable" &&
  p.onCanvas &&
  p.isPrimary &&
  p.button === 0 &&
  (p.buttons & ERASER_BUTTONS) === 0 &&
  (p.pointerType === "pen" ||
    p.pointerType === "mouse" ||
    (p.pointerType === "touch" && !e.penMode && e.pinchable));

/** A finger stroke younger than this when another finger lands began a pinch. */
export const PINCH_WINDOW_MS = 300;

/**
 * Whether a finger stroke is dropped when a second finger lands `strokeAgeMs`
 * after it began; an older one was meant, and is kept as it stands.
 */
export const dropsForPinch = (strokeAgeMs: number) =>
  strokeAgeMs < PINCH_WINDOW_MS;

/**
 * A mouse always reports 0.5 while pressed, so its pressure is simulated. A
 * pen can land at exactly 0.5 too, and still means it.
 */
export const simulatesPressure = (p: {
  pointerType: string;
  pressure: number;
}) => p.pointerType !== "pen" && p.pressure === 0.5;

/** A mouse is smoothed more than a pen or a finger. */
export const streamlineFor = (pointerType: string) =>
  pointerType === "mouse"
    ? DEFAULT_STROKE_STREAMLINE
    : DEFAULT_STROKE_STREAMLINE_PRECISE;

/**
 * Chromium offers the delegated ink trail everywhere, but only Windows draws
 * it; elsewhere a presenter accepts every call and draws nothing.
 */
export const trailWorks = (nav: { platform?: string; userAgent?: string }) =>
  nav.platform
    ? nav.platform === "Windows"
    : /Windows/.test(nav.userAgent ?? "");

/**
 * Chromium on Android shows a desynchronized canvas without its alpha, so the
 * whole scene goes black under a stroke. Without userAgentData (other
 * engines, or any page that is not a secure context) the platform is unknown.
 */
export const desynchronizes = (nav: { userAgentData?: { platform: string } }) =>
  !!nav.userAgentData && nav.userAgentData.platform !== "Android";
