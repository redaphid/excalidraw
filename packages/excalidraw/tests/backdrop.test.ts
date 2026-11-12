import {
  MAX_RASTER_BYTES,
  MAX_RASTER_EDGE,
  strokeBackdrop,
} from "../renderer/backdrop";

const appState = (zoom: number) => ({
  scrollX: 0,
  scrollY: 0,
  zoom: { value: zoom as any },
  gridSize: 20,
  gridStep: 5,
});

describe("the backdrop raster", () => {
  let rasters: HTMLCanvasElement[];
  let context: CanvasRenderingContext2D;
  let transforms: DOMMatrix[];

  beforeEach(() => {
    context = document.createElement("canvas").getContext("2d")!;
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      100,
    );
    rasters = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        const element = createElement(tag, options);
        if (tag === "canvas") {
          rasters.push(element as HTMLCanvasElement);
        }
        return element;
      },
    );
    transforms = [];
    vi.spyOn(CanvasPattern.prototype, "setTransform").mockImplementation(
      (matrix) => {
        transforms.push(matrix as DOMMatrix);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const liveBytes = () =>
    rasters.reduce((sum, { width, height }) => sum + width * height * 4, 0);

  it("is clamped for a huge tile, and the pattern scales it up", () => {
    const backdrop = { image: "data:image/svg+xml,huge", size: 3000 };

    // 3000 scene units at zoom 1 on a 2x display: 6000 device pixels
    strokeBackdrop(context, backdrop, appState(1), 2);

    expect(rasters.map(({ width, height }) => Math.max(width, height))).toEqual(
      [MAX_RASTER_EDGE],
    );
    expect(transforms[0].a * MAX_RASTER_EDGE).toBeCloseTo(6000);
  });

  it("caches rasters within a byte budget over a long zoom", () => {
    // tiles of 800 to 4000 device pixels: many sizes, most near the clamp
    const backdrop = { image: "data:image/svg+xml,zoom", size: 400 };

    for (let zoom = 0.1; zoom < 30; zoom *= 1.05) {
      strokeBackdrop(context, backdrop, appState(zoom), 2);
      expect(liveBytes()).toBeLessThanOrEqual(MAX_RASTER_BYTES);
    }
    expect(rasters.length).toBeGreaterThan(20);
  });

  it("keeps the rasters of only the few most recent images", () => {
    for (let i = 0; i < 40; i++) {
      strokeBackdrop(
        context,
        { image: `data:image/svg+xml,theme-${i}`, size: 500 },
        appState(1),
        1,
      );
    }

    expect(rasters.filter(({ width }) => width > 0).length).toBe(4);
    expect(rasters.at(-1)!.width).toBe(500);
  });
});
