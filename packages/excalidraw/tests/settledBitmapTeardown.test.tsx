import React from "react";

import { getSettledBitmapCount } from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

import type { ExcalidrawImperativeAPI } from "../types";

unmountComponent();

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

/** an editor showing a freedraw stroke, which gets a settled bitmap once the
 * zoom holds still */
const mountEditor = async () => {
  let api: ExcalidrawImperativeAPI | null = null;
  const { unmount } = await render(
    <Excalidraw
      onExcalidrawAPI={(nextApi) => {
        api = nextApi;
      }}
      initialData={{
        elements: [
          API.createElement({
            type: "freedraw",
            x: 10,
            y: 10,
            points: [
              pointFrom<LocalPoint>(0, 0),
              pointFrom<LocalPoint>(20, 10),
              pointFrom<LocalPoint>(40, 0),
            ],
          }),
        ],
      }}
    />,
  );
  await settle();
  return {
    unmount,
    /** zooms to a scale the stroke has no bitmap for, so a build is pending;
     * jsdom lays the editor out at 0x0, where no bitmap fits the screen */
    zoomTo: (zoom: number) =>
      act(() => {
        api!.updateScene({
          appState: {
            width: 500,
            height: 500,
            zoom: { value: getNormalizedZoom(zoom) },
          },
        });
      }),
  };
};

describe("settled bitmaps after an editor unmounts", () => {
  it("are not built for the unmounted editor", async () => {
    const editor = await mountEditor();
    editor.zoomTo(2);
    const built = getSettledBitmapCount();
    editor.unmount();
    await settle();
    expect(getSettledBitmapCount()).toBe(built);
  });

  it("are still built for another editor on the page", async () => {
    const first = await mountEditor();
    const second = await mountEditor();
    second.zoomTo(2);
    const built = getSettledBitmapCount();
    first.unmount();
    await settle();
    expect(getSettledBitmapCount()).toBeGreaterThan(built);
    second.unmount();
  });
});
