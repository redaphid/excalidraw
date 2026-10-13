# Spike #76: ELK top-down layout as the deep-zoom primitive

Issue: redaphid/excalidraw#76. Branch `spike/excalidraw-76-elk-topdown`, based on `feat/arrange-elk` (PR #59).

## Question

Does the elkjs that PR #59 installs support `elk.topdownLayout`, and does it return scaled children for three nested levels? If it does, how small does the scale get at six levels, and does float precision hold?

## What I built

`docs/spikes/76-elk-topdown/probe.mjs` is a standalone Node script, not editor code. It builds a graph of nested diagrams, lays it out with the top-down options and prints each level's scale factor and child boxes. Each diagram is a chain of `n` nodes (160x80). One node per diagram holds the next diagram. That node is a fixed 160x80 slot, like any other node.

The script reads each scale from ELK, composes the per-level transforms into root coordinates, and checks that every level's children land inside their parent slot. It also compares each scale against `min(slot / children bbox, 1)` computed from the returned boxes.

Reproduce with `cd docs/spikes/76-elk-topdown && npm install && node probe.mjs`. The captured run is `76-elk-topdown/output.txt`.

The version is `elkjs` 0.12.0, pinned in `packages/excalidraw/package.json` and `yarn.lock` on `feat/arrange-elk`.

## Evidence

### What elkjs 0.12.0 does

| Check | Result |
| --- | --- |
| `elk.topdownLayout`, `elk.topdown.nodeType`, `hierarchicalNodeWidth`, `hierarchicalNodeAspectRatio`, `scaleFactor`, `scaleCap`, `sizeApproximator`, `sizeCategories` registered | Yes |
| Top-down recursion runs | Yes, once `elk.topdownLayout` is set on every node that has children. The option is not inherited. Without it only the root is laid out. |
| Node types required | A root without `elk.topdown.nodeType` throws `root has not been assigned a top-down node type`. I set `ROOT_NODE` on the root and `HIERARCHICAL_NODE` on the nested diagrams and did not test other combinations. |
| `topdownpacking` algorithm (needed for `PARALLEL_NODE`) | Absent from this build. The algorithm list has no `topdownpacking`, so root and hierarchical nodes are the only usable types. |
| Scale appears in the layout JSON | No. It is computed (`min(slot/children width, slot/children height, scaleCap)`) and logged as `<id> -- Local Scale Factor (X\|Y)`. The probe reads it with `logging: true`. |
| Children come back pre-scaled | No. Boxes are in the diagram's own unscaled frame, with each child shifted by `padding/scale - padding` so the padding stays constant after the caller scales. A level's absolute box is `parent origin + parent cumulative scale * local`. |
| Scale from the log equals scale recomputed from the returned boxes | Yes, relative difference 0 at every level in every run. |

So the answer to the literal question is yes for top-down support and no for "returns scaled children". The caller scales, and the scale is only in the log (or one line of arithmetic from the boxes).

### Three levels (6 nodes per diagram)

| Level | Scale | Cumulative | Children in local frame |
| --- | --- | --- | --- |
| L1 root | 1 | 1 | 6 nodes at x = 12, 192, 372, 552, 732, 912; y = 12; 160x80 |
| L2 | 0.128302 | 0.128302 | 6 nodes at x = 93.53 ... 993.53 (step 180); y = 93.53; 160x80 |
| L3 | 0.128302 | 0.016461 | same boxes as L2 |

Every level is laid out at natural size, so each level's local coordinates stay in the hundreds. Only the scale shrinks.

### Six levels

| Nodes per diagram | Scale per level | Smallest cumulative scale (L6) | Zoom to reach it | Leaf width in root units |
| --- | --- | --- | --- | --- |
| 3 | 0.26154 | 1.2e-3 | 8.2e2 | 0.196 |
| 6 | 0.12830 | 3.48e-5 | 2.9e4 | 5.6e-3 |
| 10 | 0.07640 | 2.60e-6 | 3.8e5 | 4.2e-4 |
| 16 | 0.04755 | 2.43e-7 | 4.1e6 | 3.9e-5 |

The scale per level is `slot width / diagram width`, so it is set by how wide the diagram is relative to its slot. About 12 nodes per diagram gives 1e6x at six levels.

### Float precision

| Nodes per diagram | float64 ULP / leaf width | float32 ULP / leaf width, absolute coordinates | float32 ULP / leaf width, camera-relative |
| --- | --- | --- | --- |
| 3 | 2.9e-13 | 1.6e-4 | 7.6e-8 |
| 6 | 2.0e-11 | 1.0e-2 | 8.4e-8 |
| 10 | 2.7e-10 | 0.15 | 7.0e-8 |
| 16 | 5.8e-9 | 3.14 | 9.4e-8 |

Computing in float64 holds at every depth tried. Float32 in absolute root coordinates stops being usable around 4e5x: the deepest leaf is 15% of one float32 step there, and at 4e6x it is three steps wide, so it cannot be placed. Float32 relative to the camera origin stays at about 1e-7 of the leaf width, because subtracting in float64 first leaves small numbers. That last part is the arithmetic of the format. I did not measure Excalidraw's canvas path, so whether it uses float32 matrices is inference.

### Cost

The full tree (3 nodes per diagram, every node expands, 6 levels) is 1093 ELK nodes and 363 scaled diagrams. It laid out in 1.7 s on one run. The three-level spine graph took 0.18 s. These are single timings on one machine.

## Answer

Keep the idea, narrowed: elkjs 0.12.0 does lay out nested levels top-down and the numbers hold at six levels and 1e6x, but ELK's part is thin, because the scale is `min(slot/extent, 1)` and the caller applies it.

## What I would build next

1. Do the nesting in the editor with the existing per-level `layered` arrange plus our own fit. Take the scale from the returned boxes, as the probe's `scaleFromBoxes` does. That avoids the log scraping and the `topdownLayout` option rules. Use `elk.topdownLayout` only if a later spike needs ELK to size slots for many siblings.
2. Store each level in its own local frame and compose to the camera at render time. Absolute coordinates are the part that fails, not the layout.
3. Spike the render path next: draw the deepest level from a camera-relative origin and confirm the leaf is placed correctly at 1e6x in the real canvas. This spike did not touch the editor.

## Not covered

- Excalidraw's frame "grow only" rule against fixed parent slots (named in the issue as a risk) was not tested.
- Only spine nesting and one all-expanding tree were run. Mixed edge routing across levels and ports on the nested nodes were not.
- The scale cap of 1 means a diagram smaller than its slot is never enlarged. That is the ELK default and I left it.
