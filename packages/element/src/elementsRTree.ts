import {
  PackedRTree,
  PACKED_RTREE_BUILD_CHUNK,
  type Bounds,
} from "@excalidraw/common";

import { getElementMutationCount } from "./mutateElement";

import type { ElementsMap, ExcalidrawElement } from "./types";

const REBUILD_QUIET_MS = 1000;
const REBUILD_SLICE_MS = 8;
const MEASURE_CHUNK = 512;
const CHUNKS_PER_TASK = 4;
const REBUILD_MIN_STALE = 32;

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

type Index<T> = {
  tree: PackedRTree;
  slotOf: Map<string, number>;
  slotElements: readonly T[];
  slotVersions: number[];
  slotDependencies: (ExcalidrawElement | null)[];
  slotDependencyVersions: number[];
  slotInTree: Uint8Array;
  slotPositions: Uint32Array;
  slotSyncedAt: Uint32Array;
  slotHitAt: Uint32Array;
  hitSlots: Uint32Array;
};

export type ElementsRTreeRebuildWork = {
  measured: number;
  comparisons: number;
  writes: number;
};

type RebuildJob<T> = {
  elements: readonly T[];
  elementsMap: ElementsMap;
  mutationCount: number;
  syncGenerationAtStart: number;
  generation: number;
  work: ElementsRTreeRebuildWork;
  steps: Generator<void, Index<T>, void>;
  slotsWithoutBox: number[];
};

const emptyIndex = <T>(): Index<T> => ({
  tree: PackedRTree.empty(),
  slotOf: new Map(),
  slotElements: [],
  slotVersions: [],
  slotDependencies: [],
  slotDependencyVersions: [],
  slotInTree: new Uint8Array(0),
  slotPositions: new Uint32Array(0),
  slotSyncedAt: new Uint32Array(0),
  slotHitAt: new Uint32Array(0),
  hitSlots: new Uint32Array(0),
});

export class ElementsRTree<T extends ExcalidrawElement> {
  private index: Index<T> = emptyIndex();

  private elements: readonly T[] | null = null;
  private elementsMap: ElementsMap | null = null;
  private mutationCount = -1;
  private generations = 0;
  private syncGeneration = 0;
  private queryStamp = 0;
  private unindexed: number[] = [];
  private stale = 0;
  private positions = new Uint32Array(0);
  private lastQuerySize: [number, number] = [NaN, NaN];

  private rebuildJob: RebuildJob<T> | null = null;
  private quietTimer: number | null = null;
  private cancelIdleTask: (() => void) | null = null;

  constructor(
    private readonly measure: (element: T, elementsMap: ElementsMap) => Bounds,
    /** the element, if any, whose changes move this element's box without
     * bumping its version */
    private readonly dependencyOf: (
      element: T,
      elementsMap: ElementsMap,
    ) => ExcalidrawElement | null,
    private readonly getOwnerWindow: () => Window = () =>
      globalThis as unknown as Window,
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
    const [width, height] = this.lastQuerySize;
    this.lastQuerySize = [maxX - minX, maxY - minY];
    const zoomed =
      Math.abs(maxX - minX - width) > 1e-9 * Math.abs(width) ||
      Math.abs(maxY - minY - height) > 1e-9 * Math.abs(height);

    const index = this.index;
    const stamp = ++this.queryStamp;
    let hitCount = 0;
    index.tree.search(minX, minY, maxX, maxY, (slot) => {
      index.slotHitAt[slot] = stamp;
      index.hitSlots[hitCount++] = slot;
    });

    if (
      elements !== this.elements ||
      elementsMap !== this.elementsMap ||
      getElementMutationCount() !== this.mutationCount
    ) {
      const result = this.sync(
        elements,
        elementsMap,
        stamp,
        [minX, minY, maxX, maxY],
        alwaysIncludedId,
      );
      if (this.stale >= REBUILD_MIN_STALE || this.isRebuildPending()) {
        this.deferRebuild();
      }
      return result;
    }
    if (zoomed && this.isRebuildPending()) {
      this.deferRebuild();
    }

    const positions = this.positions;
    let count = 0;
    let alwaysIncludedFound = false;
    for (let k = 0; k < hitCount; k++) {
      const slot = index.hitSlots[k];
      if (index.slotSyncedAt[slot] === this.syncGeneration) {
        positions[count++] = index.slotPositions[slot];
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
      const slot = index.slotOf.get(alwaysIncludedId);
      if (
        slot !== undefined &&
        index.slotSyncedAt[slot] === this.syncGeneration &&
        index.slotInTree[slot] &&
        index.slotHitAt[slot] !== stamp
      ) {
        positions[count++] = index.slotPositions[slot];
      }
    }

    const result: T[] = new Array(count);
    const sorted = positions.subarray(0, count).sort();
    for (let k = 0; k < count; k++) {
      result[k] = elements[sorted[k]];
    }
    return result;
  }

  private sync(
    elements: readonly T[],
    elementsMap: ElementsMap,
    stamp: number,
    [minX, minY, maxX, maxY]: Bounds,
    alwaysIncludedId: string | null,
  ): T[] {
    const index = this.index;
    this.elements = elements;
    this.elementsMap = elementsMap;
    this.mutationCount = getElementMutationCount();
    const generation = (this.syncGeneration = ++this.generations);
    if (this.positions.length < elements.length) {
      this.positions = new Uint32Array(elements.length);
    }
    this.unindexed = [];
    let matched = 0;
    let changed = 0;
    let changedWithSlot = 0;
    const result: T[] = [];
    for (let position = 0; position < elements.length; position++) {
      const element = elements[position];
      const slot = index.slotOf.get(element.id);
      if (slot !== undefined && this.isCurrent(slot, element, elementsMap)) {
        index.slotPositions[slot] = position;
        index.slotSyncedAt[slot] = generation;
        matched++;
        if (index.slotInTree[slot]) {
          if (
            index.slotHitAt[slot] === stamp ||
            element.id === alwaysIncludedId
          ) {
            result.push(element);
          }
          continue;
        }
      } else {
        changed++;
        changedWithSlot += slot === undefined ? 0 : 1;
      }
      this.unindexed.push(position);
      if (
        element.id === alwaysIncludedId ||
        touches(this.measure(element, elementsMap), minX, minY, maxX, maxY)
      ) {
        result.push(element);
      }
    }
    this.stale =
      changed + index.slotElements.length - matched - changedWithSlot;
    return result;
  }

  private isCurrent(slot: number, element: T, elementsMap: ElementsMap) {
    const index = this.index;
    if (
      index.slotElements[slot] !== element ||
      index.slotVersions[slot] !== element.version
    ) {
      return false;
    }
    const current = this.dependencyOf(element, elementsMap);
    return (
      current === index.slotDependencies[slot] &&
      (current?.version ?? 0) === index.slotDependencyVersions[slot]
    );
  }

  private isRebuildPending() {
    return (
      this.quietTimer !== null ||
      this.cancelIdleTask !== null ||
      this.rebuildJob !== null
    );
  }

  private deferRebuild() {
    this.cancelIdleTask?.();
    this.cancelIdleTask = null;
    if (this.quietTimer !== null) {
      this.getOwnerWindow().clearTimeout(this.quietTimer);
    }
    this.quietTimer = this.getOwnerWindow().setTimeout(() => {
      this.quietTimer = null;
      this.requestIdleTask();
    }, REBUILD_QUIET_MS);
  }

  private requestIdleTask() {
    const ownerWindow = this.getOwnerWindow();
    if (typeof ownerWindow.requestIdleCallback === "function") {
      const handle = ownerWindow.requestIdleCallback((deadline) => {
        const until = performance.now() + REBUILD_SLICE_MS;
        this.runRebuildTask(
          () => deadline.timeRemaining() > 1 && performance.now() < until,
          CHUNKS_PER_TASK,
        );
      });
      this.cancelIdleTask = () => ownerWindow.cancelIdleCallback(handle);
    } else {
      const timer = ownerWindow.setTimeout(() => {
        const until = performance.now() + REBUILD_SLICE_MS;
        this.runRebuildTask(() => performance.now() < until, CHUNKS_PER_TASK);
      });
      this.cancelIdleTask = () => ownerWindow.clearTimeout(timer);
    }
  }

  /**
   * Rebuilds now, instead of on idle, once enough of the synced array lies
   * outside the tree that each query measures it again. For a run of queries
   * that cannot wait, such as export tiles, the array is then measured once.
   */
  rebuildIfStale() {
    if (this.stale >= REBUILD_MIN_STALE || this.rebuildJob !== null) {
      this.rebuild();
    }
  }

  /** rebuilds the tree from the synced array now, in one go */
  rebuild() {
    if (this.quietTimer !== null) {
      this.getOwnerWindow().clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
    this.runRebuildTask(() => true, Infinity);
  }

  private runRebuildTask(hasTime: () => boolean, chunks: number) {
    this.cancelIdleTask?.();
    this.cancelIdleTask = null;
    if (!this.rebuildJob) {
      if (!this.elements || !this.elementsMap) {
        return;
      }
      this.rebuildJob = this.startRebuild(this.elements, this.elementsMap);
    }
    const job = this.rebuildJob;
    for (let chunk = 0; chunk < chunks; chunk++) {
      const step = job.steps.next();
      if (step.done) {
        this.rebuildJob = null;
        this.install(job, step.value);
        return;
      }
      if (!hasTime()) {
        break;
      }
    }
    this.requestIdleTask();
  }

  private startRebuild(
    elements: readonly T[],
    elementsMap: ElementsMap,
  ): RebuildJob<T> {
    const job: RebuildJob<T> = {
      elements,
      elementsMap,
      mutationCount: getElementMutationCount(),
      syncGenerationAtStart: this.syncGeneration,
      generation: ++this.generations,
      work: { measured: 0, comparisons: 0, writes: 0 },
      steps: undefined!,
      slotsWithoutBox: [],
    };
    job.steps = this.rebuildSteps(job);
    return job;
  }

  private *rebuildSteps(job: RebuildJob<T>): Generator<void, Index<T>, void> {
    const { elements, elementsMap, work } = job;
    const count = elements.length;
    const boxes = new Float64Array(count * 4);
    const items = new Uint32Array(count);
    const slotVersions: number[] = new Array(count);
    const slotDependencies: (ExcalidrawElement | null)[] = new Array(count);
    const slotDependencyVersions: number[] = new Array(count);
    const slotInTree = new Uint8Array(count);
    yield;

    let itemCount = 0;
    for (let slot = 0; slot < count; slot++) {
      const element = elements[slot];
      const bounds = this.measure(element, elementsMap);
      const dependency = this.dependencyOf(element, elementsMap);
      slotVersions[slot] = element.version;
      slotDependencies[slot] = dependency;
      slotDependencyVersions[slot] = dependency?.version ?? 0;
      if (isFiniteBounds(bounds)) {
        boxes.set(bounds, slot * 4);
        slotInTree[slot] = 1;
        items[itemCount++] = slot;
      } else {
        job.slotsWithoutBox.push(slot);
      }
      work.measured++;
      if ((slot + 1) % MEASURE_CHUNK === 0) {
        yield;
      }
    }
    yield;

    const tree = yield* PackedRTree.build(
      boxes,
      items.subarray(0, itemCount),
      work,
    );
    yield;

    const slotOf = new Map<string, number>();
    const slotPositions = new Uint32Array(count);
    const slotSyncedAt = new Uint32Array(count);
    yield;
    for (let slot = 0; slot < count; slot++) {
      slotOf.set(elements[slot].id, slot);
      slotPositions[slot] = slot;
      slotSyncedAt[slot] = job.generation;
      work.writes++;
      if ((slot + 1) % (PACKED_RTREE_BUILD_CHUNK / 2) === 0) {
        yield;
      }
    }
    const slotHitAt = new Uint32Array(count);
    const hitSlots = new Uint32Array(count);
    yield;

    return {
      tree,
      slotOf,
      slotElements: elements,
      slotVersions,
      slotDependencies,
      slotDependencyVersions,
      slotInTree,
      slotPositions,
      slotSyncedAt,
      slotHitAt,
      hitSlots,
    };
  }

  private install(job: RebuildJob<T>, index: Index<T>) {
    this.index = index;
    this.queryStamp = 0;
    if (
      job.elements === this.elements &&
      job.elementsMap === this.elementsMap &&
      job.syncGenerationAtStart === this.syncGeneration &&
      job.mutationCount === getElementMutationCount()
    ) {
      this.syncGeneration = job.generation;
      this.unindexed = job.slotsWithoutBox;
      this.stale = 0;
    } else {
      this.elements = null;
    }
  }

  destroy() {
    if (this.quietTimer !== null) {
      this.getOwnerWindow().clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
    this.cancelIdleTask?.();
    this.cancelIdleTask = null;
    this.rebuildJob = null;
  }
}
