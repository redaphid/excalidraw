import React from "react";

import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";

import { API } from "./helpers/api";
import { act, render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

const scrollTo = (scrollX: number) => {
  act(() => {
    h.app.api.updateScene({ appState: { scrollX } });
  });
};

const hold = (held: boolean) => {
  act(() => {
    h.app.api.holdStaticCanvas(held);
  });
};

const paintedScrollX = () =>
  renderStaticScene.mock.calls.map(([config]) => config.appState.scrollX);

describe("holding the static canvas", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        initialData={{
          elements: [
            API.createElement({ type: "rectangle", id: "rect-held-heron" }),
          ],
        }}
      />,
    );
    renderStaticScene.mockClear();
  });

  afterEach(() => {
    hold(false);
  });

  it("paints nothing while the camera moves under it", () => {
    hold(true);
    scrollTo(100);
    scrollTo(200);

    expect(renderStaticScene).not.toHaveBeenCalled();
    expect(h.state.scrollX).toBe(200);
  });

  it("paints once, where the camera ended up, when let go", () => {
    hold(true);
    scrollTo(100);
    scrollTo(200);
    hold(false);

    expect(paintedScrollX()).toEqual([200]);
  });

  it("does not repaint when let go with nothing changed", () => {
    hold(true);
    hold(false);

    expect(renderStaticScene).not.toHaveBeenCalled();
  });

  it("paints as usual when not held", () => {
    scrollTo(100);

    expect(paintedScrollX()).toEqual([100]);
  });
});
