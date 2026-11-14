import { FONT_FAMILY } from "./constants";
import { FONT_METADATA } from "./font-metadata";

/**
 * A text element's variation axis values, keyed by OpenType axis tag, such
 * as `{ wght: 650, BNCE: 40 }`. An axis left out takes the family's default.
 */
export type FontAxes = Readonly<Record<string, number>>;

/** One variation axis of a variable font family. */
export type FontAxisRange = Readonly<{
  min: number;
  /**
   * The value an axis left out takes: the family's regular instance, which
   * need not be the font file's own default.
   */
  default: number;
  max: number;
}>;

/** The axes of a variable font family, or `undefined` for any other family. */
export const getFontAxisRanges = (
  fontFamily: number,
): Readonly<Record<string, FontAxisRange>> | undefined =>
  FONT_METADATA[fontFamily]?.axes;

const clamp = (value: number, { min, max }: FontAxisRange) =>
  Math.min(max, Math.max(min, value));

/**
 * The axis values a text element may keep for its family: tags the family
 * does not have and values that are not numbers are dropped, the rest are
 * clamped to the axis and rounded to whole units, so the instances a family
 * can be asked for are countable. `undefined` when nothing is left.
 */
export const normalizeFontAxes = (
  fontFamily: number,
  axes: unknown,
): FontAxes | undefined => {
  const ranges = getFontAxisRanges(fontFamily);
  if (!ranges || !axes || typeof axes !== "object") {
    return undefined;
  }
  const kept: Record<string, number> = {};
  for (const tag of Object.keys(ranges)) {
    const value = (axes as Record<string, unknown>)[tag];
    if (typeof value === "number" && Number.isFinite(value)) {
      kept[tag] = Math.round(clamp(value, ranges[tag]));
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
};

/**
 * Every axis of the family with the value the element draws at, in the
 * family's axis order: `undefined` for a family without axes.
 */
const instanceOf = (
  fontFamily: number,
  axes: FontAxes | null | undefined,
): Array<[tag: string, value: number]> | undefined => {
  const ranges = getFontAxisRanges(fontFamily);
  if (!ranges) {
    return undefined;
  }
  const kept = normalizeFontAxes(fontFamily, axes) ?? {};
  return Object.keys(ranges).map((tag): [string, number] => [
    tag,
    kept[tag] ?? ranges[tag].default,
  ]);
};

/**
 * The font family name the instance's own font faces are registered under,
 * such as `Shantell Sans wght650 BNCE-40`: the family's name, then each axis
 * that is off its default. Canvas text has no setter for variation axes, so
 * an instance is drawn and measured by naming a family whose faces carry
 * them. `undefined` for the regular instance, which is the family itself.
 */
export const getFontInstanceFamily = (
  fontFamily: number,
  axes: FontAxes | null | undefined,
): string | undefined => {
  const ranges = getFontAxisRanges(fontFamily);
  const [familyName] =
    Object.entries(FONT_FAMILY).find(([, id]) => id === fontFamily) ?? [];
  const moved = instanceOf(fontFamily, axes)?.filter(
    ([tag, value]) => value !== ranges?.[tag].default,
  );
  if (!familyName || !moved || moved.length === 0) {
    return undefined;
  }
  return [familyName, ...moved.map(([tag, value]) => `${tag}${value}`)].join(
    " ",
  );
};

/**
 * The `font-variation-settings` of the instance's font faces, naming every
 * axis of the family, such as `"wght" 650, "INFM" 0, "BNCE" -40, "SPAC" 0`.
 * With no axes it is the regular instance's. `undefined` for a family
 * without axes.
 */
export const getFontVariationSettings = (
  fontFamily: number,
  axes?: FontAxes | null,
): string | undefined =>
  instanceOf(fontFamily, axes)
    ?.map(([tag, value]) => `"${tag}" ${value}`)
    .join(", ");
