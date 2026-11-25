import { CODES } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  applyArrangePlan,
  canArrange,
  getFrameLikeTitle,
  isFrameLikeElement,
  planArrange,
  unarrangeableTypes,
} from "@excalidraw/element";

import type {
  ArrangeOutcome,
  ArrangeRequest,
  Scene,
} from "@excalidraw/element";

import { elkLayout } from "../arrange/elkLayout";
import { ArrangeIcon } from "../components/icons";

import { register } from "./register";

import type { ActionResult } from "./types";
import type { AppClassProperties, AppState, UIAppState } from "../types";

/** lays the request out with ELK and applies it to the scene, unless the scene changed meanwhile */
export const arrangeScene = async (
  scene: Scene,
  appState: Readonly<AppState>,
  request: ArrangeRequest,
): Promise<ArrangeOutcome> => {
  const plan = await planArrange(scene, appState, request, elkLayout);
  if (!plan) {
    return {
      status: "nothing-to-arrange",
      skipped: unarrangeableTypes(scene, request),
    };
  }
  if (applyArrangePlan(scene, plan) === "stale") {
    return { status: "stale" };
  }
  return {
    status: "arranged",
    movedIds: [...plan.translations]
      .filter(([, { dx, dy }]) => dx || dy)
      .map(([id]) => id),
    resizedFrameIds: [...plan.frames.keys()],
    overlappedFrameIds: plan.overlappedFrameIds,
  };
};

/** the styles panel offers it when the selection has two or more shapes or groups to lay out, or a frame holding them */
export const arrangeActionPredicate = (
  appState: UIAppState,
  app: AppClassProperties,
) => {
  const selected = app.scene.getSelectedElements(appState);
  return (
    selected.length > 0 &&
    canArrange(app.scene, {
      elementIds: selected.map((element) => element.id),
    })
  );
};

const toast = (message: string): ActionResult => ({
  appState: { toast: { message } },
  captureUpdate: CaptureUpdateAction.EVENTUALLY,
});

export const actionArrangeElements = register({
  name: "arrangeElements",
  label: "labels.arrangeElements",
  keywords: ["layout", "tidy", "graph", "flowchart", "elk"],
  icon: ArrangeIcon,
  trackEvent: { category: "element" },
  // with nothing selected the action stays reachable and asks for a
  // selection; the whole scene is arranged through the API only
  predicate: (_, appState, __, app) =>
    app.scene.getSelectedElements(appState).length
      ? arrangeActionPredicate(appState, app)
      : true,
  perform: async (elements, appState, _, app) => {
    const selected = app.scene.getSelectedElements(appState);
    if (!selected.length) {
      return toast("Select shapes to arrange");
    }
    const outcome = await arrangeScene(app.scene, appState, {
      elementIds: selected.map((element) => element.id),
    });
    switch (outcome.status) {
      case "nothing-to-arrange":
        return toast(
          outcome.skipped.length
            ? `Nothing to arrange: only shapes are arranged, so ${outcome.skipped.join(
                ", ",
              )} stayed where they were. Select two or more shapes, or a frame with shapes`
            : "Nothing to arrange: select two or more shapes, or a frame with shapes",
        );
      case "stale":
        return toast("The board changed while arranging. Try again.");
      case "arranged": {
        const elementsMap = app.scene.getNonDeletedElementsMap();
        const overlapped = outcome.overlappedFrameIds.flatMap((id) => {
          const frame = elementsMap.get(id);
          return frame && isFrameLikeElement(frame)
            ? [getFrameLikeTitle(frame)]
            : [];
        });
        return {
          elements: app.scene.getElementsIncludingDeleted(),
          appState: overlapped.length
            ? {
                toast: {
                  message: `Arranged. The frame grew and now overlaps ${overlapped.join(
                    ", ",
                  )}; move it if needed`,
                },
              }
            : null,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        };
      }
    }
  },
  keyTest: (event) =>
    event.code === CODES.A &&
    event.shiftKey &&
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.repeat &&
    !("isComposing" in event && event.isComposing),
});
