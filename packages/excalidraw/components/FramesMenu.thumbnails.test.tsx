import React from "react";
import { vi } from "vitest";

import { DEFAULT_SIDEBAR, FRAMES_SIDEBAR_TAB, THEME } from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { fakeClock, frame, realClock, settle } from "../tests/helpers/frames";
import { act, render } from "../tests/test-utils";

import type { DataURL } from "../types";

const { h } = window;

const EXPORT_MS = 100;

const exports = vi.hoisted(() => ({ count: 0, dark: [] as boolean[] }));

vi.mock("@excalidraw/utils/export", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@excalidraw/utils/export")
  >();
  return {
    ...original,
    exportToCanvas: async (
      ...args: Parameters<typeof original.exportToCanvas>
    ) => {
      exports.count++;
      exports.dark.push(!!args[0].appState?.exportWithDarkMode);
      await new Promise((resolve) => setTimeout(resolve, EXPORT_MS));
      return original.exportToCanvas(...args);
    },
  };
});

const thumbnails = () =>
  document.querySelectorAll(".frames-menu__tree .frames-menu__thumb img");

beforeEach(async () => {
  await render(
    <Excalidraw
      frameNavigation={{}}
      initialData={{
        appState: {
          openSidebar: { name: DEFAULT_SIDEBAR.name, tab: FRAMES_SIDEBAR_TAB },
        },
      }}
    />,
  );
  fakeClock();
  API.setElements([
    frame("frame-valley-of-the-sun", 0, 0),
    frame("frame-the-lair", 600, 0),
    frame("frame-thunderwrench", 0, 600),
    API.createElement({
      type: "rectangle",
      id: "rect-rusty-conquistador",
      x: 650,
      y: 50,
      frameId: "frame-the-lair",
    }),
  ]);
  exports.count = 0;
  exports.dark = [];
});

afterEach(realClock);

describe("when a pass is abandoned part-way and the same theme comes back", () => {
  beforeEach(async () => {
    await settle(500 + EXPORT_MS + EXPORT_MS / 2);
    API.setAppState({ theme: THEME.DARK });
    API.setAppState({ theme: THEME.LIGHT });
    await settle(5000);
  });

  it("should still show a thumbnail for every frame", () => {
    expect(thumbnails()).toHaveLength(3);
  });
});

describe("when one frame's contents change after its thumbnail is drawn", () => {
  beforeEach(async () => {
    await settle(5000);
    exports.count = 0;
    act(() => {
      h.app.scene.mutateElement(h.elements[3], { x: 660 });
    });
    await settle(5000);
  });

  it("should redraw only that frame", () => {
    expect(exports.count).toBe(1);
  });
});

describe("when the theme flips to dark after the thumbnails are drawn", () => {
  beforeEach(async () => {
    await settle(5000);
    exports.dark = [];
    API.setAppState({ theme: THEME.DARK });
    await settle(5000);
  });

  it("should redraw every frame dark", () => {
    expect(exports.dark).toEqual([true, true, true]);
  });
});

describe("when an image's file arrives after its frame's thumbnail is drawn", () => {
  beforeEach(async () => {
    API.setElements([
      ...h.elements,
      API.createElement({
        type: "image",
        id: "image-thunderwrench-van",
        fileId: "file-thunderwrench-van" as FileId,
        x: 50,
        y: 650,
        width: 100,
        height: 100,
        frameId: "frame-thunderwrench",
      }),
    ]);
    await settle(5000);
    exports.count = 0;
    act(() => {
      h.app.addFiles([
        {
          id: "file-thunderwrench-van" as FileId,
          mimeType: "image/png",
          dataURL: "data:image/png;base64," as DataURL,
          created: 1,
        },
      ]);
    });
    await settle(5000);
  });

  it("should redraw that frame", () => {
    expect(exports.count).toBe(1);
  });
});
