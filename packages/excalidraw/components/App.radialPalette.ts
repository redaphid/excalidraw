import {
  EVENT,
  POINTER_BUTTON,
  TOUCH_CTX_MENU_TIMEOUT,
} from "@excalidraw/common";

import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

import type { AppState } from "../types";
import type App from "./App";

/** how long a finger holds still to open the palette, in ms */
export const LONG_PRESS_DELAY = TOUCH_CTX_MENU_TIMEOUT;

/** how far a finger may drift and still count as holding still, in CSS px */
export const LONG_PRESS_TOLERANCE = 10;

/** the `buttons` bit of a pen's barrel button */
const BARREL_BUTTON = 2;

type Press = { pointerId: number; clientX: number; clientY: number };

/** a line being built point by point, as it was before a press */
export type MultiPointLine = Readonly<{
  id: string;
  points: ExcalidrawLinearElement["points"];
  /** the line editor's state, which knows the last committed point */
  selectedLinearElement: AppState["selectedLinearElement"];
}>;

const multiPointLine = (state: AppState): MultiPointLine | null =>
  state.multiElement && {
    id: state.multiElement.id,
    points: state.multiElement.points,
    selectedLinearElement: state.selectedLinearElement,
  };

/**
 * The input a `contextmenu` came from. It is a `PointerEvent` in Chromium;
 * Firefox may send a `MouseEvent` that names its source in `mozInputSource`.
 */
const pointerTypeOf = (event: MouseEvent): string | undefined => {
  if ("pointerType" in event && typeof event.pointerType === "string") {
    if (event.pointerType) {
      return event.pointerType;
    }
  }
  const source = (event as { mozInputSource?: number }).mozInputSource;
  // MouseEvent.MOZ_SOURCE_PEN and MOZ_SOURCE_TOUCH
  return source === 2 ? "pen" : source === 5 ? "touch" : undefined;
};

/**
 * Opens the radial palette from the canvas: a finger held still for
 * `LONG_PRESS_DELAY`, or a pen pressed with its barrel button held. While the
 * palette is on, these take the place of the touch context menu, which the
 * palette's hub opens instead.
 */
export class AppRadialPaletteGestures {
  private press:
    | (Press & {
        activeTool: AppState["activeTool"];
        multiPoint: MultiPointLine | null;
        timer: number;
        detach: () => void;
      })
    | null = null;
  private barrelHeld = false;

  constructor(
    private readonly app: App,
    private readonly dependencies: {
      /** pointers down on the canvas, this one included */
      getPointerCount: () => number;
      /** drops the press in progress, as if it had not happened, and puts
       * back the tool it started with */
      abandonPress: (
        pointerId: number,
        activeTool: AppState["activeTool"],
        multiPoint: MultiPointLine | null,
      ) => void;
      /** ends the press in progress as a lift at `event` would, keeping
       * what it drew */
      endPress: (event: PointerEvent) => void;
    },
  ) {}

  private get enabled() {
    const { app } = this;
    return !app.state.viewModeEnabled && app.isInteractionEnabled();
  }

  /** a long press is being timed */
  get isArmed() {
    return this.press !== null;
  }

  /** the pointer is a finger being timed for a long press: until it drifts
   * past the tolerance, the editor must not drag, draw or erase with it */
  holds(pointerId: number) {
    // only where drift moves what is there: drawing tools keep every point,
    // and a stroke is dropped anyway if the palette opens
    return (
      this.press?.pointerId === pointerId &&
      (this.press.activeTool.type === "selection" ||
        this.press.activeTool.type === "lasso")
    );
  }

  /** opens the palette at `point`; with `pointerId`, that pointer is down
   * and lifting it after a drag picks */
  private open(point: Omit<Press, "pointerId">, pointerId: number | null) {
    const at = { x: point.clientX, y: point.clientY };
    this.app.radialPalette.open({
      at,
      flick: pointerId === null ? null : { pointerId, start: at },
    });
  }

  /**
   * A pointerdown on the canvas. Returns true when it opened the palette, so
   * the editor must not act on it.
   */
  onPointerDown = (event: PointerEvent): boolean => {
    if (!this.enabled) {
      this.cancel();
      return false;
    }
    if (
      event.pointerType === "pen" &&
      (event.button === POINTER_BUTTON.SECONDARY ||
        event.buttons & BARREL_BUTTON)
    ) {
      this.cancel();
      this.barrelHeld = true;
      if (!this.app.radialPalette.session) {
        this.open(event, event.pointerId);
      }
      return true;
    }
    if (
      event.pointerType === "touch" &&
      this.dependencies.getPointerCount() === 1 &&
      !this.app.pan.isActive()
    ) {
      this.arm(event);
    } else {
      // a second finger: a pinch or a pan, never a long press
      this.cancel();
    }
    return false;
  };

  /** a pointermove over the canvas: a hovering pen's barrel button */
  onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "pen") {
      return;
    }
    const held = !!(event.buttons & BARREL_BUTTON);
    if (
      held &&
      !this.barrelHeld &&
      this.enabled &&
      !this.app.radialPalette.session
    ) {
      const tipDown = !!(event.buttons & 1);
      if (tipDown) {
        // mid-stroke: the stroke ends here, and the flick is the palette's
        this.dependencies.endPress(event);
      }
      this.open(event, tipDown ? event.pointerId : null);
    }
    this.barrelHeld = held;
  };

  /**
   * A `contextmenu` on the canvas. Returns true when it is the palette's: a
   * touch long press (which opens the palette now if still held still) or a
   * pen's barrel button.
   */
  onContextMenu = (event: MouseEvent): boolean => {
    if (!this.enabled) {
      return false;
    }
    // a press being timed is a finger, whatever the browser reports
    const type = this.press ? "touch" : pointerTypeOf(event);
    if (type === "touch") {
      this.fire();
      return true;
    }
    if (type === "pen") {
      this.cancel();
      if (!this.app.radialPalette.session) {
        this.open(event, null);
      }
      return true;
    }
    return false;
  };

  private arm(event: PointerEvent) {
    this.cancel();
    const { pointerId, clientX, clientY } = event;
    const win = this.app.ownerWindow;
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId || !this.press) {
        return;
      }
      if (
        Math.hypot(move.clientX - clientX, move.clientY - clientY) >
        LONG_PRESS_TOLERANCE
      ) {
        this.cancel();
      } else {
        // the palette opens where the finger is when the time is up
        this.press.clientX = move.clientX;
        this.press.clientY = move.clientY;
      }
    };
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId === pointerId) {
        this.cancel();
      }
    };
    const onBlur = () => this.cancel();
    win.addEventListener(EVENT.POINTER_MOVE, onMove, { passive: true });
    win.addEventListener(EVENT.POINTER_UP, onEnd);
    win.addEventListener(EVENT.POINTER_CANCEL, onEnd);
    win.addEventListener(EVENT.BLUR, onBlur);
    this.press = {
      pointerId,
      clientX,
      clientY,
      // the press may change it (text falls back to selection on touch)
      activeTool: this.app.state.activeTool,
      multiPoint: multiPointLine(this.app.state),
      timer: win.setTimeout(this.fire, LONG_PRESS_DELAY),
      detach: () => {
        win.removeEventListener(EVENT.POINTER_MOVE, onMove);
        win.removeEventListener(EVENT.POINTER_UP, onEnd);
        win.removeEventListener(EVENT.POINTER_CANCEL, onEnd);
        win.removeEventListener(EVENT.BLUR, onBlur);
      },
    };
  }

  /** opens the palette for the press being timed, if it is still held */
  private fire = () => {
    const { press } = this;
    this.cancel();
    if (
      !press ||
      !this.enabled ||
      this.dependencies.getPointerCount() > 1 ||
      this.app.pan.isActive() ||
      this.app.radialPalette.session
    ) {
      return;
    }
    this.dependencies.abandonPress(
      press.pointerId,
      press.activeTool,
      press.multiPoint,
    );
    this.open(press, press.pointerId);
  };

  cancel = () => {
    if (this.press) {
      this.app.ownerWindow.clearTimeout(this.press.timer);
      this.press.detach();
      this.press = null;
    }
  };
}
