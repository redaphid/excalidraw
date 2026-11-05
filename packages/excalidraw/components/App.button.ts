import {
  CURSOR_TYPE,
  DRAGGING_THRESHOLD,
  POINTER_BUTTON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { getElementBounds, isButtonElement } from "@excalidraw/element";
import { pointDistance, pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ButtonHighlight } from "../scene/types";
import type App from "./App";

type Press = {
  id: ExcalidrawElement["id"];
  event: React.PointerEvent<HTMLElement>;
};

type Coords = { clientX: number; clientY: number };

type Modifiers = {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

const hasModifier = (event: Modifiers) =>
  event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;

const isDrag = (press: Press, event: Coords) =>
  pointDistance(
    pointFrom(press.event.clientX, press.event.clientY),
    pointFrom(event.clientX, event.clientY),
  ) > DRAGGING_THRESHOLD;

/**
 * A press on a button is held out of App's pointer flow, so a click leaves the
 * scene, the selection and the undo stack as they were. Anything else it turns
 * out to be, a drag or the start of a pinch, is replayed into that flow.
 */
export class AppButton {
  /** what the interactive canvas paints over a button */
  public highlight: ButtonHighlight | null = null;
  private press: Press | null = null;
  private isReplaying = false;

  constructor(
    private app: App,
    private dependencies: {
      getPointerCount: () => number;
      pointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    },
  ) {}

  /** the clickable button under the coords, topmost element first */
  private getButtonIdAt = (coords: Coords) => {
    const { app } = this;
    const { state } = app;
    if (
      !app.props.onButtonClick ||
      !(app.isInteractionEnabled() || app.isLinksEnabled()) ||
      app.pan.isSpaceHeld() ||
      state.openDialog?.name === "elementLinkSelector" ||
      state.selectedLinearElement?.isEditing ||
      state.isCropping ||
      state.editingTextElement ||
      !(state.viewModeEnabled
        ? !app.isActiveToolPointerCapturing()
        : ["selection", "hand"].includes(state.activeTool.type))
    ) {
      return null;
    }

    const { x, y } = viewportCoordsToSceneCoords(coords, state);
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const isOverAnyButton = app.scene
      .getNonDeletedElements()
      .some((element) => {
        if (!isButtonElement(element)) {
          return false;
        }
        const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
        return x >= x1 && x <= x2 && y >= y1 && y <= y2;
      });
    if (!isOverAnyButton) {
      return null;
    }

    const hit = app.getElementAtPosition(x, y, { includeLockedElements: true });
    return isButtonElement(hit) ? hit.id : null;
  };

  private setHighlight = (highlight: ButtonHighlight | null) => {
    if (
      this.highlight?.id === highlight?.id &&
      this.highlight?.pressed === highlight?.pressed
    ) {
      return;
    }
    this.highlight = highlight;
    this.app.props.onButtonHighlight?.(highlight);
    this.app.triggerRender();
  };

  /** hands a held press back to App, as if it had just landed */
  private replayPress = (event: React.PointerEvent<HTMLElement>) => {
    this.press = null;
    this.setHighlight(null);
    this.isReplaying = true;
    try {
      this.dependencies.pointerDown(event);
    } finally {
      this.isReplaying = false;
    }
  };

  /** @returns whether the button took the press */
  handlePointerDown = (event: React.PointerEvent<HTMLElement>): boolean => {
    if (this.isReplaying) {
      return false;
    }
    if (this.press) {
      // no pointerup ever reached the last press if the id is the same
      if (this.press.event.pointerId !== event.pointerId) {
        this.replayPress(this.press.event);
        return false;
      }
      this.press = null;
    }
    const id =
      event.button === POINTER_BUTTON.MAIN &&
      this.dependencies.getPointerCount() === 0 &&
      !hasModifier(event)
        ? this.getButtonIdAt(event)
        : null;
    if (!id) {
      return false;
    }

    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    this.app.focusContainer();
    this.press = { id, event };
    this.setHighlight({ id, pressed: true });
    return true;
  };

  /** runs after App's own handling, so that the cursor set here wins */
  handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const { press } = this;
    if (press?.event.pointerId === event.pointerId) {
      if (isDrag(press, event)) {
        this.replayPress(press.event);
        return;
      }
      this.app.cursor.set(CURSOR_TYPE.POINTER);
      return;
    }
    if (press || event.buttons) {
      this.setHighlight(null);
      return;
    }
    const id = this.getButtonIdAt(event);
    if (id) {
      this.app.cursor.set(CURSOR_TYPE.POINTER);
    } else if (this.highlight && this.app.pan.isNavigating()) {
      // App's own handling stops short of the cursor while navigating
      this.app.cursor.reset();
    }
    this.setHighlight(id ? { id, pressed: false } : null);
  };

  /** @returns whether the release ended a press the button held */
  handlePointerUp = (event: React.PointerEvent<HTMLElement>): boolean => {
    const { press } = this;
    if (press?.event.pointerId !== event.pointerId) {
      return false;
    }
    this.press = null;
    const id = this.getButtonIdAt(event);
    if (!id) {
      this.app.cursor.reset();
    }
    this.setHighlight(
      id && event.pointerType === "mouse" ? { id, pressed: false } : null,
    );
    if (id === press.id && !isDrag(press, event)) {
      this.app.props.onButtonClick?.(id);
    }
    return true;
  };

  /** the pointer left the canvas, or the browser took it over */
  clear = () => {
    this.press = null;
    this.setHighlight(null);
  };

  /** what a hover showed is out of date once the view or the tool changes */
  handleViewChange = () => {
    if (!this.press && this.highlight) {
      this.setHighlight(null);
      this.app.cursor.reset();
    }
  };

  /** a double click is two clicks to a button, not a label edit */
  isClickableAt = (event: Coords & Modifiers) =>
    !hasModifier(event) && this.getButtonIdAt(event) !== null;
}
