import { EVENT, POINTER_BUTTON } from "@excalidraw/common";

import { ERASER_BUTTONS } from "../ink/gate";

import type React from "react";

import type App from "./App";

const BARREL_BUTTONS = 2;

/** A barrel tap also arrives as a right-click, just after the pointerup. */
const MENU_MS = 600;

/** The pen's side button, held as it touches down (not the eraser end). */
const isBarrel = (p: {
  pointerType: string;
  button: number;
  buttons: number;
}) =>
  p.pointerType === "pen" &&
  p.button === POINTER_BUTTON.SECONDARY &&
  (p.buttons & BARREL_BUTTONS) !== 0 &&
  (p.buttons & ERASER_BUTTONS) === 0;

/** `event`, read as a main-button press. */
const asMainButton = <E extends { button: number; buttons: number }>(
  event: E,
) =>
  new Proxy(event, {
    get: (target, key) =>
      key === "button"
        ? POINTER_BUTTON.MAIN
        : key === "buttons"
        ? 1
        : Reflect.get(target, key),
  });

/**
 * The pen's barrel button selects (`penBarrelSelects`). Held as the pen
 * touches down with the freedraw tool out, it borrows the selection tool,
 * and the press is handled as a main-button one: drag a box, or tap a
 * stroke. The selection tool stays while something is selected, so the pen
 * can drag it or it can be deleted, and the freedraw tool comes back once
 * the selection is empty. Without this, the barrel's secondary-button press
 * would pan, and its right-click would open the context menu.
 */
export class AppBarrel {
  /** the selection tool is the barrel's, until the selection empties */
  private borrowed = false;
  private held = false;
  private menuUntil = 0;

  constructor(
    private app: App,
    private dependencies: {
      /** pointers currently down */
      getPointerCount: () => number;
      /** handles `event` as a fresh pointerdown, once the tool switch applies */
      replay: (event: React.PointerEvent<HTMLElement>) => void;
    },
  ) {}

  /** takes the pointerdown if it is a barrel press; returns whether it did */
  start = (event: React.PointerEvent<HTMLElement>): boolean => {
    const { app } = this;
    const tool = app.state.activeTool.type;
    if (
      !app.props.penBarrelSelects ||
      !isBarrel(event) ||
      (tool !== "freedraw" && !(this.borrowed && tool === "selection"))
    ) {
      return false;
    }
    if (tool === "freedraw") {
      app.setActiveTool({ type: "selection" });
      this.borrowed = true;
    }
    this.held = true;
    this.menuUntil = Number.POSITIVE_INFINITY;
    const win = app.ownerWindow;
    const released = new AbortController();
    const release = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) {
        return;
      }
      released.abort();
      this.held = false;
      this.menuUntil = win.performance.now() + MENU_MS;
      win.setTimeout(this.settle, 0);
    };
    const capture = { capture: true, signal: released.signal };
    win.addEventListener(EVENT.POINTER_UP, release, capture);
    win.addEventListener(EVENT.POINTER_CANCEL, release, capture);
    this.dependencies.replay(asMainButton(event));
    return true;
  };

  /** whether a `contextmenu` event is the barrel's right-click */
  consumesContextMenuEvent = () =>
    this.held || this.app.ownerWindow.performance.now() <= this.menuUntil;

  /** gives the freedraw tool back once nothing is pressed or selected */
  settle = () => {
    if (!this.borrowed || this.held || this.dependencies.getPointerCount()) {
      return;
    }
    const { state } = this.app;
    if (state.activeTool.type !== "selection") {
      this.borrowed = false;
      return;
    }
    if (Object.values(state.selectedElementIds).some(Boolean)) {
      return;
    }
    this.borrowed = false;
    this.app.setActiveTool({ type: "freedraw" });
  };
}
