// Spike for #85, not for merge: a world-anchored SVG backdrop drawn as a
// canvas pattern under the grid.

const MIN_SPACING = 24;

export const BACKDROP_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cpath d='M0 0H100M0 0V100' stroke='%233b82c4' stroke-width='2' vector-effect='non-scaling-stroke'/%3E%3C/svg%3E";

/** the two power-of-10 periods, in scene units, and the finer one's fade */
export const backdropLevels = (zoom: number) => {
  const k = Math.ceil(Math.log10(MIN_SPACING / zoom));
  const fine = 10 ** k;
  const fade = Math.min(1, Math.max(0, Math.log10((fine * zoom) / MIN_SPACING)));
  return [
    { period: fine, opacity: fade },
    { period: fine * 10, opacity: 1 },
  ];
};

let image: HTMLImageElement | null = null;
const patterns = new Map<number, CanvasPattern>();

const patternOf = (context: CanvasRenderingContext2D, size: number) => {
  let pattern = patterns.get(size);
  if (!pattern) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = size;
    tile.getContext("2d")!.drawImage(image!, 0, 0, size, size);
    pattern = context.createPattern(tile, "repeat")!;
    if (patterns.size > 64) {
      patterns.clear();
    }
    patterns.set(size, pattern);
  }
  return pattern;
};

const mod = (a: number, b: number) => ((a % b) + b) % b;

export const strokeBackdrop = (
  context: CanvasRenderingContext2D,
  scrollX: number,
  scrollY: number,
  zoom: number,
  scale: number,
) => {
  if (!(window as any).__backdropSpike) {
    return;
  }
  if (!image) {
    image = new Image();
    image.src = BACKDROP_SVG;
  }
  if (!image.complete) {
    return;
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  for (const { period, opacity } of backdropLevels(zoom)) {
    const spacing = period * zoom * scale;
    const size = Math.max(1, Math.round(spacing));
    const pattern = patternOf(context, size);
    pattern.setTransform(
      new DOMMatrix()
        .translate(
          mod(scrollX, period) * zoom * scale,
          mod(scrollY, period) * zoom * scale,
        )
        .scale(spacing / size),
    );
    context.globalAlpha = opacity * 0.6;
    context.fillStyle = pattern;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  }
  context.restore();
};
