/**
 * The radial palette's geometry, in palette units around its center. Angles
 * are in degrees on the screen: 0 points right and 90 points down.
 */

export type Band = Readonly<{ inner: number; outer: number }>;

export type Sector = Readonly<{ start: number; end: number }>;

/** an arc whose value runs from 0 at `from` to 1 at `to` */
export type Slider = Readonly<{ from: number; to: number }>;

export const HUB_RADIUS = 30;
export const TOOLS_BAND: Band = { inner: 32, outer: 74 };
export const MIDDLE_BAND: Band = { inner: 76, outer: 122 };
export const OUTER_BAND: Band = { inner: 124, outer: 158 };
export const RING_RADIUS = OUTER_BAND.outer;

/** the top half, left to right */
const TOP = { start: 180, end: 360 };
/** the bottom half, right to left */
const BOTTOM = { start: 0, end: 180 };

/** pen size: grows up the left side of the bottom half */
export const SIZE_SLIDER: Slider = { from: 96, to: 174 };
/** opacity: grows up the right side of the bottom half */
export const OPACITY_SLIDER: Slider = { from: 84, to: 6 };

/** a pointer this far from where it went down is a flick, not a tap */
export const FLICK_DISTANCE = 10;

/** `count` equal sectors from `start` to `end` */
export const spread = (
  count: number,
  start: number,
  end: number,
): readonly Sector[] => {
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, index) => ({
    start: start + step * index,
    end: start + step * (index + 1),
  }));
};

export type RingLayout = Readonly<{
  tools: readonly Sector[];
  pens: readonly Sector[];
  roles: readonly Sector[];
  colors: readonly Sector[];
}>;

export const getRingLayout = (counts: {
  tools: number;
  pens: number;
  roles: number;
  colors: number;
}): RingLayout => {
  // the first tool sits at the top
  const toolStep = 360 / counts.tools;
  return {
    tools: spread(counts.tools, -90 - toolStep / 2, 270 - toolStep / 2),
    pens: spread(counts.pens, TOP.start, TOP.end),
    roles: spread(counts.roles, BOTTOM.start, BOTTOM.end),
    colors: spread(counts.colors, TOP.start, TOP.end),
  };
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** degrees in [0, 360) */
export const normalizeAngle = (degrees: number) =>
  ((degrees % 360) + 360) % 360;

export const polar = (radius: number, degrees: number) => ({
  x: radius * Math.cos(toRadians(degrees)),
  y: radius * Math.sin(toRadians(degrees)),
});

export const toPolar = (dx: number, dy: number) => ({
  radius: Math.hypot(dx, dy),
  angle: normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI),
});

export const sectorMiddle = (sector: Sector) => (sector.start + sector.end) / 2;

export const inSector = (angle: number, sector: Sector) =>
  normalizeAngle(angle - sector.start) < sector.end - sector.start;

const inBand = (radius: number, band: Band) =>
  radius >= band.inner && radius <= band.outer;

const round = (value: number) => Math.round(value * 100) / 100;

/** an annular sector as an SVG path */
export const sectorPath = (band: Band, sector: Sector) => {
  const large = sector.end - sector.start > 180 ? 1 : 0;
  const a = polar(band.outer, sector.start);
  const b = polar(band.outer, sector.end);
  const c = polar(band.inner, sector.end);
  const d = polar(band.inner, sector.start);
  return [
    `M ${round(a.x)} ${round(a.y)}`,
    `A ${band.outer} ${band.outer} 0 ${large} 1 ${round(b.x)} ${round(b.y)}`,
    `L ${round(c.x)} ${round(c.y)}`,
    `A ${band.inner} ${band.inner} 0 ${large} 0 ${round(d.x)} ${round(d.y)}`,
    "Z",
  ].join(" ");
};

/** an arc at `radius` from `from` to `to` degrees, either way round */
export const arcPath = (radius: number, from: number, to: number) => {
  const a = polar(radius, from);
  const b = polar(radius, to);
  const sweep = to > from ? 1 : 0;
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${round(a.x)} ${round(a.y)} A ${radius} ${radius} 0 ${large} ${sweep} ${round(b.x)} ${round(b.y)}`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** the slider's value at `angle`, 0 to 1. Angles past either end clamp to
 * the nearer end. */
export const sliderValue = (slider: Slider, angle: number) => {
  const span = slider.to - slider.from;
  const middle = slider.from + span / 2;
  // measured from the slider's middle, so the far side of the ring falls to
  // whichever end is nearer
  const offset = normalizeAngle(angle - middle + 180) - 180;
  return clamp01(0.5 + offset / span);
};

export const sliderAngle = (slider: Slider, value: number) =>
  slider.from + (slider.to - slider.from) * clamp01(value);

const onSlider = (slider: Slider, angle: number) =>
  inSector(angle, {
    start: Math.min(slider.from, slider.to),
    end: Math.max(slider.from, slider.to),
  });

export type RingHit =
  | Readonly<{ kind: "hub" }>
  | Readonly<{ kind: "tool" | "pen" | "role" | "color"; index: number }>
  | Readonly<{ kind: "size" | "opacity"; value: number }>;

/** what lies at `dx, dy` from the center, in palette units */
export const hitTest = (
  layout: RingLayout,
  dx: number,
  dy: number,
  options: { size: boolean } = { size: true },
): RingHit | null => {
  const { radius, angle } = toPolar(dx, dy);
  if (radius <= HUB_RADIUS) {
    return { kind: "hub" };
  }
  const find = (
    kind: "tool" | "pen" | "role" | "color",
    sectors: readonly Sector[],
  ): RingHit | null => {
    const index = sectors.findIndex((sector) => inSector(angle, sector));
    return index === -1 ? null : { kind, index };
  };
  if (inBand(radius, TOOLS_BAND)) {
    return find("tool", layout.tools);
  }
  if (inBand(radius, MIDDLE_BAND)) {
    return find("pen", layout.pens) ?? find("role", layout.roles);
  }
  if (inBand(radius, OUTER_BAND)) {
    if (options.size && onSlider(SIZE_SLIDER, angle)) {
      return { kind: "size", value: sliderValue(SIZE_SLIDER, angle) };
    }
    if (onSlider(OPACITY_SLIDER, angle)) {
      return { kind: "opacity", value: sliderValue(OPACITY_SLIDER, angle) };
    }
    return find("color", layout.colors);
  }
  return null;
};

/**
 * Where the ring goes: centered on `anchor` when it fits, else moved just
 * far enough to fit, and scaled down when the editor is too small for it.
 */
export const placeRing = (
  anchor: { x: number; y: number },
  bounds: { width: number; height: number },
  margin = 8,
) => {
  const scale = Math.min(
    1,
    (Math.min(bounds.width, bounds.height) / 2 - margin) / RING_RADIUS,
  );
  const reach = RING_RADIUS * scale + margin;
  const fit = (value: number, size: number) =>
    size < reach * 2 ? size / 2 : Math.min(size - reach, Math.max(reach, value));
  return {
    x: fit(anchor.x, bounds.width),
    y: fit(anchor.y, bounds.height),
    scale,
  };
};
