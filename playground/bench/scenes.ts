import {
  newArrowElement,
  newElement,
  newFrameElement,
  newFreeDrawElement,
  newImageElement,
  newLinearElement,
  newTextElement,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  FileId,
  FillStyle,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  DataURL,
} from "@excalidraw/excalidraw/types";

export type SceneName = "mixed" | "freedraw" | "deep";

export type BenchScene = {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
  view: Pick<AppState, "scrollX" | "scrollY" | "zoom">;
};

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = ReturnType<typeof mulberry32>;

const between = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);
const pick = <T>(rng: Rng, items: readonly T[]) =>
  items[Math.floor(rng() * items.length)];

const STROKES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
const FILLS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];
const FILL_STYLES: FillStyle[] = ["solid", "hachure", "cross-hatch"];
const WORDS =
  "the quick brown fox jumps over a lazy dog while sporefall drawings zoom".split(
    " ",
  );

const deterministicIds = (prefix: string) => {
  let n = 0;
  return () => {
    n += 1;
    return { id: `${prefix}${n}`, seed: n, versionNonce: n };
  };
};

const style = (rng: Rng, scale: number) => ({
  strokeColor: pick(rng, STROKES),
  backgroundColor: pick(rng, FILLS),
  fillStyle: pick(rng, FILL_STYLES),
  strokeWidth: pick(rng, [1, 2, 4]) * scale,
  roughness: pick(rng, [0, 1, 2]),
  strokeStyle: rng() < 0.2 ? ("dashed" as const) : ("solid" as const),
});

const scribble = (rng: Rng, length: number, size: number) => {
  const points: LocalPoint[] = [];
  let x = 0;
  let y = 0;
  let heading = between(rng, 0, Math.PI * 2);
  for (let i = 0; i < length; i++) {
    heading += between(rng, -0.6, 0.6);
    x += Math.cos(heading) * size;
    y += Math.sin(heading) * size;
    points.push(pointFrom<LocalPoint>(x, y));
  }
  return points;
};

const handwriting = (rng: Rng, length: number, size: number) => {
  const points: LocalPoint[] = [];
  const loops = between(rng, 2, 6);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    points.push(
      pointFrom<LocalPoint>(
        t * size * loops + Math.sin(t * loops * Math.PI * 2) * size * 0.3,
        Math.cos(t * loops * Math.PI * 2) * size * 0.5 +
          between(rng, -0.05, 0.05) * size,
      ),
    );
  }
  return points;
};

const extent = (points: readonly LocalPoint[]) => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

const shapeAt = (
  rng: Rng,
  next: ReturnType<typeof deterministicIds>,
  kind: string,
  x: number,
  y: number,
  scale: number,
  fileIds: readonly FileId[],
  frameId: string | null,
): ExcalidrawElement => {
  const base = {
    x,
    y,
    frameId,
    ...style(rng, scale),
  };
  const width = between(rng, 40, 320) * scale;
  const height = between(rng, 40, 240) * scale;
  const ids = next();
  switch (kind) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      return {
        ...newElement({
          type: kind,
          ...base,
          width,
          height,
          roundness: rng() < 0.5 ? { type: 3 } : null,
        }),
        ...ids,
      };
    case "arrow":
    case "line": {
      const points = [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(width * 0.5, between(rng, -1, 1) * height),
        pointFrom<LocalPoint>(width, between(rng, -1, 1) * height),
      ];
      const element =
        kind === "arrow"
          ? newArrowElement({
              type: "arrow",
              ...base,
              backgroundColor: "transparent",
              points,
              endArrowhead: "arrow",
            })
          : newLinearElement({
              type: "line",
              ...base,
              backgroundColor: "transparent",
              points,
            });
      return { ...element, ...extent(points), ...ids };
    }
    case "text":
      return {
        ...newTextElement({
          ...base,
          backgroundColor: "transparent",
          text: Array.from({ length: 1 + Math.floor(rng() * 3) }, () =>
            Array.from({ length: 3 + Math.floor(rng() * 4) }, () =>
              pick(rng, WORDS),
            ).join(" "),
          ).join("\n"),
          fontSize: pick(rng, [16, 20, 28, 36]) * scale,
        }),
        ...ids,
      };
    case "freedraw": {
      const points = scribble(
        rng,
        20 + Math.floor(rng() * 60),
        between(rng, 3, 8) * scale,
      );
      return {
        ...newFreeDrawElement({
          type: "freedraw",
          ...base,
          backgroundColor: "transparent",
          strokeWidth: pick(rng, [0.5, 1, 2]) * scale,
          points,
          simulatePressure: true,
        }),
        ...extent(points),
        ...ids,
      };
    }
    case "image":
      return {
        ...newImageElement({
          type: "image",
          ...base,
          width,
          height: width * 0.75,
          fileId: pick(rng, fileIds),
          status: "saved",
        }),
        ...ids,
      };
    default:
      throw new Error(`unknown kind ${kind}`);
  }
};

const MIXED_ELEMENTS = 2000;

const MIXED_KINDS = [
  ...Array<string>(22).fill("rectangle"),
  ...Array<string>(12).fill("ellipse"),
  ...Array<string>(8).fill("diamond"),
  ...Array<string>(15).fill("arrow"),
  ...Array<string>(5).fill("line"),
  ...Array<string>(18).fill("text"),
  ...Array<string>(17).fill("freedraw"),
  ...Array<string>(3).fill("image"),
];

const LATE_IMAGE_ID = "bench-late-image" as FileId;

/** the file of an image on the mixed board that arrives after it mounts */
export const lateImage = () => ({
  ...makeImages(5)["bench-image-4" as FileId],
  id: LATE_IMAGE_ID,
});

const makeImages = (count: number): BinaryFiles => {
  const files: BinaryFiles = {};
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 400, 300);
    gradient.addColorStop(0, STROKES[i % STROKES.length]);
    gradient.addColorStop(1, FILLS[(i + 1) % FILLS.length]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 300);
    for (let c = 0; c < 12; c++) {
      ctx.fillStyle = FILLS[(i + c) % FILLS.length];
      ctx.beginPath();
      ctx.arc(30 + c * 30, 150 + Math.sin(c + i) * 90, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    const id = `bench-image-${i}` as FileId;
    files[id] = {
      id,
      mimeType: "image/png",
      dataURL: canvas.toDataURL("image/png") as DataURL,
      created: 0,
    };
  }
  return files;
};

const mixed = (): BenchScene => {
  const rng = mulberry32(1);
  const next = deterministicIds("m");
  const files = makeImages(4);
  const fileIds = Object.keys(files) as FileId[];
  const frames = Array.from({ length: 12 }, (_, i) => ({
    ...newFrameElement({
      x: (i % 4) * 2200,
      y: Math.floor(i / 4) * 2000,
      width: 1800,
      height: 1600,
      name: `Frame ${i + 1}`,
    }),
    ...next(),
  }));
  const elements: ExcalidrawElement[] = [];
  for (let i = 0; i < MIXED_ELEMENTS - frames.length; i++) {
    const x = between(rng, 0, 8800);
    const y = between(rng, 0, 5800);
    const frame = frames.find(
      (f) =>
        x > f.x &&
        y > f.y &&
        x < f.x + f.width - 320 &&
        y < f.y + f.height - 240,
    );
    elements.push(
      shapeAt(
        rng,
        next,
        pick(rng, MIXED_KINDS),
        x,
        y,
        1,
        fileIds,
        frame?.id ?? null,
      ),
    );
  }
  elements.push({
    ...newImageElement({
      type: "image",
      x: 900,
      y: 1000,
      width: 360,
      height: 270,
      frameId: frames[0].id,
      fileId: LATE_IMAGE_ID,
      status: "saved",
    }),
    ...next(),
  });
  return {
    elements: [...elements, ...frames],
    files,
    view: { scrollX: -200, scrollY: -200, zoom: { value: 0.5 as never } },
  };
};

const freedraw = (): BenchScene => {
  const rng = mulberry32(2);
  const next = deterministicIds("f");
  const elements: ExcalidrawElement[] = [];
  for (let i = 0; i < 1500; i++) {
    const row = Math.floor(i / 30);
    const points = handwriting(
      rng,
      30 + Math.floor(rng() * 120),
      between(rng, 20, 40),
    );
    elements.push({
      ...newFreeDrawElement({
        type: "freedraw",
        x: (i % 30) * 170 + between(rng, -10, 10),
        y: row * 70 + between(rng, -6, 6),
        strokeColor: pick(rng, STROKES),
        strokeWidth: pick(rng, [0.5, 1, 2]),
        points,
        simulatePressure: true,
      }),
      ...extent(points),
      ...next(),
    });
  }
  return {
    elements,
    files: {},
    view: { scrollX: -100, scrollY: -100, zoom: { value: 0.5 as never } },
  };
};

export const DEEP_CENTER = { x: 500, y: 500 };
const DEEP_LEVELS = 7;

const deep = (): BenchScene => {
  const rng = mulberry32(3);
  const next = deterministicIds("d");
  const files = makeImages(2);
  const fileIds = Object.keys(files) as FileId[];
  const elements: ExcalidrawElement[] = [];
  for (let i = 0; i < 300; i++) {
    elements.push(
      shapeAt(
        rng,
        next,
        pick(rng, MIXED_KINDS),
        between(rng, -3000, 4000),
        between(rng, -3000, 4000),
        1,
        fileIds,
        null,
      ),
    );
  }
  for (let level = 0; level < DEEP_LEVELS; level++) {
    const scale = 10 ** -level;
    const size = 1000 * scale;
    elements.push({
      ...newElement({
        type: "rectangle",
        x: DEEP_CENTER.x - size / 2,
        y: DEEP_CENTER.y - size / 2,
        width: size,
        height: size,
        strokeWidth: 2 * scale,
        roughness: 0,
      }),
      ...next(),
    });
    for (let i = 0; i < 40; i++) {
      const kind = pick(rng, ["rectangle", "ellipse", "freedraw", "text"]);
      const angle = between(rng, 0, Math.PI * 2);
      const radius = between(rng, 0.12, 0.42) * size;
      elements.push(
        shapeAt(
          rng,
          next,
          kind,
          DEEP_CENTER.x + Math.cos(angle) * radius,
          DEEP_CENTER.y + Math.sin(angle) * radius,
          scale * 0.4,
          fileIds,
          null,
        ),
      );
    }
  }
  return {
    elements,
    files,
    view: { scrollX: 0, scrollY: 0, zoom: { value: 1 as never } },
  };
};

export const SCENES: Record<SceneName, () => BenchScene> = {
  mixed,
  freedraw,
  deep,
};
