import {
  cameraToDropPin,
  movePin,
  pinFrameAt,
  pinnedBox,
} from "./pinnedFrames";

const frame = { x: 100, y: 50, width: 200, height: 100 };

describe("pinFrameAt", () => {
  it("pins the frame where it is on screen, at the zoom it is drawn at", () => {
    expect(
      pinFrameAt(frame, { scrollX: -20, scrollY: 10, zoom: { value: 2 } }),
    ).toEqual({ x: 160, y: 120, scale: 2 });
  });
});

describe("pinnedBox", () => {
  it("keeps the frame's size at the zoom it was pinned", () => {
    expect(pinnedBox({ x: 160, y: 120, scale: 2 }, frame)).toEqual({
      left: 160,
      top: 120,
      width: 400,
      height: 200,
    });
  });
});

describe("movePin", () => {
  const editor = { width: 390, height: 844 };
  const pin = { x: 40, y: 40, scale: 1 };

  it("moves by the drag", () => {
    expect(movePin(pin, frame, { dx: 30, dy: -10 }, editor)).toEqual({
      x: 70,
      y: 30,
      scale: 1,
    });
  });

  it("keeps a corner on screen when dragged past an edge", () => {
    const off = movePin(pin, frame, { dx: 5000, dy: 5000 }, editor);
    expect(off.x).toBeLessThanOrEqual(editor.width - 32);
    expect(off.y).toBeLessThanOrEqual(editor.height - 32);
    const back = movePin(pin, frame, { dx: -5000, dy: -5000 }, editor);
    expect(back.x + frame.width).toBeGreaterThanOrEqual(32);
    expect(back.y + frame.height).toBeGreaterThanOrEqual(32);
  });
});

describe("cameraToDropPin", () => {
  it("puts the board under the pin so the frame lands where it was shown", () => {
    const pin = { x: 160, y: 120, scale: 2 };
    const camera = cameraToDropPin(pin, frame);
    expect(camera.zoom.value).toBe(2);
    // the frame's top-left, drawn with this camera, is where the pin was
    expect((frame.x + camera.scrollX) * 2).toBeCloseTo(160);
    expect((frame.y + camera.scrollY) * 2).toBeCloseTo(120);
  });
});
