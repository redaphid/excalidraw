import {
  CaptureUpdateAction,
  hasBackground,
  hasFillStyle,
  hasStrokeColor,
  hasStrokeStyle,
  newElementWith,
} from "@excalidraw/element";

import { changeProperty } from "./actionProperties";
import { register } from "./register";

import type { RoleStyle } from "../components/RadialPalette/themeInks";

/**
 * Gives the selection and new elements a style role's stroke, fill and line
 * in one step, so one undo takes the whole role back.
 */
export const actionApplyStyleRole = register<RoleStyle>({
  name: "applyStyleRole",
  label: "radialPalette.role",
  trackEvent: false,
  perform: (elements, appState, style) => {
    if (!style) {
      return false;
    }
    return {
      elements: changeProperty(elements, appState, (element) =>
        newElementWith(element, {
          ...(hasStrokeColor(element.type) && {
            strokeColor: style.strokeColor,
          }),
          ...(hasBackground(element.type) && {
            backgroundColor: style.backgroundColor,
          }),
          ...(hasFillStyle(element.type) && { fillStyle: style.fillStyle }),
          ...(hasStrokeStyle(element.type) && {
            strokeStyle: style.strokeStyle,
          }),
        }),
      ),
      appState: {
        ...appState,
        currentItemStrokeColor: style.strokeColor,
        currentItemBackgroundColor: style.backgroundColor,
        currentItemFillStyle: style.fillStyle,
        currentItemStrokeStyle: style.strokeStyle,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
