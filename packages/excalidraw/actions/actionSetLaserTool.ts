import { CaptureUpdateAction } from "@excalidraw/element";

import { laserPointerToolIcon } from "../components/icons";

import { register } from "./register";

export const actionSetLaserTool = register({
  name: "setLaserTool",
  label: "toolBar.laser",
  icon: laserPointerToolIcon,
  trackEvent: { category: "toolbar" },
  perform(elements, appState, _, app) {
    app.setActiveTool({ type: "laser" });
    return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
  },
});
