import { COLOR_PALETTE, THEME } from "@excalidraw/common";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { ShapeCache } from "../src";
import { elementWithCanvasCache } from "../src/renderElement";

import type { ExcalidrawRectangleElement } from "../src/types";

type CachedBitmap = Parameters<typeof elementWithCanvasCache.set>[1];

const renderConfig = (isExporting: boolean) => ({
  isExporting,
  canvasBackgroundColor: COLOR_PALETTE.white,
  embedsValidationStatus: new Map(),
  theme: THEME.LIGHT,
});

// A host that exports the scene's own elements (say, to draw tiles of the
// board) must not throw away the bitmaps the editor drew them with: the
// editor's next render would rebuild every one of them in a single task.
describe("ShapeCache.generateElementShape", () => {
  let element: ExcalidrawRectangleElement;
  let bitmap: CachedBitmap;

  beforeEach(() => {
    element = API.createElement({
      type: "rectangle",
      width: 80,
      height: 40,
    }) as ExcalidrawRectangleElement;
    bitmap = { element } as unknown as CachedBitmap;
    elementWithCanvasCache.set(element, bitmap);
  });

  describe("when exporting", () => {
    beforeEach(() => {
      ShapeCache.generateElementShape(element, renderConfig(true));
    });

    it("keeps the editor's bitmap of the element", () => {
      expect(elementWithCanvasCache.get(element)).toBe(bitmap);
    });
  });

  describe("when the editor finds no shape cached", () => {
    beforeEach(() => {
      ShapeCache.generateElementShape(element, renderConfig(false));
    });

    it("drops the bitmap drawn from the old shape", () => {
      expect(elementWithCanvasCache.get(element)).toBeUndefined();
    });
  });
});
