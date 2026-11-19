import React from "react";

import { elementWithCanvasCache } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { snapScrollToDevicePixels } from "../renderer/helpers";

import { API } from "./helpers/api";
import { act, GlobalTestState, render, waitFor } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

type CanvasEvent = {
  type: string;
  transform: [number, number, number, number, number, number];
  props: {
    dx: number;
    dy: number;
    dWidth: number;
    dHeight: number;
    sx?: number;
    sy?: number;
    sWidth: number;
    sHeight: number;
  };
};

/** the static canvas's element blits, in device pixels */
const getBlits = () => {
  const context = GlobalTestState.canvas.getContext("2d") as any;
  return (context.__getEvents() as CanvasEvent[])
    .filter((event) => event.type === "drawImage")
    .map(({ transform: [a, b, c, d, e, f], props }) => {
      // where the bitmap's own origin lands, when only part of it is blitted
      const dx = props.sx
        ? props.dx - (props.sx * props.dWidth) / props.sWidth
        : props.dx;
      const dy = props.sy
        ? props.dy - (props.sy * props.dHeight) / props.sHeight
        : props.dy;
      return {
        // the matrix's scale, whatever its rotation
        scale: Math.hypot(a, b),
        x: a * dx + c * dy + e,
        y: b * dx + d * dy + f,
        width: props.dWidth,
      };
    });
};

/** re-renders at the given viewport and returns that render's blits */
const renderAt = async (zoom: number, scrollX: number, scrollY: number) => {
  (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
  API.setAppState({
    zoom: { value: zoom as NormalizedZoomValue },
    scrollX,
    scrollY,
  });
  return waitFor(() => {
    // the static scene renders on the next frame
    const blits = getBlits().filter(
      (blit) => Math.abs(blit.scale - zoom) < 1e-9,
    );
    expect(blits.length).toBeGreaterThan(0);
    return blits;
  });
};

const distanceToWholePixel = ({ x, y }: { x: number; y: number }) =>
  Math.abs(x - Math.round(x)) + Math.abs(y - Math.round(y));

describe("element pixel snap", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
    // jsdom gives the editor no size, which culls every element
    API.setAppState({ width: 800, height: 600 });
  });

  it.each([
    // above 1x, text is drawn directly instead of blitted
    ["text", { type: "text" as const, text: "hello" }, [1, 0.73, 0.5]],
    [
      "rectangle",
      { type: "rectangle" as const, width: 120, height: 60 },
      [1, 1.5, 0.73, 2.2],
    ],
  ])(
    "blits an unrotated %s on whole device pixels at any zoom",
    async (_, props, zooms) => {
      API.setElements([API.createElement({ x: 10.37, y: 20.61, ...props })]);
      for (const zoom of zooms) {
        const blits = await renderAt(zoom, 3.3, -7.77);
        for (const blit of blits) {
          expect(distanceToWholePixel(blit)).toBeLessThan(1e-6);
        }
      }
    },
  );

  it.each([Math.PI / 2, (3 * Math.PI) / 2])(
    "snaps a right-angle rotation (%s rad) without displacing it",
    async (angle) => {
      API.setElements([
        API.createElement({
          type: "rectangle",
          x: 110.37,
          y: 120.61,
          width: 120,
          height: 60,
          angle: angle as any,
        }),
      ]);
      const blits = await renderAt(1.5, 3.3, -7.77);
      for (const blit of blits) {
        expect(distanceToWholePixel(blit)).toBeLessThan(1e-6);
        // and it stays where the element is — a formula that divides by the
        // near-zero diagonal of a rotation sends it far offscreen
        expect(Math.abs(blit.x)).toBeLessThan(2000);
        expect(Math.abs(blit.y)).toBeLessThan(2000);
      }
    },
  );

  it("does not snap while a zoom gesture keeps the cached bitmaps", async () => {
    API.setElements([
      API.createElement({ type: "text", x: 10.37, y: 20.61, text: "hello" }),
    ]);
    // the bitmaps are resampled during the gesture; rounding would only
    // make elements twitch
    await renderAt(1, 0, 0);
    (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
    API.setAppState({
      shouldCacheIgnoreZoom: true,
      zoom: { value: 0.73 as NormalizedZoomValue },
      scrollX: 3.3,
      scrollY: -7.77,
    });
    const [blit] = await waitFor(() => {
      const blits = getBlits();
      expect(blits.length).toBeGreaterThan(0);
      return blits;
    });
    expect(distanceToWholePixel(blit)).toBeGreaterThan(1e-3);
    API.setAppState({ shouldCacheIgnoreZoom: false });
  });

  it.each([
    // a plain fractional offset, and one that is exactly half a device pixel
    // at 50% (51 scene units → 25.5), where the float noise of a drag used
    // to flip the rounding between two neighbors. Labels are blitted only
    // at or below 1x.
    ["fractional", { box: [100.3, 100.3], label: [150.7, 140.2] }],
    ["half-pixel tie", { box: [10, 10], label: [61, 30] }],
  ])(
    "keeps a label at a constant device offset from its container while dragged (%s)",
    async (_, { box, label }) => {
      const offsets = new Set<string>();
      for (const drag of [0, 0.3, 0.4, 0.7, 1.4]) {
        API.setElements([
          API.createElement({
            type: "rectangle",
            id: "box",
            x: box[0] + drag,
            y: box[1] + drag,
            width: 200,
            height: 100,
            boundElements: [{ type: "text", id: "label" }],
          }),
          API.createElement({
            type: "text",
            id: "label",
            x: label[0] + drag,
            y: label[1] + drag,
            text: "hi",
            fontSize: 20,
            containerId: "box",
          }),
        ]);
        const blits = await renderAt(0.5, 3.3, -7.77);
        expect(blits).toHaveLength(2);
        for (const blit of blits) {
          expect(distanceToWholePixel(blit)).toBeLessThan(1e-6);
        }
        // the container's bitmap is the wider one; what must hold still is
        // where each is drawn, its bitmap's place plus its phase in it
        const [labelAt, boxAt] = getElementOrigins().sort(
          (p, q) => p.width - q.width,
        );
        offsets.add(
          `${(labelAt.x - boxAt.x).toFixed(6)},${(labelAt.y - boxAt.y).toFixed(
            6,
          )}`,
        );
      }
      expect(offsets.size).toBe(1);
    },
  );

  it("leaves rotated elements alone", async () => {
    API.setElements([
      API.createElement({
        type: "text",
        x: 10.37,
        y: 20.61,
        text: "hello",
        angle: 0.4 as any,
      }),
    ]);
    (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
    API.setAppState({
      zoom: { value: 0.73 as NormalizedZoomValue },
      scrollX: 3.3,
      scrollY: -7.77,
    });
    // a rotated blit is resampled regardless; at these coordinates its
    // unsnapped offset is not a whole pixel
    const [blit] = await waitFor(() => {
      const blits = getBlits();
      expect(blits.length).toBeGreaterThan(0);
      return blits;
    });
    expect(distanceToWholePixel(blit)).toBeGreaterThan(1e-3);
  });

  it.each([0, Math.PI / 2, 0.4])(
    "places overridden bitmaps within half a device pixel of translated document geometry (%s rad)",
    async (angle) => {
      const ownerWindow = GlobalTestState.canvas.ownerDocument.defaultView!;
      const pixelRatioDescriptor = Object.getOwnPropertyDescriptor(
        ownerWindow,
        "devicePixelRatio",
      )!;
      try {
        for (const devicePixelRatio of [1, 2]) {
          Object.defineProperty(ownerWindow, "devicePixelRatio", {
            configurable: true,
            value: devicePixelRatio,
          });
          for (const zoom of [1, 1.5, 0.73]) {
            const props = {
              type: "rectangle" as const,
              x: 110.37,
              y: 140.61,
              width: 120,
              height: 60,
              angle: angle as any,
            };
            const element = API.createElement(props);
            API.setElements([element]);
            await renderAt(zoom, 3.3, -7.77);
            (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
            act(() =>
              window.h.app.api.setElementRenderOverrides(
                new Map([[element.id, { offset: { x: 13.37, y: -7.61 } }]]),
              ),
            );
            const [overridden] = await waitFor(() => {
              const blits = getBlits();
              expect(blits).toHaveLength(1);
              return blits;
            });
            const [overriddenAt] = getElementOrigins();
            act(() => window.h.app.api.setElementRenderOverrides(null));
            API.setElements([
              API.createElement({
                ...props,
                x: props.x + 13.37,
                y: props.y - 7.61,
              }),
            ]);
            const [translated] = await renderAt(zoom, 3.3, -7.77);
            const [translatedAt] = getElementOrigins();
            // a bitmap keeps the phase it was drawn with, so an offset moves
            // it by whole device pixels, at most half of one from where the
            // translated element's own bitmap is drawn
            expect(
              Math.abs(overriddenAt.x - translatedAt.x),
            ).toBeLessThanOrEqual(0.5 + 1e-6);
            expect(
              Math.abs(overriddenAt.y - translatedAt.y),
            ).toBeLessThanOrEqual(0.5 + 1e-6);
            expect(overridden.scale).toBeCloseTo(translated.scale, 6);
            if (angle !== 0.4) {
              expect(distanceToWholePixel(overridden)).toBeLessThan(1e-6);
            }
          }
        }
      } finally {
        Object.defineProperty(
          ownerWindow,
          "devicePixelRatio",
          pixelRatioDescriptor,
        );
      }
    },
  );

  it("keeps bound-label snapping stable through inherited fractional offsets", async () => {
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: 10,
      y: 10,
      width: 200,
      height: 100,
      boundElements: [{ type: "text", id: "label" }],
    });
    const label = API.createElement({
      type: "text",
      id: "label",
      x: 61,
      y: 30,
      text: "hi",
      fontSize: 20,
      containerId: box.id,
    });
    API.setElements([box, label]);
    await renderAt(0.5, 3.3, -7.77);
    const offsets = new Set<string>();
    for (const translation of [0, 0.3, 0.4, 0.7, 1.4]) {
      (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
      act(() =>
        window.h.app.api.setElementRenderOverrides(
          new Map([[box.id, { offset: { x: translation, y: translation } }]]),
        ),
      );
      const blits = await waitFor(() => {
        const blits = getBlits();
        expect(blits).toHaveLength(2);
        return blits;
      });
      const [labelBlit, boxBlit] = [...blits].sort((p, q) => p.width - q.width);
      offsets.add(`${labelBlit.x - boxBlit.x},${labelBlit.y - boxBlit.y}`);
    }
    expect(offsets.size).toBe(1);
  });
});

/**
 * Where each blitted element's own origin (its x, y) lands on the static
 * canvas, in device pixels: the blit's origin plus where the element was
 * drawn inside its cached bitmap.
 */
const getElementOrigins = () => {
  const context = GlobalTestState.canvas.getContext("2d") as any;
  return (context.__getEvents() as (CanvasEvent & { props: { img: any } })[])
    .filter((event) => event.type === "drawImage")
    .map(({ transform: [a, b, c, d, e, f], props }) => {
      const [, , , , inX, inY] = (
        props.img.getContext("2d").__getEvents() as CanvasEvent[]
      ).find((event) =>
        ["stroke", "fill", "fillText"].includes(event.type),
      )!.transform;
      const x =
        props.dx + (inX - (props.sx ?? 0)) * (props.dWidth / props.sWidth);
      const y =
        props.dy + (inY - (props.sy ?? 0)) * (props.dHeight / props.sHeight);
      return {
        scale: Math.hypot(a, b),
        x: a * x + c * y + e,
        y: b * x + d * y + f,
        width: props.dWidth,
      };
    });
};

describe("element placement after the snap", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
    API.setAppState({ width: 800, height: 600 });
  });

  // The scroll is rounded to whole device pixels and then each bitmap's
  // origin is too: the two roundings must not add up past half a pixel.
  it("lands a shape within half a device pixel of the camera", async () => {
    const dpr = window.devicePixelRatio;
    let worst = 0;
    for (const zoom of [0.73, 1.37, 2.98643]) {
      for (const x of [10.21, 10.37, 10.61, 10.83]) {
        for (const scrollX of [3.3, 3.43, 3.71]) {
          API.setElements([
            API.createElement({
              type: "rectangle",
              x,
              y: 20.61,
              width: 120,
              height: 60,
            }),
          ]);
          (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
          API.setAppState({
            zoom: { value: zoom as NormalizedZoomValue },
            scrollX,
            scrollY: -7.77,
          });
          const [origin] = await waitFor(() => {
            const origins = getElementOrigins().filter(
              (o) => Math.abs(o.scale - zoom) < 1e-9,
            );
            expect(origins.length).toBeGreaterThan(0);
            return origins;
          });
          worst = Math.max(
            worst,
            Math.abs(origin.x - (x + scrollX) * zoom * dpr),
            Math.abs(origin.y - (20.61 - 7.77) * zoom * dpr),
          );
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  // During a zoom gesture the bitmaps drawn at the last zoom are stretched,
  // not snapped: their phase is stretched with them.
  it("keeps a stretched bitmap where the scene puts it during a zoom gesture", async () => {
    const dpr = window.devicePixelRatio;
    API.setElements([
      API.createElement({
        type: "rectangle",
        x: 10.37,
        y: 20.61,
        width: 120,
        height: 60,
      }),
    ]);
    await renderAt(1, 3.3, -7.77);
    (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
    const zoom = 1.37;
    API.setAppState({
      shouldCacheIgnoreZoom: true,
      zoom: { value: zoom as NormalizedZoomValue },
    });
    const [origin] = await waitFor(() => {
      const origins = getElementOrigins();
      expect(origins.length).toBeGreaterThan(0);
      return origins;
    });
    const snapped = snapScrollToDevicePixels(
      { scrollX: 3.3, scrollY: -7.77, zoom: { value: zoom } },
      dpr,
    );
    expect(origin.x).toBeCloseTo((10.37 + snapped.scrollX) * zoom * dpr, 6);
    API.setAppState({ shouldCacheIgnoreZoom: false });
  });

  /** clears the canvas events, runs `change`, and waits for the next
   * render's element origins at `zoom` */
  const originsAfter = async (zoom: number, change: () => void) => {
    (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
    act(change);
    return waitFor(() => {
      const origins = getElementOrigins().filter(
        (o) => Math.abs(o.scale - zoom) < 1e-9,
      );
      expect(origins.length).toBeGreaterThan(0);
      return origins;
    });
  };

  // A move in place (a drag, an arrow nudge) keeps the element's bitmap, and
  // with it the phase of where the element was.
  it("lands a shape moved in place within half a device pixel once nothing is dragged", async () => {
    const dpr = window.devicePixelRatio;
    const zoom = 1.37;
    const element = API.createElement({
      type: "rectangle",
      x: 10.21,
      y: 20.61,
      width: 120,
      height: 60,
    });
    API.setElements([element]);
    await renderAt(zoom, 3.3, -7.77);
    let worst = 0;
    for (const x of [10.37, 10.61, 10.83, 11.02, 11.29, 11.55, 11.9]) {
      const [origin] = await originsAfter(zoom, () =>
        window.h.app.scene.mutateElement(element, { x }),
      );
      worst = Math.max(worst, Math.abs(origin.x - (x + 3.3) * zoom * dpr));
    }
    expect(worst).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("keeps a moved shape's bitmap while the selection is dragged", async () => {
    const element = API.createElement({
      type: "rectangle",
      x: 10.21,
      y: 20.61,
      width: 120,
      height: 60,
    });
    API.setElements([element]);
    await renderAt(1.37, 3.3, -7.77);
    const bitmap = elementWithCanvasCache.get(element);
    API.setAppState({ selectedElementsAreBeingDragged: true });
    await originsAfter(1.37, () =>
      window.h.app.scene.mutateElement(element, { x: 10.6 }),
    );
    expect(elementWithCanvasCache.get(element)).toBe(bitmap);
  });

  // The container's bitmap is redrawn (resized) while its label's is kept
  // (moved in place), so their phases date from different places; then both
  // are dragged.
  it("keeps a label's offset from its container through a drag after only the container was redrawn", async () => {
    const zoom = 0.5;
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: 10,
      y: 10,
      width: 200,
      height: 100,
      boundElements: [{ type: "text", id: "label" }],
    });
    const label = API.createElement({
      type: "text",
      id: "label",
      x: 61,
      y: 30,
      text: "hi",
      fontSize: 20,
      containerId: box.id,
    });
    API.setElements([box, label]);
    await renderAt(zoom, 3.3, -7.77);
    API.setAppState({ selectedElementsAreBeingDragged: true });
    await originsAfter(zoom, () => {
      window.h.app.scene.mutateElement(box, { width: 200.6 });
      window.h.app.scene.mutateElement(label, { x: 61.3 });
    });
    const offsets = new Set<string>();
    for (const step of [0.13, 0.37, 0.61, 0.89, 1.16, 1.42, 1.77]) {
      const origins = await originsAfter(zoom, () => {
        window.h.app.scene.mutateElement(box, { x: 10 + step });
        window.h.app.scene.mutateElement(label, { x: 61.3 + step });
      });
      expect(origins).toHaveLength(2);
      const [labelAt, boxAt] = [...origins].sort((p, q) => p.width - q.width);
      offsets.add(
        `${(labelAt.x - boxAt.x).toFixed(6)},${(labelAt.y - boxAt.y).toFixed(
          6,
        )}`,
      );
    }
    expect([...offsets]).toHaveLength(1);
  });

  // Zoomed far out a bitmap's padding is under two device pixels, too little
  // for the shift by its phase and the pixel its size floors away.
  it("draws a bitmap without a phase where its padding has no room for one", async () => {
    const element = API.createElement({
      type: "rectangle",
      x: 10.37,
      y: 20.61,
      width: 1200,
      height: 600,
    });
    API.setElements([element]);
    await renderAt(0.05, 3.3, -7.77);
    const bitmap = elementWithCanvasCache.get(element)!;
    expect([bitmap.phaseX, bitmap.phaseY]).toEqual([0, 0]);
  });
});

describe("scroll pixel snap", () => {
  it("rounds the scroll to whole device pixels and is identity when it already is", () => {
    const zoom = { value: 1.5 as NormalizedZoomValue };
    const snapped = snapScrollToDevicePixels(
      { scrollX: 3.3, scrollY: -7.77, zoom },
      2,
    );
    // 3.3 × 1.5 × 2 = 9.9 → 10;  -7.77 × 3 = -23.31 → -23
    expect(snapped.scrollX * 3).toBeCloseTo(10, 9);
    expect(snapped.scrollY * 3).toBeCloseTo(-23, 9);

    const whole = { scrollX: 4, scrollY: -6, zoom };
    expect(snapScrollToDevicePixels(whole, 2)).toBe(whole);
  });

  it("blits a shape at integer coordinates on whole device pixels at any fractional scroll", async () => {
    await render(<Excalidraw />);
    API.setAppState({ width: 800, height: 600 });
    API.setElements([
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 200,
        width: 200,
        height: 100,
      }),
    ]);
    // zooms at which the element canvas's padding is itself whole device
    // pixels, so the only fractional term left is the scroll
    for (const zoom of [1, 1.5]) {
      const [atFirst] = await renderAt(zoom, 3.3, -7.77);
      expect(distanceToWholePixel(atFirst)).toBeLessThan(1e-6);
      // a tenth of a device pixel further lands on the same pixels
      const [atSecond] = await renderAt(zoom, 3.3 + 0.1 / zoom, -7.77);
      expect(atSecond).toEqual(atFirst);
    }
  });
});

describe("grid pixel snap", () => {
  /** the static canvas's path starts, in device pixels */
  const getPathStarts = () => {
    const context = GlobalTestState.canvas.getContext("2d") as any;
    return (context.__getEvents() as CanvasEvent[])
      .filter((event) => event.type === "moveTo")
      .map(({ transform: [a, , , d, e, f], props }) => ({
        scale: a,
        x: a * (props as any).x + e,
        y: d * (props as any).y + f,
      }));
  };
  const fraction = (value: number) => value - Math.floor(value);

  it("centers one-pixel grid lines on device pixels at any zoom", async () => {
    await render(<Excalidraw css=":scope { --canvas-grid-color: #ccc; }" />);
    API.setAppState({ width: 800, height: 600 });
    // zooms at which a grid line is at least a device pixel wide — 1.9
    // included, where `(1 / zoom) × zoom` evaluates just under 1
    for (const zoom of [1, 1.5, 1.9, 2.2]) {
      (GlobalTestState.canvas.getContext("2d") as any).__clearEvents();
      API.setAppState({
        zoom: { value: zoom as NormalizedZoomValue },
        scrollX: 3.3,
        scrollY: -7.77,
      });
      const lines = await waitFor(() => {
        const starts = getPathStarts().filter(
          (start) => Math.abs(start.scale - zoom) < 1e-9,
        );
        expect(starts.length).toBeGreaterThan(0);
        return starts;
      });
      for (const line of lines) {
        // a vertical line has its x on the half pixel, a horizontal its y
        const onHalfPixel =
          Math.abs(fraction(line.x) - 0.5) < 1e-6 ||
          Math.abs(fraction(line.y) - 0.5) < 1e-6;
        expect(onHalfPixel).toBe(true);
      }
    }
  });
});
