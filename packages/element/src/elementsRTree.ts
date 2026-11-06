import { PackedRTree, type Bounds } from "@excalidraw/common";

import { getElementMutationCount } from "./mutateElement";

import type { ElementsMap, ExcalidrawElement } from "./types";

/** how long the index waits for edits to settle before rebuilding while only
 * a few elements are outside it */
const REBUILD_QUIET_MS = 1000;
/** time one idle slice of a rebuild may take */
const REBUILD_SLICE_MS = 8;
/** elements measured between checks of the slice's time */
const REBUILD_CHECK_EVERY = 64;

const touches = (
  [x1, y1, x2, y2]: Bounds,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) => minX <= x2 && minY <= y2 && maxX >= x1 && maxY >= y1;

const isFiniteBounds = ([x1, y1, x2, y2]: Bounds) =>
  Number.isFinite(x1) &&
  Number.isFinite(y1) &&
  Number.isFinite(x2) &&
  Number.isFinite(y2);

type RebuildJob<T> = {
  elements: readonly T[];
  elementsMap: ElementsMap;
  mutationCount: number;
  boxes: Float64Array;
  versions: number[];
  dependencies: (ExcalidrawElement | null)[];
  dependencyVersions: number[];
  inTree: Uint8Array;
  next: number;
};

/**
 * Finds the elements of an array whose box touches a rect, in array order,
 * from an R-tree of the elements as they were at its last build, so a query
 * visits only the elements near the rect rather than all of them.
 *
 * Indexed elements are kept by id, object and version, so a new array or an
 * in-place edit costs one pass over the array that measures only the elements
 * the tree no longer describes: new ones, changed ones, or ones whose
 * dependency (a bound text's container) changed. Those are measured on every
 * query until the tree is rebuilt, which happens only in idle time; deleted
 * elements are dropped then too.
 */
export class ElementsRTree<T extends ExcalidrawElement> {
  private tree = new PackedRTree(new Float64Array(0), []);
  /** per slot, the element and the state the tree's box was measured from */
  private slotOf = new Map<string, number>();
  private slotElements: readonly T[] = [];
  private slotVersions: number[] = [];
  private slotDependencies: (ExcalidrawElement | null)[] = [];
  private slotDependencyVersions: number[] = [];
  private slotInTree: Uint8Array = new Uint8Array(0);
  /** per slot, its element's position in the synced array, valid where
   * `slotSyncedAt` equals `syncGeneration` */
  private slotPositions = new Uint32Array(0);
  private slotSyncedAt = new Uint32Array(0);
  private slotHitAt = new Uint32Array(0);
  private hitSlots = new Uint32Array(0);

  /** the array, map and mutation count the slot positions describe */
  private elements: readonly T[] | null = null;
  private elementsMap: ElementsMap | null = null;
  private mutationCount = -1;
  private syncGeneration = 0;
  private queryStamp = 0;
  /** positions of synced elements that the tree has no valid box for */
  private unindexed: number[] = [];
  private positions = new Uint32Array(0);

  private rebuildJob: RebuildJob<T> | null = null;
  private cancelScheduledRebuild: (() => void) | null = null;
  private waitingForQuiet = false;

  constructor(
    private readonly measure: (element: T, elementsMap: ElementsMap) => Bounds,
    /** the element, if any, whose changes move this element's box without
     * bumping its version */
    private readonly dependencyOf: (
      element: T,
      elementsMap: ElementsMap,
    ) => ExcalidrawElement | null,
  ) {}

  /**
   * The elements of `elements` whose box touches the rect, borders included,
   * plus the one with `alwaysIncludedId` wherever it is, in array order.
   */
  query(
    elements: readonly T[],
    elementsMap: ElementsMap,
    [minX, minY, maxX, maxY]: Bounds,
    alwaysIncludedId: string | null,
  ): T[] {
    const stamp = ++this.queryStamp;
    let hitCount = 0;
    this.tree.search(minX, minY, maxX, maxY, (slot) => {
      this.slotHitAt[slot] = stamp;
      this.hitSlots[hitCount++] = slot;
    });

    if (
      elements !== this.elements ||
      elementsMap !== this.elementsMap ||
      getElementMutationCount() !== this.mutationCount
    ) {
      return this.sync(
        elements,
        elementsMap,
        stamp,
        [minX, minY, maxX, maxY],
        alwaysIncludedId,
      );
    }

    const positions = this.positions;
    let count = 0;
    let alwaysIncludedFound = false;
    for (let k = 0; k < hitCount; k++) {
      const slot = this.hitSlots[k];
      if (this.slotSyncedAt[slot] === this.syncGeneration) {
        positions[count++] = this.slotPositions[slot];
      }
    }
    for (const position of this.unindexed) {
      const element = elements[position];
      if (
        element.id === alwaysIncludedId ||
        touches(this.measure(element, elementsMap), minX, minY, maxX, maxY)
      ) {
        positions[count++] = position;
        alwaysIncludedFound ||= element.id === alwaysIncludedId;
      }
    }
    if (alwaysIncludedId !== null && !alwaysIncludedFound) {
      const slot = this.slotOf.get(alwaysIncludedId);
      if (
        slot !== undefined &&
        this.slotSyncedAt[slot] === this.syncGeneration &&
        this.slotInTree[slot] &&
        this.slotHitAt[slot] !== stamp
      ) {
        positions[count++] = this.slotPositions[slot];
      }
    }

    const result: T[] = new Array(count);
    const sorted = positions.subarray(0, count).sort();
    for (let k = 0; k < count; k++) {
      result[k] = elements[sorted[k]];
    }
    return result;
  }

  /**
   * Matches every element of a new array, or of one edited in place, to its
   * slot, and answers the query in the same pass.
   */
  private sync(
    elements: readonly T[],
    elementsMap: ElementsMap,
    stamp: number,
    [minX, minY, maxX, maxY]: Bounds,
    alwaysIncludedId: string | null,
  ): T[] {
    this.elements = elements;
    this.elementsMap = elementsMap;
    this.mutationCount = getElementMutationCount();
    const generation = ++this.syncGeneration;
    if (this.positions.length < elements.length) {
      this.positions = new Uint32Array(elements.length);
    }
    this.unindexed = [];
    let indexed = 0;
    let changed = 0;
    const result: T[] = [];
    for (let position = 0; position < elements.length; position++) {
      const element = elements[position];
      const slot = this.slotOf.get(element.id);
      if (slot !== undefined && this.isCurrent(slot, element, elementsMap)) {
        this.slotPositions[slot] = position;
        this.slotSyncedAt[slot] = generation;
        indexed++;
        if (this.slotInTree[slot]) {
          if (
            this.slotHitAt[slot] === stamp ||
            element.id === alwaysIncludedId
          ) {
            result.push(element);
          }
          continue;
        }
      } else {
        changed++;
      }
      this.unindexed.push(position);
      if (
        element.id === alwaysIncludedId ||
        touches(this.measure(element, elementsMap), minX, minY, maxX, maxY)
      ) {
        result.push(element);
      }
    }
    if (changed || indexed < this.slotElements.length) {
      this.scheduleRebuild(changed + this.slotElements.length - indexed);
    }
    return result;
  }

  private isCurrent(slot: number, element: T, elementsMap: ElementsMap) {
    if (
      this.slotElements[slot] !== element ||
      this.slotVersions[slot] !== element.version
    ) {
      return false;
    }
    const dependency = this.slotDependencies[slot];
    const current = this.dependencyOf(element, elementsMap);
    return (
      current === dependency &&
      (current?.version ?? 0) === this.slotDependencyVersions[slot]
    );
  }

  private scheduleRebuild(stale: number) {
    if (this.cancelScheduledRebuild && !this.waitingForQuiet) {
      return;
    }
    // edits that keep coming push the rebuild back, until so many elements
    // are outside the tree that measuring them on every query costs more
    // than the idle-time rebuild that would index them
    this.cancelScheduledRebuild?.();
    const threshold = 64 + (this.elements?.length ?? 0) / 64;
    this.schedule(stale > threshold ? 0 : REBUILD_QUIET_MS);
  }

  private schedule(delay: number) {
    this.waitingForQuiet = delay > 0;
    if (delay > 0) {
      const timer = setTimeout(() => this.schedule(0), delay);
      this.cancelScheduledRebuild = () => clearTimeout(timer);
    } else if (typeof requestIdleCallback === "function") {
      const idle = requestIdleCallback((deadline) => {
        const until = performance.now() + REBUILD_SLICE_MS;
        this.rebuild(
          () => deadline.timeRemaining() > 1 && performance.now() < until,
        );
      });
      this.cancelScheduledRebuild = () => cancelIdleCallback(idle);
    } else {
      const timer = setTimeout(() => {
        const until = performance.now() + REBUILD_SLICE_MS;
        this.rebuild(() => performance.now() < until);
      });
      this.cancelScheduledRebuild = () => clearTimeout(timer);
    }
  }

  /**
   * Measures the synced elements a slice at a time while `hasTime`, then packs
   * them into a new tree. Elements edited after they were measured fail the
   * next sync's version check like any other edit.
   */
  rebuild(hasTime: () => boolean = () => true) {
    this.cancelScheduledRebuild?.();
    this.cancelScheduledRebuild = null;
    if (!this.rebuildJob) {
      const { elements, elementsMap } = this;
      if (!elements || !elementsMap) {
        return;
      }
      const count = elements.length;
      this.rebuildJob = {
        elements,
        elementsMap,
        mutationCount: getElementMutationCount(),
        boxes: new Float64Array(count * 4),
        versions: new Array(count),
        dependencies: new Array(count),
        dependencyVersions: new Array(count),
        inTree: new Uint8Array(count),
        next: 0,
      };
    }
    const job = this.rebuildJob;
    for (let measured = 1; job.next < job.elements.length; measured++) {
      if (measured % REBUILD_CHECK_EVERY === 0 && !hasTime()) {
        this.schedule(0);
        return;
      }
      const slot = job.next++;
      const element = job.elements[slot];
      const bounds = this.measure(element, job.elementsMap);
      const dependency = this.dependencyOf(element, job.elementsMap);
      job.versions[slot] = element.version;
      job.dependencies[slot] = dependency;
      job.dependencyVersions[slot] = dependency?.version ?? 0;
      if (isFiniteBounds(bounds)) {
        job.boxes.set(bounds, slot * 4);
        job.inTree[slot] = 1;
      }
    }
    this.rebuildJob = null;
    this.install(job);
  }

  private install(job: RebuildJob<T>) {
    const count = job.elements.length;
    const items: number[] = [];
    this.slotOf = new Map();
    for (let slot = 0; slot < count; slot++) {
      this.slotOf.set(job.elements[slot].id, slot);
      if (job.inTree[slot]) {
        items.push(slot);
      }
    }
    this.tree = new PackedRTree(job.boxes, items);
    this.slotElements = job.elements;
    this.slotVersions = job.versions;
    this.slotDependencies = job.dependencies;
    this.slotDependencyVersions = job.dependencyVersions;
    this.slotInTree = job.inTree;
    this.slotPositions = new Uint32Array(count);
    this.slotSyncedAt = new Uint32Array(count);
    this.slotHitAt = new Uint32Array(count);
    this.hitSlots = new Uint32Array(count);
    this.queryStamp = 0;

    if (
      job.elements !== this.elements ||
      job.elementsMap !== this.elementsMap ||
      job.mutationCount !== getElementMutationCount()
    ) {
      // the next query matches the current array to the new slots
      this.elements = null;
      return;
    }
    // built from the synced array as it still is: a slot is its position
    const generation = ++this.syncGeneration;
    this.unindexed = [];
    for (let slot = 0; slot < count; slot++) {
      this.slotPositions[slot] = slot;
      this.slotSyncedAt[slot] = generation;
      if (!job.inTree[slot]) {
        this.unindexed.push(slot);
      }
    }
  }

  destroy() {
    this.cancelScheduledRebuild?.();
    this.cancelScheduledRebuild = null;
    this.rebuildJob = null;
  }
}
