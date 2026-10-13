import { useEffect, useState } from "react";

import { useAppStateValue } from "./useAppStateValue";

import type { AppClassProperties } from "../types";

/** The scene's frame model, re-rendering only when it changes: a scene
 * update that moves no frame and no arrow between frames keeps it. */
export const useFrameModel = (app: AppClassProperties) => {
  const [model, setModel] = useState(app.frameNavigation.model);
  useEffect(() => {
    const refresh = () => setModel(app.frameNavigation.model());
    const unsubscribe = app.frameNavigation.sceneUpdated.on(refresh);
    // the scene may have changed between the render and this subscription
    refresh();
    return unsubscribe;
  }, [app]);
  return model;
};

/** The id of the frame the view is in, re-rendering when the view moves into
 * another frame or the frames themselves change. Read at render rather than
 * taken from the state subscription, which compares two states against the
 * current frames and so misses a change that only the scene made. */
export const useCurrentFrameId = (app: AppClassProperties) => {
  useFrameModel(app);
  useAppStateValue((state) => app.frameNavigation.currentId(state));
  return app.frameNavigation.currentId();
};
