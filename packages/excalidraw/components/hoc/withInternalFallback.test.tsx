import React from "react";

import { Excalidraw, MainMenu } from "../../index";
import { act, render, waitFor } from "../../tests/test-utils";

import type { ExcalidrawImperativeAPI } from "../../types";

// The main menu has no trigger: open each instance's menu through its API
// and count the menus each instance composes.
const menusPerInstance = async (
  renderTwo: (
    keep: (api: ExcalidrawImperativeAPI | null) => void,
  ) => React.ReactNode,
) => {
  const apis: ExcalidrawImperativeAPI[] = [];
  const { container } = await render(
    <div>{renderTwo((api) => api && apis.push(api))}</div>,
  );
  await waitFor(() => expect(apis.length).toBe(2));
  act(() => {
    apis.forEach((api) =>
      api.updateScene({ appState: { openMenu: "canvas" } }),
    );
  });
  return Array.from(
    container.querySelectorAll<HTMLDivElement>(".excalidraw-container"),
  ).map((instance) => instance.querySelectorAll(".main-menu").length);
};

describe("Test internal component fallback rendering", () => {
  it("should render only one menu per excalidraw instance (custom menu first scenario)", async () => {
    const counts = await menusPerInstance((keep) => (
      <>
        <Excalidraw onExcalidrawAPI={keep}>
          <MainMenu>test</MainMenu>
        </Excalidraw>
        <Excalidraw onExcalidrawAPI={keep} />
      </>
    ));

    expect(counts).toEqual([1, 1]);
  });

  it("should render only one menu per excalidraw instance (default menu first scenario)", async () => {
    const counts = await menusPerInstance((keep) => (
      <>
        <Excalidraw onExcalidrawAPI={keep} />
        <Excalidraw onExcalidrawAPI={keep}>
          <MainMenu>test</MainMenu>
        </Excalidraw>
      </>
    ));

    expect(counts).toEqual([1, 1]);
  });

  it("should render only one menu per excalidraw instance (two custom menus scenario)", async () => {
    const counts = await menusPerInstance((keep) => (
      <>
        <Excalidraw onExcalidrawAPI={keep}>
          <MainMenu>test</MainMenu>
        </Excalidraw>
        <Excalidraw onExcalidrawAPI={keep}>
          <MainMenu>test</MainMenu>
        </Excalidraw>
      </>
    ));

    expect(counts).toEqual([1, 1]);
  });

  it("should render only one menu per excalidraw instance (two default menus scenario)", async () => {
    const counts = await menusPerInstance((keep) => (
      <>
        <Excalidraw onExcalidrawAPI={keep} />
        <Excalidraw onExcalidrawAPI={keep} />
      </>
    ));

    expect(counts).toEqual([1, 1]);
  });
});
