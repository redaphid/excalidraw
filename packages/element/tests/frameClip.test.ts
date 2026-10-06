import { arrayToMap } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type { StaticCanvasAppState } from "@excalidraw/excalidraw/types";

import { shouldApplyFrameClip } from "../src/frame";
import {
  newArrowElement,
  newElement,
  newFrameElement,
  newFreeDrawElement,
} from "../src/newElement";

import type { ExcalidrawElement, ExcalidrawFrameElement } from "../src/types";

const appState = {
  frameRendering: { enabled: true, clip: true, name: true, outline: true },
  selectedElementsAreBeingDragged: false,
} as StaticCanvasAppState;

const QUARTER_TURN = (Math.PI / 4) as Radians;

const frameAt = (angle = 0 as Radians) =>
  newFrameElement({ x: 0, y: 0, width: 100, height: 100, angle });

const shape = (
  type: "rectangle" | "ellipse" | "diamond",
  x: number,
  y: number,
  width: number,
  height: number,
  angle = 0 as Radians,
) => newElement({ type, x, y, width, height, angle });

const stroke = (x: number, y: number, length: number) =>
  newFreeDrawElement({
    type: "freedraw",
    x,
    y,
    simulatePressure: false,
    points: Array.from({ length: 11 }, (_, i) =>
      pointFrom<LocalPoint>((i * length) / 10, Math.sin(i) * 3),
    ),
  });

const arrow = (x: number, y: number, dx: number, dy: number) =>
  newArrowElement({
    type: "arrow",
    x,
    y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(dx, dy)],
  });

const clips = (element: ExcalidrawElement, frame: ExcalidrawFrameElement) => {
  const placed = { ...element, frameId: frame.id };
  return shouldApplyFrameClip(
    placed,
    frame,
    appState,
    arrayToMap([frame, placed]),
  );
};

describe("clipping an element to its frame (0..100 on both axes)", () => {
  it("does not clip a rectangle well inside the frame", () => {
    expect(clips(shape("rectangle", 20, 20, 30, 30), frameAt())).toBe(false);
  });

  it("does not clip a rectangle well outside the frame", () => {
    expect(clips(shape("rectangle", 300, 300, 30, 30), frameAt())).toBe(false);
  });

  it("clips a rectangle crossing the frame's right edge", () => {
    expect(clips(shape("rectangle", 80, 20, 40, 30), frameAt())).toBe(true);
  });

  it("clips a rectangle that contains the whole frame", () => {
    expect(clips(shape("rectangle", -50, -50, 200, 200), frameAt())).toBe(true);
  });

  it("does not clip a rectangle whose left side lies on the frame's right edge", () => {
    expect(clips(shape("rectangle", 100, 20, 20, 30), frameAt())).toBe(false);
  });

  it("does not clip a rectangle whose right side lies on the frame's right edge", () => {
    expect(clips(shape("rectangle", 80, 20, 20, 30), frameAt())).toBe(false);
  });

  it("clips a rotated rectangle whose corner pokes past the frame's edge", () => {
    expect(
      clips(shape("rectangle", 85, 40, 20, 20, QUARTER_TURN), frameAt()),
    ).toBe(true);
  });

  it("does not clip a rotated rectangle whose box overlaps the frame but whose outline stays outside", () => {
    expect(
      clips(shape("rectangle", 105, 105, 40, 40, QUARTER_TURN), frameAt()),
    ).toBe(false);
  });

  it("does not clip an ellipse whose box overlaps the frame's corner but whose curve stays outside", () => {
    expect(clips(shape("ellipse", 95, 95, 40, 40), frameAt())).toBe(false);
  });

  it("clips an ellipse whose curve crosses the frame's corner", () => {
    expect(clips(shape("ellipse", 85, 85, 40, 40), frameAt())).toBe(true);
  });

  it("clips a rectangle inside a rotated frame's box that crosses the frame's edge", () => {
    expect(clips(shape("rectangle", 5, 5, 25, 25), frameAt(QUARTER_TURN))).toBe(
      true,
    );
  });

  it("does not clip a rectangle inside a rotated frame's box but outside the frame", () => {
    expect(clips(shape("rectangle", 0, 0, 8, 8), frameAt(QUARTER_TURN))).toBe(
      false,
    );
  });

  it("does not clip a rectangle well inside a rotated frame", () => {
    expect(
      clips(shape("rectangle", 40, 40, 20, 20), frameAt(QUARTER_TURN)),
    ).toBe(false);
  });

  // a diamond's corners sit a whole unit right of and below its centre
  // (getDiamondPoints), so its outline reaches past its bounds
  it("clips a small diamond whose outline crosses the frame's edge though its bounds stay inside", () => {
    expect(clips(shape("diamond", 99.2, 50, 0.5, 0.5), frameAt())).toBe(true);
  });

  it("does not clip a stroke inside the frame", () => {
    expect(clips(stroke(20, 50, 40), frameAt())).toBe(false);
  });

  it("clips a stroke crossing the frame's right edge", () => {
    expect(clips(stroke(81, 50, 40), frameAt())).toBe(true);
  });

  it("does not clip a stroke outside the frame", () => {
    expect(clips(stroke(120, 50, 40), frameAt())).toBe(false);
  });

  it("clips an arrow crossing the frame's right edge", () => {
    expect(clips(arrow(80, 50, 60, 0), frameAt())).toBe(true);
  });

  it("does not clip an arrow outside the frame", () => {
    expect(clips(arrow(120, 20, 60, 40), frameAt())).toBe(false);
  });
});
