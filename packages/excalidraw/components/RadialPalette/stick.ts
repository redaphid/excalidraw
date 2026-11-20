/**
 * The puck as a joystick, after Sporefall Station's sticks: a pull's
 * direction aims at a tool on the ring, and pulling past the rim picks it.
 * Only the direction counts, so a slice is as easy to hit at any reach.
 */

import { getRingLayout, inSector, toPolar } from "./radialLayout";

/** a pull shorter than this aims at nothing, in CSS px */
export const STICK_DEAD = 10;

/** a pull past this picks what it aims at, in CSS px: Sporefall's full tilt */
export const STICK_RIM = 60;

export type StickReading =
  | Readonly<{ kind: "rest" }>
  | Readonly<{ kind: "aim" | "pick"; index: number }>;

/** what a pull of `dx, dy` from where the puck was pressed does, on a ring
 * of `count` tools laid out as the palette lays them out */
export const readStick = (
  dx: number,
  dy: number,
  count: number,
): StickReading => {
  const { radius, angle } = toPolar(dx, dy);
  if (radius <= STICK_DEAD) {
    return { kind: "rest" };
  }
  return {
    kind: radius > STICK_RIM ? "pick" : "aim",
    index: getRingLayout({ tools: count, pens: 1, colors: 1 }).tools.findIndex(
      (sector) => inSector(angle, sector),
    ),
  };
};
