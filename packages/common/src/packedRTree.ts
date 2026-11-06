const NODE_SIZE = 16;

/**
 * A static R-tree packed bottom-up in the layout of flatbush: leaves in
 * sort-tile-recursive order, then each level of parents, the root last. Each
 * node's box is the union of its children's, so a node that misses the query
 * rect rules out all of its items under the same comparisons the items get.
 */
export class PackedRTree {
  /** minX, minY, maxX, maxY per node */
  private boxes: Float64Array;
  /** a leaf's item, or a parent's first child node */
  private children: Uint32Array;
  /** the end of each level's nodes, leaves first */
  private levelEnds: number[];

  constructor(itemBoxes: Float64Array, items: number[]) {
    let count = items.length;
    let total = count;
    this.levelEnds = [count];
    while (count > 1) {
      count = Math.ceil(count / NODE_SIZE);
      total += count;
      this.levelEnds.push(total);
    }
    this.boxes = new Float64Array(total * 4);
    this.children = new Uint32Array(total);

    const leaves = sortTileRecursive(itemBoxes, items);
    for (let node = 0; node < leaves.length; node++) {
      const item = leaves[node];
      this.children[node] = item;
      this.boxes.set(itemBoxes.subarray(item * 4, item * 4 + 4), node * 4);
    }

    let child = 0;
    for (let level = 0; level < this.levelEnds.length - 1; level++) {
      const end = this.levelEnds[level];
      let parent = end;
      while (child < end) {
        const first = child;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < NODE_SIZE && child < end; k++, child++) {
          minX = Math.min(minX, this.boxes[child * 4]);
          minY = Math.min(minY, this.boxes[child * 4 + 1]);
          maxX = Math.max(maxX, this.boxes[child * 4 + 2]);
          maxY = Math.max(maxY, this.boxes[child * 4 + 3]);
        }
        this.boxes[parent * 4] = minX;
        this.boxes[parent * 4 + 1] = minY;
        this.boxes[parent * 4 + 2] = maxX;
        this.boxes[parent * 4 + 3] = maxY;
        this.children[parent] = first;
        parent++;
      }
    }
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
const sortTileRecursive = (boxes: Float64Array, items: number[]) => {
  const centerX = (item: number) => boxes[item * 4] + boxes[item * 4 + 2];
  const centerY = (item: number) => boxes[item * 4 + 1] + boxes[item * 4 + 3];
  const sorted = items.slice().sort((a, b) => centerX(a) - centerX(b));
  const sliceSize =
    NODE_SIZE * Math.ceil(Math.sqrt(Math.ceil(sorted.length / NODE_SIZE)));
  const result: number[] = [];
  for (let start = 0; start < sorted.length; start += sliceSize) {
    result.push(
      ...sorted
        .slice(start, start + sliceSize)
        .sort((a, b) => centerY(a) - centerY(b)),
    );
  }
  return result;
};
