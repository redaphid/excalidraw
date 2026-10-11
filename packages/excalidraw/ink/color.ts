import { applyDarkModeFilter } from "@excalidraw/common";

export type Rgba = [number, number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const parseHex = (css: string): Rgba | null => {
  const m = HEX.exec(css.trim());
  if (!m?.[1]) {
    return null;
  }
  const digits =
    m[1].length <= 4 ? [...m[1]].map((d) => d + d) : m[1].match(/../g);
  const [r = 0, g = 0, b = 0, a = 255] = (digits ?? []).map((d) =>
    Number.parseInt(d, 16),
  );
  return [r / 255, g / 255, b / 255, a / 255];
};

/**
 * The colour Excalidraw paints `css` in: in the dark, its own
 * `applyDarkModeFilter`, which is how it draws every element and the board's
 * background there.
 */
const paintedColor = (
  css: string,
  dark: boolean,
  resolve: (css: string) => Rgba,
): Rgba => {
  const painted = applyDarkModeFilter(css, dark);
  return parseHex(painted) ?? resolve(painted);
};

type InkColorOptions = {
  dark: boolean;
  /** Excalidraw's 0–100 element opacity. */
  opacity: number;
  /** For anything that is not hex: named colours, rgb(), and so on. */
  resolve(css: string): Rgba;
};

/** Premultiplied, as the ink canvas blends. */
export const inkColor = (
  css: string,
  { dark, opacity, resolve }: InkColorOptions,
): Rgba => {
  const [r, g, b, a] = paintedColor(css, dark, resolve);
  const alpha = a * (opacity / 100);
  return [r * alpha, g * alpha, b * alpha, alpha];
};
