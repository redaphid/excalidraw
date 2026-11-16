import { FONT_FAMILY, MIME_TYPES } from "@excalidraw/common";
import {
  newElement,
  newFrameElement,
  newTextElement,
} from "@excalidraw/element";
import * as clipboardModule from "@excalidraw/excalidraw/clipboard";
import * as imageModule from "@excalidraw/excalidraw/data/image";
import * as jsonModule from "@excalidraw/excalidraw/data/json";
import * as mockedSceneExportUtils from "@excalidraw/excalidraw/scene/export";
import { diagramFactory } from "@excalidraw/excalidraw/tests/fixtures/diagramFixture";
import { vi } from "vitest";

import type {
  FontFamilyValues,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import * as utils from "../src";

import type { Mock } from "vitest";

const exportToSvgSpy = vi.spyOn(mockedSceneExportUtils, "exportToSvg");

describe("exportToCanvas", async () => {
  const EXPORT_PADDING = 10;

  it("with default arguments", async () => {
    const canvas = await utils.exportToCanvas({
      ...diagramFactory({ elementOverrides: { width: 100, height: 100 } }),
    });

    expect(canvas.width).toBe(100 + 2 * EXPORT_PADDING);
    expect(canvas.height).toBe(100 + 2 * EXPORT_PADDING);
  });

  it("when custom width and height", async () => {
    const canvas = await utils.exportToCanvas({
      ...diagramFactory({ elementOverrides: { width: 100, height: 100 } }),
      getDimensions: () => ({ width: 200, height: 200, scale: 1 }),
    });

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
  });

  describe("restoreElements", () => {
    const exportToCanvasSpy = vi.spyOn(
      mockedSceneExportUtils,
      "exportToCanvas",
    );
    afterEach(() => exportToCanvasSpy.mockClear());

    it("exports copies of the elements by default", async () => {
      const { elements } = diagramFactory();
      await utils.exportToCanvas({ elements, files: null });
      const [exported] = exportToCanvasSpy.mock.calls[0];
      expect(exported).toHaveLength(elements.length);
      exported.forEach((element, i) => expect(element).not.toBe(elements[i]));
    });

    it("exports the caller's own elements when false, and still restores appState", async () => {
      const { elements } = diagramFactory();
      await utils.exportToCanvas({
        elements,
        files: null,
        appState: { viewBackgroundColor: "#123456" },
        restoreElements: false,
      });
      const [exported, appState] = exportToCanvasSpy.mock.calls[0];
      expect(exported).toBe(elements);
      expect(appState.viewBackgroundColor).toBe("#123456");
      expect(appState.exportBackground).toBe(true);
      expect(appState.zoom.value).toBe(1);
    });

    it("leaves the caller's elements as they were when false and out of index order", async () => {
      const box = { x: 0, y: 0, width: 100, height: 100 };
      const frame = { ...newFrameElement(box), index: "a0" };
      const child = {
        ...newElement({ type: "rectangle", ...box, frameId: frame.id }),
        index: "a1",
      } as NonDeletedExcalidrawElement;
      const stamps = () =>
        [child, frame].map(({ index, version }) => ({ index, version }));
      const before = stamps();
      await utils.exportToCanvas({
        elements: [child, frame as NonDeletedExcalidrawElement],
        files: null,
        restoreElements: false,
      });
      expect(stamps()).toEqual(before);
    });
  });

  describe("fonts", () => {
    const fonts = document.fonts as unknown as {
      check: Mock<(font: string, text?: string) => boolean>;
      load: Mock<(font: string, text?: string) => Promise<FontFace[]>>;
    };
    const textElements = (text: string, fontFamily?: FontFamilyValues) => [
      newTextElement({ text, x: 0, y: 0, fontFamily }),
    ];
    const exportText = (elements: readonly NonDeletedExcalidrawElement[]) =>
      utils.exportToCanvas({ elements, files: null, restoreElements: false });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      fonts.check.mockClear();
      fonts.load.mockClear();
    });

    it("checks a font once across exports of the same elements", async () => {
      const elements = textElements("αβγ");
      await exportText(elements);
      expect(fonts.check).toHaveBeenCalledTimes(1);
      fonts.check.mockClear();
      await exportText(elements);
      expect(fonts.check).not.toHaveBeenCalled();
    });

    it("checks only characters no earlier export confirmed", async () => {
      await exportText(textElements("δεζ"));
      fonts.check.mockClear();
      await exportText(textElements("δεζηθ"));
      expect(fonts.check).toHaveBeenCalledTimes(1);
      expect(fonts.check.mock.calls[0][1]).toBe("ηθ");
    });

    it("waits for a font that is not loaded yet", async () => {
      const elements = textElements("ικλ", FONT_FAMILY.Nunito);
      let loaded!: () => void;
      fonts.check.mockReturnValueOnce(false);
      fonts.load.mockReturnValueOnce(
        new Promise((resolve) => {
          loaded = () => resolve([]);
        }),
      );
      let exported = false;
      const exporting = exportText(elements).then(() => {
        exported = true;
      });
      await settle();
      expect(fonts.load).toHaveBeenCalledTimes(1);
      expect(exported).toBe(false);
      loaded();
      await exporting;
      expect(exported).toBe(true);

      fonts.check.mockClear();
      await exportText(elements);
      expect(fonts.check).not.toHaveBeenCalled();
    });

    it("checks again after a font failed to load", async () => {
      const elements = textElements("μνξ");
      fonts.check.mockReturnValueOnce(false);
      fonts.load.mockRejectedValueOnce(new Error("offline"));
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => void 0);
      await exportText(elements);
      consoleError.mockRestore();
      fonts.check.mockClear();
      await exportText(elements);
      expect(fonts.check).toHaveBeenCalledTimes(1);
    });
  });
});

describe("exportToBlob", async () => {
  describe("mime type", () => {
    it("should change image/jpg to image/jpeg", async () => {
      const blob = await utils.exportToBlob({
        ...diagramFactory(),
        getDimensions: (width, height) => ({ width, height, scale: 1 }),
        // testing typo in MIME type (jpg → jpeg)
        mimeType: "image/jpg",
        appState: {
          exportBackground: true,
        },
      });
      expect(blob?.type).toBe(MIME_TYPES.jpg);
    });
    it("should default to image/png", async () => {
      const blob = await utils.exportToBlob({
        ...diagramFactory(),
      });
      expect(blob?.type).toBe(MIME_TYPES.png);
    });

    it("should warn when using quality with image/png", async () => {
      const consoleSpy = vi
        .spyOn(console, "warn")
        .mockImplementationOnce(() => void 0);
      await utils.exportToBlob({
        ...diagramFactory(),
        mimeType: MIME_TYPES.png,
        quality: 1,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        `"quality" will be ignored for "${MIME_TYPES.png}" mimeType`,
      );
    });
  });
});

describe("exportToSvg", () => {
  const passedElements = () => exportToSvgSpy.mock.calls[0][0];
  const passedOptions = () => exportToSvgSpy.mock.calls[0][1];

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("with default arguments", async () => {
    await utils.exportToSvg({
      ...diagramFactory({
        overrides: { appState: void 0 },
      }),
    });

    const passedOptionsWhenDefault = {
      ...passedOptions(),
      // To avoid varying snapshots
      name: "name",
    };
    expect(passedElements().length).toBe(3);
    expect(passedOptionsWhenDefault).toMatchSnapshot();
  });

  // Regression test: when all elements are deleted, exportToSvg should pass
  // zero elements to the lower-level export (line 184-188 of export.ts calls
  // getNonDeletedElements which filters them out).
  it("with deleted elements", async () => {
    await utils.exportToSvg({
      ...diagramFactory({
        overrides: { appState: void 0 },
        elementOverrides: { isDeleted: true },
      }),
    });

    expect(passedElements().length).toBe(0);
  });

  it("with exportPadding", async () => {
    await utils.exportToSvg({
      ...diagramFactory({
        overrides: { appState: { name: "diagram name" } },
      }),
      exportPadding: 0,
    });

    expect(passedElements().length).toBe(3);
    expect(passedOptions()).toEqual(
      expect.objectContaining({ exportPadding: 0 }),
    );
  });

  it("with exportEmbedScene", async () => {
    await utils.exportToSvg({
      ...diagramFactory({
        overrides: {
          appState: { name: "diagram name", exportEmbedScene: true },
        },
      }),
    });

    expect(passedElements().length).toBe(3);
    expect(passedOptions().exportEmbedScene).toBe(true);
  });
});

// Elements persisted before `created` existed omit it (modeled with the cast
// below, as the declared input type is a complete element). Every public
// export entry point restores its input, so such elements must reach the
// lower-level code restored, with `created: null`.
describe("elements lacking creation metadata", () => {
  const legacyDiagram = () => {
    const { elements, ...rest } = diagramFactory({
      overrides: { appState: void 0 },
    });
    return {
      ...rest,
      elements: elements.map(
        ({ created, ...element }) => element,
      ) as unknown as typeof elements,
    };
  };
  const createdOf = (elements: readonly { created: number | null }[]) =>
    elements.map((element) => element.created);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exportToSvg and exportToCanvas restore the elements", async () => {
    const exportToSvgSpy = vi.spyOn(mockedSceneExportUtils, "exportToSvg");
    const diagram = legacyDiagram();

    await utils.exportToSvg(diagram);

    expect(createdOf(exportToSvgSpy.mock.calls[0][0])).toEqual([
      null,
      null,
      null,
    ]);
    expect(diagram.elements[0]).not.toHaveProperty("created");

    const exportToCanvasSpy = vi.spyOn(
      mockedSceneExportUtils,
      "exportToCanvas",
    );
    const canvas = await utils.exportToCanvas(diagram);

    expect(createdOf(exportToCanvasSpy.mock.calls[0][0])).toEqual([
      null,
      null,
      null,
    ]);
    expect(canvas.width).toBeGreaterThan(0);
  });

  it("exportToBlob embeds the restored scene into png metadata", async () => {
    const serializeSpy = vi.spyOn(jsonModule, "serializeAsJSON");
    vi.spyOn(imageModule, "encodePngMetadata").mockImplementation(
      async ({ blob }) => blob,
    );

    await utils.exportToBlob({
      ...legacyDiagram(),
      mimeType: MIME_TYPES.png,
      appState: { exportEmbedScene: true },
    });

    expect(serializeSpy).toHaveBeenCalledTimes(1);
    expect(createdOf(serializeSpy.mock.calls[0][0])).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("exportToClipboard copies the restored elements as json", async () => {
    const copySpy = vi
      .spyOn(clipboardModule, "copyToClipboard")
      .mockResolvedValue(undefined);

    await utils.exportToClipboard({ ...legacyDiagram(), type: "json" });

    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(createdOf(copySpy.mock.calls[0][0])).toEqual([null, null, null]);
  });
});
