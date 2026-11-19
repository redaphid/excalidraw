import {
  PackedRTree,
  type Bounds,
  type PackedRTreeBuildPace,
} from "@excalidraw/common";

import { getElementMutationCount } from "./mutateElement";

import type { ElementsMap, ExcalidrawElement } from "./types";

const REBUILD_QUIET_MS = 1000;
/** the time one idle task of a rebuild may spend before its last step */
export const REBUILD_SLICE_MS = 4;
/**
 * What one step of a rebuild aims to take, and so about how far a task runs
 * past its slice. Each step sizes itself from the last one's time per unit
 * of work (a measure, a comparison, a write, an id lookup), since that time
 * varies a hundredfold with the device, the element and whether the code is
 * still cold, and a clock read per unit costs as much as cheap units do.
 */
export const REBUILD_STEP_MS = 0.5;
/** a step grows at most this much over the last one */
const STEP_GROWTH = 4;
const REBUILD_MIN_STALE = 32;

const touchesGrown = (
  [x1, y1, x2, y2]: Bounds,
  grow: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) =>
  minX <= x2 + grow &&
  minY <= y2 + grow &&
  maxX >= x1 - grow &&
  maxY >= y1 - grow;

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
  /** the largest `slackOf` among the elements in the tree */
  maxSlack: number;
};

export type ElementsRTreeRebuildWork = {
  measured: number;
  comparisons: number;
  writes: number;
  /** ids written into or dropped from the id lookup */
  lookupWrites: number;
};

/** one idle task of an index rebuild: how long it ran and what it did */
export type ElementsRTreeRebuildTask = ElementsRTreeRebuildWork & {
  ms: number;
  /** whether this task finished the rebuild */
  done: boolean;
};

let rebuildTaskObserver: ((task: ElementsRTreeRebuildTask) => void) | null =
  null;

/**
 * Reports every idle task of every index rebuild to `observer`, for
 * benchmarks; `null` stops the reports.
 */
export const observeElementsRTreeRebuildTasks = (
  observer: ((task: ElementsRTreeRebuildTask) => void) | null,
) => {
  rebuildTaskObserver = observer;
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
  /** a retired index's id lookup, brought up to date for this one */
  slotOf: Map<string, number>;
  /**
   * units of work per step; sized from each step's time while the rebuild
   * runs in idle tasks, unbounded once it runs to the end at once
   */
  pace: PackedRTreeBuildPace & { timed: boolean };
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
  maxSlack: 0,
});

/**
 * Answers which elements touch a rect from a packed R-tree that survives
 * element-array changes: indexed elements are matched by object and version,
 * and only the new or changed ones are measured. Elements must change through
 * `mutateElement` or a new array given to `updateScene({ elements })`; an
 * element written in place by any other route keeps its old box here until
 * the next scene change.
 */
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
  /**
   * The id lookup of the index before the current one, which no query reads
   * any more. A rebuild rewrites only the ids whose slot moved, since filling
   * a fresh `Map` with every id costs tens of milliseconds on a large board
   * and rehashes it, all in one `set`, each time it doubles.
   */
  private spareSlotOf: Map<string, number> | null = null;
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
    /** how far past its box `queryWithSlack` looks for an element */
    private readonly slackOf: (
      element: T,
      elementsMap: ElementsMap,
    ) => number = () => 0,
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
    if (zoomed && this.isRebuildPending()) {
      this.deferRebuild();
    }
    return this.collect(
      elements,
      elementsMap,
      [minX, minY, maxX, maxY],
      alwaysIncludedId === null ? null : new Set([alwaysIncludedId]),
      false,
    );
  }

  /**
   * The elements of `elements` whose box grown by their `slackOf` touches
   * the rect, borders included, plus those in `alwaysIncluded` wherever they
   * are, in array order. May return more elements than that. Unlike `query`,
   * a call does not count as a zoom, so it can come between the view's
   * queries without postponing a rebuild.
   */
  queryWithSlack(
    elements: readonly T[],
    elementsMap: ElementsMap,
    rect: Bounds,
    alwaysIncluded: ReadonlySet<string> | null,
  ): T[] {
    return this.collect(elements, elementsMap, rect, alwaysIncluded, true);
  }

  private collect(
    elements: readonly T[],
    elementsMap: ElementsMap,
    [minX, minY, maxX, maxY]: Bounds,
    alwaysIncluded: ReadonlySet<string> | null,
    withSlack: boolean,
  ): T[] {
    const index = this.index;
    const stamp = ++this.queryStamp;
    const treeSlack = withSlack ? index.maxSlack : 0;
    let hitCount = 0;
    index.tree.search(
      minX - treeSlack,
      minY - treeSlack,
      maxX + treeSlack,
      maxY + treeSlack,
      (slot) => {
        index.slotHitAt[slot] = stamp;
        index.hitSlots[hitCount++] = slot;
      },
    );

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
        alwaysIncluded,
        withSlack,
      );
      if (this.stale >= REBUILD_MIN_STALE || this.isRebuildPending()) {
        this.deferRebuild();
      }
      return result;
    }

    const positions = this.positions;
    let count = 0;
    for (let k = 0; k < hitCount; k++) {
      const slot = index.hitSlots[k];
      if (index.slotSyncedAt[slot] === this.syncGeneration) {
        positions[count++] = index.slotPositions[slot];
      }
    }
    for (const position of this.unindexed) {
      const element = elements[position];
      if (
        alwaysIncluded?.has(element.id) ||
        touchesGrown(
          this.measure(element, elementsMap),
          withSlack ? this.slackOf(element, elementsMap) : 0,
          minX,
          minY,
          maxX,
          maxY,
        )
      ) {
        positions[count++] = position;
      }
    }
    // the unindexed elements were all tested above; an indexed one is added
    // here unless the tree search already found it
    for (const id of alwaysIncluded ?? []) {
      const slot = index.slotOf.get(id);
      if (
        slot !== undefined &&
        index.slotSyncedAt[slot] === this.syncGeneration &&
        index.slotInTree[slot] &&
        index.slotHitAt[slot] !== stamp
      ) {
        index.slotHitAt[slot] = stamp;
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
    alwaysIncluded: ReadonlySet<string> | null,
    withSlack: boolean,
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
            alwaysIncluded?.has(element.id)
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
        alwaysIncluded?.has(element.id) ||
        touchesGrown(
          this.measure(element, elementsMap),
          withSlack ? this.slackOf(element, elementsMap) : 0,
          minX,
          minY,
          maxX,
          maxY,
        )
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
      const handle = ownerWindow.requestIdleCallback((deadline) =>
        this.runIdleTask(() => deadline.timeRemaining() > 1),
      );
      this.cancelIdleTask = () => ownerWindow.cancelIdleCallback(handle);
    } else {
      const timer = ownerWindow.setTimeout(() => this.runIdleTask(() => true));
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

  private runIdleTask(idle: () => boolean) {
    const now = this.getOwnerWindow().performance;
    const start = now.now();
    const until = start + REBUILD_SLICE_MS;
    const before = this.rebuildJob
      ? { ...this.rebuildJob.work }
      : { measured: 0, comparisons: 0, writes: 0, lookupWrites: 0 };
    const job = this.runRebuildTask(() => idle() && now.now() < until, now);
    if (rebuildTaskObserver && job) {
      rebuildTaskObserver({
        ms: now.now() - start,
        measured: job.work.measured - before.measured,
        comparisons: job.work.comparisons - before.comparisons,
        writes: job.work.writes - before.writes,
        lookupWrites: job.work.lookupWrites - before.lookupWrites,
        done: this.rebuildJob === null,
      });
    }
  }

  /** rebuilds the tree from the synced array now, in one go */
  rebuild() {
    if (this.quietTimer !== null) {
      this.getOwnerWindow().clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
    this.runRebuildTask(() => true, null);
  }

  /**
   * Runs the rebuild one step at a time while `hasTime` holds, so a task
   * overruns its time by at most one step, and returns the job, if any.
   * With a `clock`, each step is sized to take about `REBUILD_STEP_MS`;
   * without, the rebuild runs to the end.
   */
  private runRebuildTask(hasTime: () => boolean, clock: Performance | null) {
    this.cancelIdleTask?.();
    this.cancelIdleTask = null;
    if (!this.rebuildJob) {
      if (!this.elements || !this.elementsMap) {
        return null;
      }
      this.rebuildJob = this.startRebuild(this.elements, this.elementsMap);
    }
    const job = this.rebuildJob;
    const { pace } = job;
    if (!clock) {
      pace.timed = false;
      pace.stride = Infinity;
    }
    let stepStart = clock?.now() ?? 0;
    do {
      const units = pace.units;
      const step = job.steps.next();
      if (step.done) {
        this.rebuildJob = null;
        this.install(job, step.value);
        return job;
      }
      if (clock && pace.timed) {
        const stepEnd = clock.now();
        const stepUnits = pace.units - units;
        if (stepUnits > 0) {
          const unitMs = (stepEnd - stepStart) / stepUnits;
          pace.stride = Math.max(
            1,
            Math.min(
              Math.floor(REBUILD_STEP_MS / unitMs),
              pace.stride * STEP_GROWTH,
            ),
          );
        }
        stepStart = stepEnd;
      }
    } while (hasTime());
    this.requestIdleTask();
    return job;
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
      work: { measured: 0, comparisons: 0, writes: 0, lookupWrites: 0 },
      steps: undefined!,
      slotsWithoutBox: [],
      slotOf: this.spareSlotOf ?? new Map(),
      pace: { stride: 1, units: 0, timed: true },
    };
    this.spareSlotOf = null;
    job.steps = this.rebuildSteps(job);
    return job;
  }

  private *rebuildSteps(job: RebuildJob<T>): Generator<void, Index<T>, void> {
    const { elements, elementsMap, work, pace } = job;
    let sinceStep = 0;
    /** begins a run of units whose cost may differ from the last run's */
    const startPhase = () => {
      sinceStep = 0;
      if (pace.timed) {
        pace.stride = 1;
      }
    };
    /** counts one unit of work, and says whether the step is over */
    const endsStep = () => {
      pace.units++;
      if (++sinceStep < pace.stride) {
        return false;
      }
      sinceStep = 0;
      return true;
    };
    const count = elements.length;
    const boxes = new Float64Array(count * 4);
    const items = new Uint32Array(count);
    const slotVersions: number[] = new Array(count);
    const slotDependencies: (ExcalidrawElement | null)[] = new Array(count);
    const slotDependencyVersions: number[] = new Array(count);
    const slotInTree = new Uint8Array(count);
    yield;

    let itemCount = 0;
    let maxSlack = 0;
    startPhase();
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
        const slack = this.slackOf(element, elementsMap);
        // a NaN slack would void every search; it comes from a NaN threshold
        // or fill, which no point hits
        if (slack > maxSlack) {
          maxSlack = slack;
        }
      } else {
        job.slotsWithoutBox.push(slot);
      }
      work.measured++;
      if (endsStep()) {
        yield;
      }
    }
    yield;

    startPhase();
    const tree = yield* PackedRTree.build(
      boxes,
      items.subarray(0, itemCount),
      work,
      pace,
    );
    yield;

    const { slotOf } = job;
    const slotPositions = new Uint32Array(count);
    const slotSyncedAt = new Uint32Array(count);
    yield;
    // the last of an id's slots wins, as `set` in array order would leave it
    let duplicates = 0;
    startPhase();
    for (let slot = 0; slot < count; slot++) {
      const id = elements[slot].id;
      const previous = slotOf.get(id);
      if (previous !== slot) {
        if (
          previous !== undefined &&
          previous < slot &&
          elements[previous].id === id
        ) {
          duplicates++;
        }
        slotOf.set(id, slot);
        work.lookupWrites++;
      }
      slotPositions[slot] = slot;
      slotSyncedAt[slot] = job.generation;
      work.writes++;
      if (endsStep()) {
        yield;
      }
    }
    // every id of the array now leads to its slot; any other id left from
    // the retired index leads nowhere and goes
    if (slotOf.size > count - duplicates) {
      startPhase();
      for (const [id, slot] of slotOf) {
        if (elements[slot]?.id !== id) {
          slotOf.delete(id);
          work.lookupWrites++;
        }
        if (endsStep()) {
          yield;
        }
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
      maxSlack,
    };
  }

  private install(job: RebuildJob<T>, index: Index<T>) {
    this.spareSlotOf = this.index.slotOf;
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
