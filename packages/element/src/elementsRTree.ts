import { PackedRTree } from "@excalidraw/common";

import { getElementMutationCount } from "./mutateElement";

import type { Bounds } from "@excalidraw/common";

import type { ElementsMap, ExcalidrawElement } from "./types";

/**
 * An element's box for an `ElementsRTree`, and the one other element the box
 * follows without the element's version changing, if any (a bound text's
 * container, an arrow's label).
 */
export type ElementBox = {
  bounds: Bounds;
  dependency: ExcalidrawElement | null;
};

/**
 * Finds the elements of an array whose box touches a rect, from an R-tree
 * built per array and elements map, so a query visits only the elements near
 * the rect rather than all of them.
 *
 * An element mutated in place after the build, or whose dependency was, leaves
 * the tree for a list that is measured again on every query, until the next
 * array or map rebuilds the tree.
 */
export class ElementsRTree<T extends ExcalidrawElement> {
  private elements: readonly T[] | null = null;
  private elementsMap: ElementsMap | null = null;
  private versions: number[] = [];
  private dependencies: (ExcalidrawElement | null)[] = [];
  private dependencyVersions: number[] = [];
  private inTree = new Uint8Array(0);
  private tree = new PackedRTree(new Float64Array(0), []);
  /** positions measured on every query instead of in the tree */
  private loose: number[] = [];
  private hits = new Uint32Array(0);
  private mutationCount = -1;

  constructor(
    private readonly measure: (
      element: T,
      elementsMap: ElementsMap,
    ) => ElementBox,
  ) {}

  private build(elements: readonly T[], elementsMap: ElementsMap) {
    this.elements = elements;
    this.elementsMap = elementsMap;
    this.mutationCount = getElementMutationCount();
    const count = elements.length;
    this.versions = new Array(count);
    this.dependencies = new Array(count);
    this.dependencyVersions = new Array(count);
    this.inTree = new Uint8Array(count);
    this.hits = new Uint32Array(count);
    this.loose = [];
    const boxes = new Float64Array(count * 4);
    const items: number[] = [];
    for (let i = 0; i < count; i++) {
      const element = elements[i];
      const {
        bounds: [x1, y1, x2, y2],
        dependency,
      } = this.measure(element, elementsMap);
      this.versions[i] = element.version;
      this.dependencies[i] = dependency;
      this.dependencyVersions[i] = dependency?.version ?? 0;
      if (
        Number.isFinite(x1) &&
        Number.isFinite(y1) &&
        Number.isFinite(x2) &&
        Number.isFinite(y2)
      ) {
        boxes[i * 4] = x1;
        boxes[i * 4 + 1] = y1;
        boxes[i * 4 + 2] = x2;
        boxes[i * 4 + 3] = y2;
        this.inTree[i] = 1;
        items.push(i);
      } else {
        this.loose.push(i);
      }
    }
    this.tree = new PackedRTree(boxes, items);
  }

  private sync(elements: readonly T[], elementsMap: ElementsMap) {
    if (elements !== this.elements || elementsMap !== this.elementsMap) {
      this.build(elements, elementsMap);
      return;
    }
    const mutationCount = getElementMutationCount();
    if (mutationCount === this.mutationCount) {
      return;
    }
    this.mutationCount = mutationCount;
    for (let i = 0; i < elements.length; i++) {
      if (
        this.inTree[i] &&
        (elements[i].version !== this.versions[i] ||
          (this.dependencies[i]?.version ?? 0) !== this.dependencyVersions[i])
      ) {
        this.inTree[i] = 0;
        this.loose.push(i);
      }
    }
  }

  /**
   * The positions in `elements`, ascending, of the elements whose box touches
   * the rect, borders included. The result is reused by the next query.
   */
  query(
    elements: readonly T[],
    elementsMap: ElementsMap,
    [minX, minY, maxX, maxY]: Bounds,
  ): Uint32Array {
    this.sync(elements, elementsMap);
    const hits = this.hits;
    let count = 0;
    this.tree.search(minX, minY, maxX, maxY, (item) => {
      if (this.inTree[item]) {
        hits[count++] = item;
      }
    });
    for (const item of this.loose) {
      const [x1, y1, x2, y2] = this.measure(elements[item], elementsMap).bounds;
      if (minX <= x2 && minY <= y2 && maxX >= x1 && maxY >= y1) {
        hits[count++] = item;
      }
    }
    return hits.subarray(0, count).sort();
  }
}
