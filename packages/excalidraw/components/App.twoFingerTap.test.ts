import { TwoFingerDoubleTap } from "./App.twoFingerTap";

const tap = (recogniser: TwoFingerDoubleTap, at: number) => {
  recogniser.down(1, 100, 100, at);
  recogniser.down(2, 140, 100, at + 10);
  return [recogniser.up(1, at + 80), recogniser.up(2, at + 90)];
};

describe("TwoFingerDoubleTap", () => {
  it("fires on the lift that completes the second tap", () => {
    const recogniser = new TwoFingerDoubleTap();

    expect(tap(recogniser, 0)).toEqual([false, false]);
    expect(tap(recogniser, 200)).toEqual([false, true]);
  });

  it("is not wedged by a finger whose lift was never heard", () => {
    const recogniser = new TwoFingerDoubleTap();
    recogniser.down(7, 50, 50, 0);

    tap(recogniser, 2000);

    expect(tap(recogniser, 2200)).toEqual([false, true]);
  });

  it("does not fire when a finger of the pair is cancelled", () => {
    const recogniser = new TwoFingerDoubleTap();
    tap(recogniser, 0);
    recogniser.down(1, 100, 100, 200);
    recogniser.down(2, 140, 100, 210);
    recogniser.cancel(1);

    expect(recogniser.up(2, 290)).toBe(false);
    expect(tap(recogniser, 400)).toEqual([false, false]);
  });
});
