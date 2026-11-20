import { CaptureUpdateAction } from "@excalidraw/element";

import { ImageIcon } from "../components/icons";

import { register } from "./register";

export const actionInsertImage = register({
  name: "insertImage",
  label: "toolBar.image",
  icon: ImageIcon,
  trackEvent: { category: "toolbar" },
  perform(elements, appState, _, app) {
    app.setActiveTool({ type: "image" });
    return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
  },
});
