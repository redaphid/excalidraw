import { t } from "../../i18n";
import { TOOLS } from "../Tools";

import { CHIP_RADIUS } from "./equipped";

import type { AppState } from "../../types";

type ToolType = AppState["activeTool"]["type"];

/** the icon the chip shows for each tool: the one place the chip's look
 * comes from, so a redesign swaps this set and nothing else */
const chipIcon = (tool: ToolType) =>
  (TOOLS as Record<string, { icon: React.ReactNode } | undefined>)[tool]?.icon;

/**
 * The equipped tool, floating on the palette's edge: a tap on it, like `x`,
 * puts the tool down and picks up the hand (#305). `at` is the chip's center
 * in its positioned parent.
 */
export const EquippedChip = ({
  tool,
  at,
  onUnequip,
}: {
  tool: ToolType;
  at: { x: number; y: number };
  onUnequip: () => void;
}) => (
  <button
    type="button"
    className="RadialPalette__equipped"
    data-testid="radial-palette-equipped"
    data-tool={tool}
    aria-label={`${t("radialPalette.unequip")} — x`}
    title={`${t("radialPalette.unequip")} — x`}
    style={{
      left: at.x - CHIP_RADIUS,
      top: at.y - CHIP_RADIUS,
      width: CHIP_RADIUS * 2,
      height: CHIP_RADIUS * 2,
    }}
    onPointerDown={(event) => {
      // the board under it, and the ring's backdrop, never see the press
      event.stopPropagation();
    }}
    onClick={(event) => {
      event.stopPropagation();
      onUnequip();
    }}
  >
    <span className="RadialPalette__equipped-icon" aria-hidden="true">
      {chipIcon(tool)}
    </span>
    <span className="RadialPalette__equipped-x" aria-hidden="true">
      <svg viewBox="-6 -6 12 12">
        <path d="M-2.5 -2.5 L2.5 2.5 M2.5 -2.5 L-2.5 2.5" />
      </svg>
    </span>
  </button>
);
