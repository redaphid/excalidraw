// Spike for #85, not for merge: the same world-anchored SVG backdrop as
// theme CSS behind a transparent canvas, driven by three custom properties
// the host publishes on pan and zoom.

import {
  BACKDROP_SVG,
  backdropLevels,
} from "../packages/excalidraw/renderer/backdropSpike";

const layer = (size: string, opacity: string) => `
  background-image: url("${BACKDROP_SVG}");
  background-size: ${size} ${size};
  background-position:
    mod(calc(var(--canvas-scroll-x) * var(--canvas-zoom) * 1px), ${size})
    mod(calc(var(--canvas-scroll-y) * var(--canvas-zoom) * 1px), ${size});
  opacity: ${opacity};`;

export const BACKDROP_CSS = `
:scope {
  isolation: isolate;
  --canvas-background: transparent;
  --bd-fine: pow(10, round(up, log(calc(24 / var(--canvas-zoom)), 10), 1));
  --bd-px: calc(var(--bd-fine) * var(--canvas-zoom) * 1px);
  --bd-fade: clamp(0, log(calc(var(--bd-fine) * var(--canvas-zoom) / 24), 10), 1);
}
:scope::before,
:scope::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
:scope::before {${layer("var(--bd-px)", "calc(0.6 * var(--bd-fade))")}
}
:scope::after {${layer("calc(var(--bd-px) * 10)", "0.6")}
}
`;

export const publishCamera = (
  scrollX: number,
  scrollY: number,
  zoom: { value: number },
) => {
  const container = document.querySelector<HTMLElement>(".excalidraw");
  container?.style.setProperty("--canvas-zoom", String(zoom.value));
  container?.style.setProperty("--canvas-scroll-x", String(scrollX));
  container?.style.setProperty("--canvas-scroll-y", String(scrollY));
};

// The lean CSS variant: theme CSS gives only the image; the host moves two
// childless layers by transform, so a pan restyles two elements and paints
// nothing.
export const LEAN_CSS = `
:scope {
  isolation: isolate;
  --canvas-background: transparent;
  --canvas-backdrop: url("${BACKDROP_SVG}");
}`;

const mod = (a: number, b: number) => ((a % b) + b) % b;
let layers: HTMLElement[] | null = null;

export const placeLean = (
  scrollX: number,
  scrollY: number,
  zoom: { value: number },
) => {
  const container = document.querySelector<HTMLElement>(".excalidraw");
  if (!container) {
    return;
  }
  if (!layers?.[0].isConnected) {
    layers = [0, 1].map(() => {
      const layer = document.createElement("div");
      layer.style.cssText =
        "position:absolute;left:0;top:0;z-index:-1;pointer-events:none;will-change:transform;background-image:var(--canvas-backdrop)";
      container.prepend(layer);
      return layer;
    });
  }
  backdropLevels(zoom.value).forEach(({ period, opacity }, i) => {
    const layer = layers![i];
    const spacing = period * zoom.value;
    const key = `${spacing} ${container.clientWidth} ${container.clientHeight}`;
    if (layer.dataset.key !== key) {
      layer.dataset.key = key;
      layer.style.backgroundSize = `${spacing}px ${spacing}px`;
      layer.style.width = `${container.clientWidth + 2 * spacing}px`;
      layer.style.height = `${container.clientHeight + 2 * spacing}px`;
      layer.style.opacity = String(opacity * 0.6);
    }
    layer.style.transform = `translate(${
      mod(scrollX, period) * zoom.value - spacing
    }px, ${mod(scrollY, period) * zoom.value - spacing}px)`;
  });
};
