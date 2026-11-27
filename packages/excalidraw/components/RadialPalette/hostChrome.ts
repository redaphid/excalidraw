/**
 * What the host draws over the editor and takes taps there, such as draw's
 * top bar on a phone. The palette cannot know the host's layout, so it
 * measures it, and keeps the puck and the ring clear of it: a slice or a
 * puck under a host's button can never be pressed.
 */

type Point = Readonly<{ x: number; y: number }>;

/** what takes a tap that lands on it */
export const TAKES_TAPS_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="dialog"], [contenteditable]:not([contenteditable="false"])';

/** the palette's own parts, which never count as the host's */
const PALETTE_SELECTOR =
  ".RadialPalette, .RadialPalette__backdrop, .RadialPalette__puck, .RadialPalette__equipped";

/**
 * Whether a press at `at` reaches the editor's canvas rather than a control
 * above it: the first thing there, past the palette's own parts, is inside
 * the editor and takes no taps. True when nothing can be measured.
 */
export const takesNoTaps = (
  doc: Document,
  editor: Element | null,
  at: Point,
) => {
  if (!editor || typeof doc.elementsFromPoint !== "function") {
    return true;
  }
  const above = doc
    .elementsFromPoint(at.x, at.y)
    .find((element) => !element.closest(PALETTE_SELECTOR));
  if (!above) {
    // nothing measured there, so nothing known to be in the way
    return true;
  }
  return editor.contains(above) && !above.closest(TAKES_TAPS_SELECTOR);
};

/** the editor's box in client terms */
export type EditorArea = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/** how much of the editor's top and bottom the host's controls take, in
 * CSS px */
export type HostInsets = Readonly<{ top: number; bottom: number }>;

/** how far apart the probes across the editor are, in CSS px */
const PROBE_GAP = 24;
/** how far each probe steps in from the edge, in CSS px */
const PROBE_STEP = 6;
/** the most of the editor's height either edge's controls may take */
const MOST = 0.3;
/** how much clear room past the last control ends a probe's walk, in CSS px:
 * a host's bar may float this far in from the edge, as draw's does (#281) */
const SLACK = 24;

/**
 * The bands along the editor's top and bottom that the host's controls
 * cover: probes across the editor step in from each edge past its controls
 * until SLACK px of canvas follow them, and the deepest one sets the band.
 */
export const measureHostInsets = (
  area: EditorArea,
  clear: (at: Point) => boolean,
): HostInsets => {
  const most = area.height * MOST;
  const depth = (edgeY: (inset: number) => number) => {
    let deepest = 0;
    for (
      let x = area.left + PROBE_GAP / 2;
      x < area.left + area.width;
      x += PROBE_GAP
    ) {
      let band = 0;
      for (
        let inset = 0;
        inset < most && inset < band + SLACK;
        inset += PROBE_STEP
      ) {
        if (!clear({ x, y: edgeY(inset) })) {
          band = inset + PROBE_STEP;
        }
      }
      deepest = Math.max(deepest, band);
    }
    return deepest;
  };
  return {
    top: depth((inset) => area.top + inset),
    bottom: depth((inset) => area.top + area.height - 1 - inset),
  };
};
