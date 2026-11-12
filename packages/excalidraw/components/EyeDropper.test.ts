import { compositeOver } from "./EyeDropper";

const pixel = (r: number, g: number, b: number, a: number) =>
  new Uint8ClampedArray([r, g, b, a]);

describe("compositeOver", () => {
  it("blends translucent paint into an opaque background", () => {
    expect(
      compositeOver(pixel(255, 0, 0, 128), pixel(255, 255, 255, 255)),
    ).toEqual([255, 127, 127]);
  });

  it("keeps translucent paint's own colour over a clear background", () => {
    expect(compositeOver(pixel(255, 0, 0, 128), pixel(0, 0, 0, 0))).toEqual([
      255, 0, 0,
    ]);
  });

  it("weighs a translucent background by what the paint lets through", () => {
    expect(compositeOver(pixel(255, 0, 0, 128), pixel(0, 0, 255, 128))).toEqual(
      [170, 0, 85],
    );
  });
});
