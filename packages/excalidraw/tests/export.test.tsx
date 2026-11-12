import React from "react";

import { SVG_NS } from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";

import { getDataURL } from "../data/blob";
import { encodePngMetadata } from "../data/image";
import { serializeAsJSON } from "../data/json";
import { Excalidraw } from "../index";
import {
  decodeSvgBase64Payload,
  encodeSvgBase64Payload,
  exportToSvg,
} from "../scene/export";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type { CanvasTheme } from "../cssTheme";

const { h } = window;

const testElements = [
  {
    ...API.createElement({
      type: "text",
      id: "A",
      text: "😀",
    }),
    // can't get jsdom text measurement to work so this is a temp hack
    // to ensure the element isn't stripped as invisible
    width: 16,
    height: 16,
  },
];

// tiny polyfill for TextDecoder.decode on which we depend
Object.defineProperty(window, "TextDecoder", {
  value: class TextDecoder {
    decode(ab: ArrayBuffer) {
      return new Uint8Array(ab).reduce(
        (acc, c) => acc + String.fromCharCode(c),
        "",
      );
    }
  },
});

describe("export", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("export embedded png and reimport", async () => {
    const pngBlob = await API.loadFile("./fixtures/smiley.png");
    const pngBlobEmbedded = await encodePngMetadata({
      blob: pngBlob,
      metadata: serializeAsJSON(testElements, h.state, {}, "local"),
    });
    await API.drop([{ kind: "file", file: pngBlobEmbedded }]);

    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({ type: "text", text: "😀" }),
      ]);
    });
  });

  it("test encoding/decoding scene for SVG export", async () => {
    const metadataElement = document.createElementNS(SVG_NS, "metadata");

    encodeSvgBase64Payload({
      metadataElement,
      payload: serializeAsJSON(testElements, h.state, {}, "local"),
    });

    const decoded = JSON.parse(
      decodeSvgBase64Payload({ svg: metadataElement.innerHTML }),
    );
    expect(decoded.elements).toEqual([
      expect.objectContaining({ type: "text", text: "😀" }),
    ]);
  });

  it("export svg-embedded scene", async () => {
    const svg = await exportToSvg(
      testElements,
      { ...getDefaultAppState(), exportEmbedScene: true },
      {},
    );
    const svgText = svg.outerHTML;

    expect(svgText).toMatchSnapshot(`svg-embdedded scene export output`);
  });

  it("import embedded png (legacy v1)", async () => {
    await API.drop([
      {
        kind: "file",
        file: await API.loadFile("./fixtures/test_embedded_v1.png"),
      },
    ]);
    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({ type: "text", text: "test" }),
      ]);
    });
  });

  it("import embedded png (v2)", async () => {
    await API.drop([
      {
        kind: "file",
        file: await API.loadFile("./fixtures/smiley_embedded_v2.png"),
      },
    ]);
    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({ type: "text", text: "😀" }),
      ]);
    });
  });

  it("import embedded svg (legacy v1)", async () => {
    await API.drop([
      {
        kind: "file",
        file: await API.loadFile("./fixtures/test_embedded_v1.svg"),
      },
    ]);
    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({ type: "text", text: "test" }),
      ]);
    });
  });

  it("import embedded svg (v2)", async () => {
    await API.drop([
      {
        kind: "file",
        file: await API.loadFile("./fixtures/smiley_embedded_v2.svg"),
      },
    ]);
    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({ type: "text", text: "😀" }),
      ]);
    });
  });

  it("exporting svg containing transformed images", async () => {
    const normalizeAngle = (angle: number) => (angle / 180) * Math.PI;

    const elements = [
      API.createElement({
        type: "image",
        fileId: "file_A",
        x: 0,
        y: 0,
        scale: [1, 1],
        width: 100,
        height: 100,
        angle: normalizeAngle(315),
      }),
      API.createElement({
        type: "image",
        fileId: "file_A",
        x: 100,
        y: 0,
        scale: [-1, 1],
        width: 50,
        height: 50,
        angle: normalizeAngle(45),
      }),
      API.createElement({
        type: "image",
        fileId: "file_A",
        x: 0,
        y: 100,
        scale: [1, -1],
        width: 100,
        height: 100,
        angle: normalizeAngle(45),
      }),
      API.createElement({
        type: "image",
        fileId: "file_A",
        x: 100,
        y: 100,
        scale: [-1, -1],
        width: 50,
        height: 50,
        angle: normalizeAngle(315),
      }),
    ];
    const appState = { ...getDefaultAppState(), exportBackground: false };
    const files = {
      file_A: {
        id: "file_A" as FileId,
        dataURL: await getDataURL(await API.loadFile("./fixtures/deer.png")),
        mimeType: "image/png",
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    } as const;

    const svg = await exportToSvg(elements, appState, files);

    const svgText = svg.outerHTML;

    // expect 1 <image> element (deduped)
    expect(svgText.match(/<image/g)?.length).toBe(1);
    // expect 4 <use> elements (one for each excalidraw image element)
    expect(svgText.match(/<use/g)?.length).toBe(4);

    // in case of regressions, save the SVG to a file and visually compare to:
    // src/tests/fixtures/svg-image-exporting-reference.svg
    expect(svgText).toMatchSnapshot(`svg export output`);
  });

  describe("a theme backdrop", () => {
    const image =
      "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%2F%3E";
    const exported = (
      exportBackground: boolean,
      canvasTheme: CanvasTheme = {
        backdropImage: image,
        backdropSize: 50,
        backdropExport: true,
      },
    ) =>
      exportToSvg(
        [
          API.createElement({
            type: "rectangle",
            x: 123,
            y: 45,
            width: 10,
            height: 10,
          }),
        ],
        { ...getDefaultAppState(), exportBackground },
        {},
        { canvasTheme },
      );

    it("exports as a pattern anchored to the scene origin when the theme exports it", async () => {
      const svg = await exported(true);

      const pattern = svg.querySelector("pattern#backdrop")!;
      const [background, rect] = Array.from(svg.children).filter(
        (child) => child.tagName === "rect",
      );
      // the export offset is -123 + 10 of padding, so the tile grid starts 37 in
      expect([
        pattern.getAttribute("patternUnits"),
        pattern.getAttribute("width"),
        pattern.getAttribute("x"),
        pattern.querySelector("image")?.getAttribute("href"),
      ]).toEqual(["userSpaceOnUse", "50", "37", image]);
      expect(rect.getAttribute("fill")).toBe("url(#backdrop)");
      expect(rect.getAttribute("width")).toBe(background.getAttribute("width"));
    });

    it("stays out of a transparent export", async () => {
      expect((await exported(false)).querySelector("pattern")).toBeNull();
    });

    it("stays out when the theme keeps it to the editor", async () => {
      const svg = await exported(true, {
        backdropImage: image,
        backdropExport: false,
      });

      expect(svg.querySelector("pattern")).toBeNull();
    });
  });
});
