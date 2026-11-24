import type { AppState } from "../../types";
import type { HostInsets } from "./hostChrome";

type ToolType = AppState["activeTool"]["type"];

/** the tools a hand rests on: holding one of these is holding nothing */
const RESTING: readonly ToolType[] = ["hand", "selection", "lasso"];

/** whether `tool` is equipped: picked up, so it shows on the palette's edge
 * and `x` puts it down again (#305) */
export const isEquipped = (tool: ToolType) => !RESTING.includes(tool);

/** the chip's radius: a 44px thumb target */
export const CHIP_RADIUS = 22;
/** the space between the palette's rim and the chip */
const CHIP_GAP = 4;
/** where the chip may sit on the rim, in screen degrees (0 is right, -90 is
 * up), in order of preference: the right edge first, then round over the top
 * to the left, then the bottom */
const CHIP_ANGLES = [0, -30, -60, -90, -120, -150, 180, 30, 60, 90];

/**
 * Where the equipped chip's center goes, beside a palette centered at
 * `center` with radius `rim`, in an editor of `bounds` whose top and bottom
 * bands the host's controls take (`insets`, as `measureHostInsets` finds
 * them): on the outer right edge when it fits, else at the first spot round
 * the rim that does. A chip under a host's bar could never be pressed.
 */
export const chipSpot = (
  center: { x: number; y: number },
  rim: number,
  bounds: { width: number; height: number },
  insets: HostInsets = { top: 0, bottom: 0 },
) => {
  const reach = rim + CHIP_GAP + CHIP_RADIUS;
  const spots = CHIP_ANGLES.map((degrees) => {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: center.x + reach * Math.cos(radians),
      y: center.y + reach * Math.sin(radians),
    };
  });
  const fits = ({ x, y }: { x: number; y: number }) =>
    x - CHIP_RADIUS >= 0 &&
    y - CHIP_RADIUS >= insets.top &&
    x + CHIP_RADIUS <= bounds.width &&
    y + CHIP_RADIUS <= bounds.height - insets.bottom;
  return spots.find(fits) ?? spots[0];
};
