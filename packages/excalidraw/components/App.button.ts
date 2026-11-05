import {
  CURSOR_TYPE,
  DRAGGING_THRESHOLD,
  KEYS,
  POINTER_BUTTON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { getElementBounds, isButtonElement } from "@excalidraw/element";
import { pointDistance, pointFrom } from "@excalidraw/math";

import { isHandToolActive } from "../appState";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ButtonHighlight } from "../scene/types";
import type App from "./App";

type Press = {
  id: ExcalidrawElement["id"];
  event: React.PointerEvent<HTMLElement>;
  /** moved too far to be a click, and stays held until it is released */
  dragged: boolean;
};

const isDrag = (press: Press, event: React.PointerEvent<HTMLElement>) =>
  pointDistance(
    pointFrom(press.event.clientX, press.event.clientY),
    pointFrom(event.clientX, event.clientY),
  ) > DRAGGING_THRESHOLD;

/**
 * A press on a button is held out of App's pointer flow, so a click leaves the
 * scene, the selection and the undo stack as they were.
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
  private getButtonIdAt = (coords: { clientX: number; clientY: number }) => {
    const { app } = this;
    const { state } = app;
    if (
      !app.props.onButtonClick ||
      !(app.isInteractionEnabled() || app.isLinksEnabled()) ||
      app.pan.isSpaceHeld() ||
      state.openDialog?.name === "elementLinkSelector" ||
      state.selectedLinearElement?.isEditing ||
      state.isCropping ||
      !(state.viewModeEnabled
        ? !app.isActiveToolPointerCapturing()
        : ["selection", "lasso", "hand"].includes(state.activeTool.type))
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

    if (
      app.isHittingCommonBoundingBoxOfSelectedElements(
        { x, y },
        app.scene.getSelectedElements(state),
      )
    ) {
      return null;
    }

    const hit = app.getElementAtPosition(x, y, { includeLockedElements: true });
    return isButtonElement(hit) && !state.selectedElementIds[hit.id]
      ? hit.id
      : null;
  };

  private setHighlight = (highlight: ButtonHighlight | null) => {
    if (
      this.highlight?.id === highlight?.id &&
      this.highlight?.pressed === highlight?.pressed
    ) {
      return;
    }
    this.highlight = highlight;
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
      (this.app.state.viewModeEnabled ||
        !(event.shiftKey || event[KEYS.CTRL_OR_CMD]))
        ? this.getButtonIdAt(event)
        : null;
    if (!id) {
      return false;
    }

    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    this.app.focusContainer();
    this.press = { id, event, dragged: false };
    this.setHighlight({ id, pressed: true });
    return true;
  };

  /** runs after App's own handling, so that the cursor set here wins */
  handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const { press } = this;
    if (press?.event.pointerId === event.pointerId) {
      this.app.cursor.set(CURSOR_TYPE.POINTER);
      if (press.dragged || !isDrag(press, event)) {
        return;
      }
      if (this.app.state.viewModeEnabled || isHandToolActive(this.app.state)) {
        this.replayPress(press.event);
        return;
      }
      press.dragged = true;
      this.setHighlight(null);
      return;
    }
    if (press || event.buttons) {
      this.setHighlight(null);
      return;
    }
    const id = this.getButtonIdAt(event);
    if (id) {
      this.app.cursor.set(CURSOR_TYPE.POINTER);
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
    this.setHighlight(
      id && event.pointerType === "mouse" ? { id, pressed: false } : null,
    );
    const button = this.app.scene.getNonDeletedElement(press.id);
    if (
      id === press.id &&
      !press.dragged &&
      !isDrag(press, event) &&
      isButtonElement(button)
    ) {
      this.app.props.onButtonClick?.(button, event.nativeEvent);
    }
    return true;
  };

  /** the pointer left the canvas, or the browser took it over */
  clear = () => {
    this.press = null;
    this.setHighlight(null);
  };

  /** a double click is two clicks to a button, not a label edit */
  isClickableAt = (coords: { clientX: number; clientY: number }) =>
    this.getButtonIdAt(coords) !== null;
}
