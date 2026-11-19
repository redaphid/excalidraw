import { RoughGenerator } from "roughjs/bin/generator";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { ShapeCache, generateRoughOptions } from "../src";

import type { ExcalidrawElement } from "../src/types";
import type { Drawable } from "roughjs/bin/core";

const pathsDrawn = vi.hoisted(() => [] as string[]);

// records each path rough.js strokes, to draw it again through `path()`
vi.mock("roughjs/bin/renderer", async (importOriginal) => {
  const renderer = await importOriginal<
    typeof import("roughjs/bin/renderer")
  >();
  return {
    ...renderer,
    svgPath: (...args: Parameters<typeof renderer.svgPath>) => {
      pathsDrawn.push(args[0]);
      return renderer.svgPath(...args);
    },
  };
});

const roundedShapes = (backgroundColor: string) =>
  (["rectangle", "diamond"] as const).flatMap((type) =>
    (["solid", "dashed", "dotted"] as const).flatMap((strokeStyle) =>
      [0, 1, 2].flatMap((roughness) =>
        [1, 4].map((strokeWidth) =>
          API.createElement({
            type,
            width: 180,
            height: 70,
            roundness: { type: 3 },
            strokeStyle,
            roughness,
            strokeWidth,
            backgroundColor,
          }),
        ),
      ),
    ),
  );

const generate = (element: ExcalidrawElement) => {
  ShapeCache.delete(element);
  pathsDrawn.length = 0;
  const shape = ShapeCache.generateElementShape(
    element as Parameters<typeof ShapeCache.generateElementShape>[0],
    null,
  ) as Drawable;
  return { shape, path: pathsDrawn[0] };
};

describe("a rounded shape with no fill", () => {
  it("is the shape rough.js's path() draws", () => {
    for (const element of roundedShapes("transparent")) {
      const { shape, path } = generate(element);
      const options = generateRoughOptions(element, true);
      const expected = new RoughGenerator().path(path, options);
      expect(shape.sets).toEqual(expected.sets);
      expect({ ...shape.options, randomizer: undefined }).toEqual({
        ...expected.options,
        randomizer: undefined,
      });
    }
  });

  it("does not flatten its path for a fill it does not have", () => {
    const path = vi.spyOn(RoughGenerator.prototype, "path");
    const unfilled = roundedShapes("transparent");
    unfilled.forEach(generate);
    expect(path).not.toHaveBeenCalled();

    const filled = roundedShapes("#a5d8ff");
    filled.forEach(generate);
    expect(path).toHaveBeenCalledTimes(filled.length);
  });
});
