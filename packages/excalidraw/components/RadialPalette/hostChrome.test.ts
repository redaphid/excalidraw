import { measureHostInsets } from "./hostChrome";

/** a phone-sized editor */
const area = { left: 0, top: 0, width: 390, height: 844 };

/** a host whose controls take the rows from `from` to `to` */
const controlsAt =
  (from: number, to: number) =>
  ({ y }: { x: number; y: number }) =>
    y < from || y >= to;

describe("measureHostInsets", () => {
  it("finds no band when nothing is in the way", () => {
    expect(measureHostInsets(area, () => true)).toEqual({ top: 0, bottom: 0 });
  });

  it("covers a bar flush with the editor's top", () => {
    expect(measureHostInsets(area, controlsAt(0, 60)).top).toBe(60);
  });

  // draw's top bar on a phone floats 12 px below the editor's top (#281)
  it("covers a bar that floats a little below the editor's top", () => {
    expect(
      measureHostInsets(area, controlsAt(12, 56)).top,
    ).toBeGreaterThanOrEqual(56);
  });

  it("covers a bar that floats a little above the editor's bottom", () => {
    const { bottom } = measureHostInsets(area, controlsAt(780, 830));
    expect(area.height - bottom).toBeLessThanOrEqual(780);
  });

  it("leaves out a control well inside the editor", () => {
    expect(measureHostInsets(area, controlsAt(120, 160))).toEqual({
      top: 0,
      bottom: 0,
    });
  });
});
