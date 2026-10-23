// draw's calls into the packages, checked against the packed tarballs.
import {
  elementsOverlappingBBox,
  exportToBlob,
  getVisibleSceneBounds,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export const visibleIds = (api: ExcalidrawImperativeAPI) =>
  elementsOverlappingBBox({
    elements: api.getSceneElements(),
    bounds: getVisibleSceneBounds(api.getAppState()),
    type: "overlap",
  }).map((element) => element.id);

export const thumbnail = (api: ExcalidrawImperativeAPI): Promise<Blob> =>
  exportToBlob({
    elements: api.getSceneElements(),
    appState: { ...api.getAppState(), exportBackground: true },
    files: api.getFiles(),
    restoreElements: false,
    mimeType: "image/png",
    maxWidthOrHeight: 400,
  });

// @ts-expect-error a consumer's typo still fails, so exportToBlob is not any
exportToBlob({ elements: [], files: null, mimeTpe: "image/png" });
