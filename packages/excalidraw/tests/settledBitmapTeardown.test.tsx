import React from "react";

import { getSettledBitmapCount } from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";

import { API } from "./helpers/api";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

/** a stroke at 2x, which gets a settled bitmap once the zoom holds still */
const zoomedStroke = () => ({
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
  appState: { zoom: { value: getNormalizedZoom(2) } },
});

describe("settled bitmaps after an editor unmounts", () => {
  it("are not built for the unmounted editor", async () => {
    const { unmount } = await render(
      <Excalidraw initialData={zoomedStroke()} />,
    );
    const built = getSettledBitmapCount();
    unmount();
    await settle();
    expect(getSettledBitmapCount()).toBe(built);
  });

  it("are still built for another editor on the page", async () => {
    const first = await render(<Excalidraw initialData={zoomedStroke()} />);
    const second = await render(<Excalidraw initialData={zoomedStroke()} />);
    const built = getSettledBitmapCount();
    first.unmount();
    await settle();
    expect(getSettledBitmapCount()).toBeGreaterThan(built);
    second.unmount();
  });
});
