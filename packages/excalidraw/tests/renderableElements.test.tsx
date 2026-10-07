import { mutateElement, Scene } from "@excalidraw/element";
import { pointFrom, type LocalPoint } from "@excalidraw/math";

import { getDefaultAppState } from "../appState";
import { Renderer } from "../scene/Renderer";

import { API } from "./helpers/api";

import type { AppState } from "../types";

const board = () => {
  const frame = API.createElement({
    type: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 400,
  });
  const below = API.createElement({
    type: "rectangle",
    x: 20,
    y: 20,
    frameId: frame.id,
  });
  const stroke = API.createElement({
    type: "freedraw",
    x: 50,
    y: 50,
    frameId: frame.id,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(30, 10)],
  });
  const scene = new Scene([below, stroke, frame], { skipValidation: true });
  const renderer = new Renderer(scene);
  const appState: AppState = {
    ...getDefaultAppState(),
    width: 500,
    height: 500,
    offsetLeft: 0,
    offsetTop: 0,
    newElement: stroke,
  };
  const render = () =>
    renderer.getRenderableElements({ ...appState, selectedElements: [] });
  const extend = (x: number) =>
    mutateElement(stroke, new Map(), {
      points: [...stroke.points, pointFrom<LocalPoint>(x, 20)],
    });
  return { scene, stroke, render, extend };
};

describe("the elements to render while a stroke is drawn inside a frame", () => {
  it("are reused while only the stroke grows", () => {
    const { render, extend } = board();
    const before = render();
    extend(60);
    const after = render();
    expect(after.canvasNonce).not.toBe(before.canvasNonce);
    expect(after.elementsMap).toBe(before.elementsMap);
    expect(after.visibleElements).toBe(before.visibleElements);
  });

  it("are culled again when the scene changes", () => {
    const { scene, render } = board();
    const before = render();
    scene.triggerUpdate();
    expect(render().visibleElements).not.toBe(before.visibleElements);
  });

  it("are culled again when the stroke goes out of view", () => {
    const { stroke, render } = board();
    const before = render();
    expect(before.visibleElements).toContain(stroke);
    mutateElement(stroke, new Map(), { x: 10_000, y: 10_000 });
    expect(render().visibleElements).not.toContain(stroke);
  });
});
