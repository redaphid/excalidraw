// Spike for redaphid/excalidraw#76: does elkjs support elk.topdownLayout and
// return scaled children for nested levels?  Run: `npm install && node probe.mjs`
import ELK from "elkjs/lib/elk.bundled.js";
import { createRequire } from "node:module";

const elk = new ELK();
const { version } = createRequire(import.meta.url)("elkjs/package.json");

const LEAF = { w: 160, h: 80 };
const PAD = 12; // ELK's default padding
const SLOT_W = LEAF.w - 2 * PAD; // hierarchicalNodeWidth is the content area, padding comes on top
const SLOT_ASPECT = SLOT_W / (LEAF.h - 2 * PAD);

// topdownLayout is not inherited: it has to be set on every node that has children.
const diagramOptions = (nodeType) => ({
  "elk.topdownLayout": "true",
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.topdown.nodeType": nodeType,
});

const slotOptions = {
  "elk.nodeSize.fixedGraphSize": "true",
  "elk.topdown.hierarchicalNodeWidth": String(SLOT_W),
  "elk.topdown.hierarchicalNodeAspectRatio": String(SLOT_ASPECT),
};

/** One diagram of `n` nodes in a chain. `expand(i)` says which children hold a nested diagram. */
function diagram(id, level, depth, n, expand) {
  const children = [];
  for (let i = 0; i < n; i++) {
    const cid = `${id}.${i}`;
    children.push(
      level < depth && expand(i)
        ? {
            ...diagram(cid, level + 1, depth, n, expand),
            layoutOptions: { ...diagramOptions("HIERARCHICAL_NODE"), ...slotOptions },
          }
        : { id: cid, width: LEAF.w, height: LEAF.h },
    );
  }
  const edges = children.slice(1).map((c, i) => ({
    id: `${c.id}~e`,
    sources: [children[i].id],
    targets: [c.id],
  }));
  return { id, children, edges, layoutOptions: diagramOptions("ROOT_NODE") };
}

const spine = (n) => (i) => i === Math.floor(n / 2);

/** ELK does not put the scale in the JSON result. It only logs it, so read it from the log. */
function scalesFromLog(logging) {
  const scales = new Map();
  const visit = (v) => {
    if (typeof v === "string") {
      const m = v.match(/^(\S+) -- Local Scale Factor \(X\|Y\): \(([^|]+)\|([^)]+)\)$/);
      if (m) scales.set(m[1], { rx: +m[2], ry: +m[3] });
    } else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(logging);
  return scales;
}

/** Independent check: scale = min(slot / extent of the children's bounding box, scaleCap = 1). */
function scaleFromBoxes(node) {
  const xs0 = Math.min(...node.children.map((c) => c.x));
  const xs1 = Math.max(...node.children.map((c) => c.x + c.width));
  const ys0 = Math.min(...node.children.map((c) => c.y));
  const ys1 = Math.max(...node.children.map((c) => c.y + c.height));
  const slotH = SLOT_W / SLOT_ASPECT;
  return Math.min(SLOT_W / (xs1 - xs0), slotH / (ys1 - ys0), 1);
}

/** Walk the spine, composing frames: abs = frame.origin + frame.scale * local. */
function walkSpine(root, scales, n) {
  const levels = [];
  let node = root;
  let frame = { ox: 0, oy: 0, scale: 1 };
  for (let level = 1; node; level++) {
    const own = level === 1 ? { rx: 1, ry: 1, q: 1 } : scales.get(node.id);
    const q = level === 1 ? 1 : Math.min(own.rx, own.ry, 1);
    if (level > 1) frame = { ...frame, scale: frame.scale * q };
    const boxes = node.children.map((c) => ({
      id: c.id,
      local: { x: c.x, y: c.y, w: c.width, h: c.height },
      abs: {
        x: frame.ox + frame.scale * c.x,
        y: frame.oy + frame.scale * c.y,
        w: frame.scale * c.width,
        h: frame.scale * c.height,
      },
    }));
    levels.push({
      level,
      id: node.id,
      q,
      qFromBoxes: level === 1 ? 1 : scaleFromBoxes(node),
      cumulative: frame.scale,
      boxes,
    });
    if (level > 1) {
      const slot = levels[level - 2].boxes.find((b) => b.id === node.id).abs;
      const eps = slot.w * 1e-9;
      for (const b of boxes) {
        const inside =
          b.abs.x >= slot.x - eps && b.abs.y >= slot.y - eps &&
          b.abs.x + b.abs.w <= slot.x + slot.w + eps && b.abs.y + b.abs.h <= slot.y + slot.h + eps;
        if (!inside) throw new Error(`${b.id} falls outside its parent slot ${node.id}`);
      }
    }
    const next = node.children.find((c) => c.children);
    if (!next) break;
    const nb = boxes.find((b) => b.id === next.id);
    frame = { ox: nb.abs.x, oy: nb.abs.y, scale: frame.scale };
    node = next;
  }
  return levels;
}

const ulp32 = (v) => (v === 0 ? 0 : 2 ** (Math.floor(Math.log2(Math.abs(v))) - 23));
const ulp64 = (v) => (v === 0 ? 0 : 2 ** (Math.floor(Math.log2(Math.abs(v))) - 52));
const fmt = (v, d = 4) => (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6) ? v.toExponential(d) : (+v.toFixed(d)).toString());

async function run(depth, n, { full = false } = {}) {
  const t0 = performance.now();
  const graph = diagram("d1", 1, depth, n, full ? () => true : spine(n));
  const out = await elk.layout(graph, { logging: true });
  const ms = performance.now() - t0;
  return { out, scales: scalesFromLog(out.logging), ms };
}

function printLevels(levels) {
  for (const L of levels) {
    console.log(
      `L${L.level} ${L.id}  scale=${fmt(L.q, 6)} (from boxes ${fmt(L.qFromBoxes, 6)})  cumulative=${fmt(L.cumulative, 6)}`,
    );
    for (const b of L.boxes) {
      const l = b.local;
      console.log(
        `    ${b.id.padEnd(22)} local x=${fmt(l.x, 2)} y=${fmt(l.y, 2)} w=${fmt(l.w, 2)} h=${fmt(l.h, 2)}`,
      );
    }
  }
}

function precision(levels) {
  const last = levels[levels.length - 1];
  const leaf = last.boxes[0].abs;
  const cam = { x: leaf.x, y: leaf.y }; // camera origin sits on the deepest diagram
  const rel = (v, c) => Math.fround(v - c);
  const widths32 = Math.fround(leaf.x + leaf.w) - Math.fround(leaf.x);
  return {
    leafWidth: leaf.w,
    absX: leaf.x,
    ulp32_abs: ulp32(Math.max(Math.abs(leaf.x), Math.abs(leaf.x + leaf.w))),
    ulp64_abs: ulp64(Math.max(Math.abs(leaf.x), Math.abs(leaf.x + leaf.w))),
    f32WidthRecovered: widths32,
    f32CameraRelWidth: rel(leaf.x + leaf.w, cam.x) - rel(leaf.x, cam.x),
    f32CameraRelUlp: ulp32(leaf.w),
  };
}

// ---- 1. three nested levels, full detail -------------------------------------------------
console.log(`elkjs ${version}\n`);
const algos = (await elk.knownLayoutAlgorithms()).map((a) => a.id.split(".").pop());
console.log(`algorithms in this build: ${algos.join(", ")}`);
console.log(`topdownpacking present: ${algos.includes("topdownpacking")}\n`);

console.log("=== 3 levels, 6 nodes per diagram, spine nesting ===");
{
  const { out, scales, ms } = await run(3, 6);
  const levels = walkSpine(out, scales, 6);
  printLevels(levels);
  console.log(`layout ${fmt(ms, 1)} ms; logged scales: ${scales.size}; JSON result carries scale: ${JSON.stringify(out).includes("scaleFactor")}`);
  console.log(`child width in the result: ${out.children.find((c) => c.children).width} (slot ${LEAF.w}); children are NOT pre-scaled, the scale is applied by the caller\n`);
}

// ---- 2. six levels, sweep of nodes per diagram -------------------------------------------
console.log("=== 6 levels, sweep of nodes per diagram ===");
const rows = [];
for (const n of [3, 6, 10, 16]) {
  const { out, scales } = await run(6, n);
  const levels = walkSpine(out, scales, n);
  const last = levels[levels.length - 1];
  const p = precision(levels);
  const maxQErr = Math.max(...levels.map((L) => Math.abs(L.q - L.qFromBoxes) / L.q));
  rows.push({ n, perLevel: levels[1].q, smallest: last.cumulative, zoom: 1 / last.cumulative, p, maxQErr });
}
console.log("n/diagram | scale/level | smallest cumulative | zoom needed | leaf w (root units) | f64 ulp/w | f32 ulp/w (abs) | f32 ulp/w (camera-rel) | log vs boxes");
for (const r of rows) {
  console.log(
    [
      String(r.n).padStart(9),
      fmt(r.perLevel, 5).padStart(11),
      fmt(r.smallest, 4).padStart(19),
      fmt(r.zoom, 3).padStart(11),
      fmt(r.p.leafWidth, 4).padStart(19),
      fmt(r.p.ulp64_abs / r.p.leafWidth, 2).padStart(9),
      fmt(r.p.ulp32_abs / r.p.leafWidth, 2).padStart(15),
      fmt(r.p.f32CameraRelUlp / r.p.leafWidth, 2).padStart(22),
      fmt(r.maxQErr, 2).padStart(12),
    ].join(" | "),
  );
}

// ---- 3. cost of the full tree (every child expands) --------------------------------------
console.log("\n=== full tree, 3 nodes per diagram, 6 levels (every node expands) ===");
{
  const { out, scales, ms } = await run(6, 3, { full: true });
  const count = (n) => 1 + (n.children ?? []).reduce((s, c) => s + count(c), 0);
  console.log(`${count(out)} ELK nodes, ${scales.size} scaled diagrams, ${fmt(ms, 0)} ms`);
}
