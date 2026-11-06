const NODE_SIZE = 16;

/** comparisons and writes between the pauses of a tree build */
export const PACKED_RTREE_BUILD_CHUNK = 8192;

/** work a tree build has done, for its caller's budget */
export type PackedRTreeBuildWork = { comparisons: number; writes: number };

/** counts a build's work and says when a chunk of it is done */
class Chunks {
  private sincePause = 0;
  constructor(readonly work: PackedRTreeBuildWork) {}
  compared() {
    this.work.comparisons++;
    this.sincePause++;
  }
  /** counts a write, and whether the build should pause after it */
  wrote() {
    this.work.writes++;
    if (++this.sincePause < PACKED_RTREE_BUILD_CHUNK) {
      return false;
    }
    this.sincePause = 0;
    return true;
  }
}

/**
 * A static R-tree packed bottom-up in the layout of flatbush: leaves in
 * sort-tile-recursive order, then each level of parents, the root last. Each
 * node's box is the union of its children's, so a node that misses the query
 * rect rules out all of its items under the same comparisons the items get.
 */
export class PackedRTree {
  private constructor(
    /** minX, minY, maxX, maxY per node */
    private boxes: Float64Array,
    /** a leaf's item, or a parent's first child node */
    private children: Uint32Array,
    /** the end of each level's nodes, leaves first */
    private levelEnds: number[],
  ) {}

  static empty() {
    return new PackedRTree(new Float64Array(0), new Uint32Array(0), [0]);
  }

  /**
   * Packs `items`, indices into `itemBoxes`, into a tree, pausing after every
   * `PACKED_RTREE_BUILD_CHUNK` comparisons or node writes so the caller can
   * spread the build over several tasks. `items` is reordered in place.
   */
  static *build(
    itemBoxes: Float64Array,
    items: Uint32Array,
    work: PackedRTreeBuildWork,
  ): Generator<void, PackedRTree, void> {
    let count = items.length;
    let total = count;
    const levelEnds = [count];
    while (count > 1) {
      count = Math.ceil(count / NODE_SIZE);
      total += count;
      levelEnds.push(total);
    }
    const boxes = new Float64Array(total * 4);
    const children = new Uint32Array(total);

    const chunks = new Chunks(work);
    yield* sortTileRecursive(itemBoxes, items, chunks);

    for (let node = 0; node < items.length; node++) {
      const item = items[node];
      children[node] = item;
      boxes.set(itemBoxes.subarray(item * 4, item * 4 + 4), node * 4);
      if (chunks.wrote()) {
        yield;
      }
    }

    let child = 0;
    for (let level = 0; level < levelEnds.length - 1; level++) {
      const end = levelEnds[level];
      let parent = end;
      while (child < end) {
        const first = child;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < NODE_SIZE && child < end; k++, child++) {
          minX = Math.min(minX, boxes[child * 4]);
          minY = Math.min(minY, boxes[child * 4 + 1]);
          maxX = Math.max(maxX, boxes[child * 4 + 2]);
          maxY = Math.max(maxY, boxes[child * 4 + 3]);
        }
        boxes[parent * 4] = minX;
        boxes[parent * 4 + 1] = minY;
        boxes[parent * 4 + 2] = maxX;
        boxes[parent * 4 + 3] = maxY;
        children[parent] = first;
        parent++;
        if (chunks.wrote()) {
          yield;
        }
      }
    }
    return new PackedRTree(boxes, children, levelEnds);
  }

  /** calls `visit` with each item whose box touches the rect, borders included */
  search(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (item: number) => void,
  ) {
    if (!this.children.length) {
      return;
    }
    const root = this.children.length - 1;
    const stack = [root, this.levelEnds.length - 1];
    while (stack.length) {
      const level = stack.pop()!;
      const node = stack.pop()!;
      if (
        this.boxes[node * 4] > maxX ||
        this.boxes[node * 4 + 1] > maxY ||
        !(this.boxes[node * 4 + 2] >= minX) ||
        !(this.boxes[node * 4 + 3] >= minY)
      ) {
        continue;
      }
      if (level === 0) {
        visit(this.children[node]);
        continue;
      }
      const first = this.children[node];
      const end = Math.min(first + NODE_SIZE, this.levelEnds[level - 1]);
      for (let child = first; child < end; child++) {
        stack.push(child, level - 1);
      }
    }
  }
}

/** orders items into vertical slices by x, each slice by y */
function* sortTileRecursive(
  boxes: Float64Array,
  items: Uint32Array,
  chunks: Chunks,
) {
  const centerX = new Float64Array(boxes.length / 4);
  const centerY = new Float64Array(boxes.length / 4);
  for (const item of items) {
    centerX[item] = boxes[item * 4] + boxes[item * 4 + 2];
    centerY[item] = boxes[item * 4 + 1] + boxes[item * 4 + 3];
    if (chunks.wrote()) {
      yield;
    }
  }
  const buffer = new Uint32Array(items.length);
  yield* mergeSort(items, 0, items.length, centerX, buffer, chunks);
  const sliceSize =
    NODE_SIZE * Math.ceil(Math.sqrt(Math.ceil(items.length / NODE_SIZE)));
  for (let start = 0; start < items.length; start += sliceSize) {
    yield* mergeSort(
      items,
      start,
      Math.min(start + sliceSize, items.length),
      centerY,
      buffer,
      chunks,
    );
  }
}

/**
 * A stable bottom-up merge sort of `items[from, to)` by `keys[item]`, pausing
 * when `chunks` says.
 */
function* mergeSort(
  items: Uint32Array,
  from: number,
  to: number,
  keys: Float64Array,
  buffer: Uint32Array,
  chunks: Chunks,
) {
  let source = items;
  let target = buffer;
  for (let width = 1; width < to - from; width *= 2) {
    for (let left = from; left < to; left += 2 * width) {
      const middle = Math.min(left + width, to);
      const right = Math.min(left + 2 * width, to);
      let i = left;
      let j = middle;
      for (let k = left; k < right; k++) {
        const compared = i < middle && j < right;
        if (compared) {
          chunks.compared();
        }
        if (compared ? !(keys[source[j]] < keys[source[i]]) : i < middle) {
          target[k] = source[i++];
        } else {
          target[k] = source[j++];
        }
        if (chunks.wrote()) {
          yield;
        }
      }
    }
    [source, target] = [target, source];
  }
  if (source !== items) {
    for (let k = from; k < to; k++) {
      items[k] = source[k];
      if (chunks.wrote()) {
        yield;
      }
    }
  }
}
