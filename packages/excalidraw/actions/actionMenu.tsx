import { KEYS, sceneCoordsToViewportCoords } from "@excalidraw/common";

import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/element";

import { HelpIconThin } from "../components/icons";

import { register } from "./register";

export const actionOpenMainMenu = register({
  name: "openMainMenu",
  label: "radialPalette.mainMenu",
  viewMode: true,
  trackEvent: false,
  perform: (_elements, appState) => ({
    appState: { ...appState, openMenu: "canvas", openPopup: null },
    captureUpdate: CaptureUpdateAction.EVENTUALLY,
  }),
});

export const actionOpenStyleRing = register({
  name: "openStyleRing",
  label: "radialPalette.style",
  trackEvent: false,
  predicate: (elements) => elements.length > 0,
  perform: (_elements, appState, _, app) => {
    const [minX, minY, maxX, maxY] = getCommonBounds(
      app.scene.getSelectedElements(appState),
    );
    const at = sceneCoordsToViewportCoords(
      { sceneX: (minX + maxX) / 2, sceneY: (minY + maxY) / 2 },
      appState,
    );
    app.radialPalette.open({ ring: "style", at: { x: at.x, y: at.y } });
    return { captureUpdate: CaptureUpdateAction.EVENTUALLY };
  },
});

export const actionShortcuts = register({
  name: "toggleShortcuts",
  label: "welcomeScreen.defaults.helpHint",
  icon: HelpIconThin,
  viewMode: true,
  trackEvent: { category: "menu", action: "toggleHelpDialog" },
  perform: (_elements, appState, _, { focusContainer }) => {
    if (appState.openDialog?.name === "help") {
      focusContainer();
    }
    return {
      appState: {
        ...appState,
        openDialog:
          appState.openDialog?.name === "help"
            ? null
            : {
                name: "help",
              },
        openMenu: null,
        openPopup: null,
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  keyTest: (event) => event.key === KEYS.QUESTION_MARK,
});
