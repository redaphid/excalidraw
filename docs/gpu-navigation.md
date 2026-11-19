# GPU navigation

Status: design. No code yet. Part of #198.

Every pan and zoom should draw from tiles the GPU already holds, instead of redrawing the scene each frame. Draw (redaphid/draw) has this today for wheel and two-finger pinch, in a layer that sits outside the editor (`frontend/src/board/view/`, 2,344 lines plus tests). One-finger hand-tool pans still go through the editor, which redraws every frame. This doc moves the layer into the fork, where it becomes the renderer while the camera moves, and deletes the parts that only existed because it lived outside.

## What changes for a person

- One finger with the hand tool, space+drag, middle and right drag, and view mode pan as smoothly as a pinch does now.
- Wheel, trackpad pinch, two-finger touch and animated flights (`scrollToContent`, frame links) all use the same path.
- After a gesture, the sharp picture replaces the tiles in one frame, as soon as it is painted. The 1.2 s wait goes.
- Selection boxes, collaborator cursors and frame names stay on screen while you move. Today draw's layer covers them.

## How it works

```
             today                                  after
1 finger ──► editor redraws each frame     1 finger ─┐
2 fingers ─► draw view/ (outside)          2 fingers ┤
wheel ─────► draw view/ (outside)          wheel ────┼─► AppViewport.translate ─► camera in AppState
flights ───► editor redraws each frame     flights ──┘            │
                                                         moving ──┼──► compositor: tiles on the GPU
                                                         still ───┴──► static canvas, sharp
```

All of the fork's navigation already ends in one call: `AppViewport.translate` (11 call sites from `AppPan`, `AppWheel`, two-finger touch and Safari's gesture events), plus `animateToViewport` for flights. So the compositor does not need to know about inputs. It needs to know two things: the camera changed, and whether something still holds the camera.

- **Moving.** The camera in `AppState` updates every frame as it does now. The static canvas skips its redraw. The compositor draws the frame from tiles at the new camera. The interactive canvas and the DOM overlays keep following `AppState`, so they stay correct.
- **Still.** When nothing has held the camera for a settle time, the static canvas draws once, sharp, at the final camera. When `onPainted` reports that frame on screen, the compositor hides in the same frame (#123).

The compositor canvas sits between the static canvas and the interactive canvas. Draw's canvas had to sit on top of everything.

## Modules

New code lives in `packages/excalidraw/renderer/tiles/` and one new App module. Nothing goes in `common`, `element` or `math` except what the tile raster needs from `element`.

| Fork file | From draw | What it does |
| --- | --- | --- |
| `renderer/tiles/pyramid.ts` | `tiles.ts`, part of `rect.ts` | Levels, tile rects, wanted tiles by priority, evictions, stale tiles for a dirty box. Pure. |
| `renderer/tiles/plan.ts` | `frame.ts` | The layers of one frame: best tile available per area, sharper and coarser (#117), fade-in (#118), overscale cap (#119). Pure. |
| `renderer/tiles/raster.ts` | replaces `export.ts` | Draws one tile in time slices with the static scene's own element loop, drawing elements directly, no per-element bitmaps. |
| `renderer/tiles/scheduler.ts` | the pump in `view.ts` | Idle-time slices, priority bins, byte budget, cancelling unwanted work, prefetch along the pan (#120). |
| `renderer/tiles/cache.ts` | tile map in `view.ts` | Tiles by key with texture, bytes, last use and stale flag; invalidation from scene changes. |
| `renderer/gpu/compositor.ts` | `gl.ts`, `grid.ts` | WebGL2: backdrop, grid, textured quads, context loss. |
| `components/canvases/CompositorCanvas.tsx` | the `<canvas class="view">` | The canvas element and its size, shared with `StaticCanvas`. |
| `components/App.navigation.ts` | the rest of `view.ts` | `AppNavigation`: holds, settle, hand-over, owns the compositor, cache and scheduler. |

## Types

```ts
// renderer/tiles/pyramid.ts
export type Level = number & { readonly __level: unique symbol };
export type TileId = { level: Level; col: number; row: number };
export type TileKey = string & { readonly __tileKey: unique symbol };
export type Camera = Pick<AppState, "zoom" | "scrollX" | "scrollY">;
export type Screen = { width: number; height: number; dpr: number };

export const levelFor = (zoom: number, dpr: number): Level => { throw new Error("not implemented"); };
export const tileKey = (t: TileId): TileKey => { throw new Error("not implemented"); };
export const tileBounds = (t: TileId): Bounds => { throw new Error("not implemented"); };

export type Priority = "now" | "soon" | "eventually";
/** Nearest first: view, floor, rings; cut at `budgetBytes`. */
export const wantedTiles = (
  camera: Camera, screen: Screen, velocity: { x: number; y: number }, budgetBytes: number,
): readonly { id: TileId; priority: Priority }[] => { throw new Error("not implemented"); };

// renderer/tiles/cache.ts
export type CachedTile = {
  id: TileId;
  /** null: drawn, and nothing reaches into it. */
  texture: WebGLTexture | null;
  bytes: number;
  /** When it arrived; -Infinity when it replaced its own older drawing. */
  at: number;
  used: number;
  stale: boolean;
};
/** Where an element was and is, grown by its paint extent. */
export type Dirty = { bounds: Bounds; frame: boolean };

export interface TileCache {
  get(key: TileKey): CachedTile | undefined;
  inView(camera: Camera, screen: Screen): readonly CachedTile[];
  put(id: TileId, texture: WebGLTexture | null, bytes: number): void;
  /** Marks tiles under `dirty` stale. They keep showing until redrawn. */
  invalidate(dirty: readonly Dirty[]): void;
  /** Theme, frame rendering, fonts, context loss: every tile goes. */
  dropAll(): void;
  evict(wanted: ReadonlySet<TileKey>, budgetBytes: number): void;
}

// renderer/tiles/raster.ts
export type Slice = { left(): number; next(): Promise<void> };
/**
 * Draws the elements meeting `tile` onto a 512px canvas, at its level's
 * scale, in scene order, stopping whenever `slice` runs out. Null when
 * nothing reaches in. Uses no element bitmaps, so it never evicts the
 * static canvas's (#187).
 */
export const rasterTile = (
  scene: Scene, tile: TileId, look: TileLook, slice: Slice,
): Promise<HTMLCanvasElement | null> => { throw new Error("not implemented"); };
/** Everything a tile's pixels depend on besides its elements. */
export type TileLook = Pick<AppState, "theme" | "frameRendering"> & { canvasTheme: string };

// renderer/tiles/plan.ts
export type Layer = { key: TileKey | "seed"; rect: Bounds; alpha: number };
export type Plan = {
  layers: readonly Layer[];
  /** Share of the screen no tile covers, 0..1. */
  uncovered: number;
  /** Largest magnification of a shown tile. */
  overscale: number;
  fading: boolean;
};
export const planFrame = (
  camera: Camera, screen: Screen, tiles: readonly CachedTile[], seed: Seed | null, now: number,
): Plan => { throw new Error("not implemented"); };

// renderer/gpu/compositor.ts
export type Backdrop = { background: Rgba; grid: GridRows | null };
export interface Compositor {
  upload(key: TileKey | "seed", source: TexImageSource): WebGLTexture;
  drop(key: TileKey | "seed"): void;
  draw(plan: Plan, size: { width: number; height: number }, backdrop: Backdrop): void;
  /** Null when lost; tiles are gone and the cache must drop them. */
  ready(): boolean;
  dispose(): void;
}
/** Null without a GPU (software rendering): navigation stays on the static canvas. */
export const createCompositor = (
  canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void,
): Compositor | null => { throw new Error("not implemented"); };

// components/App.navigation.ts
/** Why the camera is held. Each source releases its own hold. */
export type Hold = "pan" | "wheel" | "touch" | "gesture" | "flight";

export class AppNavigation {
  constructor(app: App, deps: { getStaticCanvas: () => HTMLCanvasElement | null }) {}
  /** Called by AppPan, AppWheel, the touch tracker and animateToViewport. Idempotent per hold. */
  hold(hold: Hold): void { throw new Error("not implemented"); }
  release(hold: Hold): void { throw new Error("not implemented"); }
  /** Called from translate and setState of the camera: draw this frame from tiles. */
  cameraChanged(): void { throw new Error("not implemented"); }
  /** A pointerdown that is not navigation, a key, an edit: hand over now. */
  settleNow(): void { throw new Error("not implemented"); }
  /** The static canvas skips its redraw while this is true. */
  get compositing(): boolean { throw new Error("not implemented"); }
  /** StaticCanvas's onPainted: hide the compositor in this frame if the camera matches. */
  painted(camera: Camera): void { throw new Error("not implemented"); }
  onScene(changed: readonly ExcalidrawElement[], before: ReadonlyMap<string, Bounds>): void { throw new Error("not implemented"); }
  destroy(): void { throw new Error("not implemented"); }
}
```

The one public surface for hosts is a prop and an API method:

```tsx
<Excalidraw gpuNavigation />            // temporary opt-in, removed in the last PR
api.isNavigating(): boolean              // draw's ink layer asks this instead of view.moving()
```

## Inputs

Each input holds the camera while it runs and releases it when it ends. The compositor engages on the first camera change under a hold, and on any camera change at all (a programmatic `setState` of the scroll, collab follow) when tiles cover the view.

| Input | Where | Hold starts | Hold ends |
| --- | --- | --- | --- |
| Wheel, ctrl+wheel (trackpad pinch) | `AppWheel` | first tick | `ZOOM_SETTLE_TIMEOUT` after the last tick |
| Hand tool, space+drag, middle drag, right drag, view mode | `AppPan.start` | session start (right drag: once past the threshold) | session teardown |
| Two-finger touch | touch tracker (below) | second finger down | fewer than two fingers |
| Safari `gesturestart`/`gestureend` | `App.onGesture*` | gesturestart | gestureend |
| `scrollToContent`, `setViewport`, frame navigation, snap-back | `animateToViewport` | animation start | animation end or cancel |

Two-finger touch moves to a tracker that listens on `app.ownerWindow` in the capture phase, as draw's view layer does. Draw's ink layer stops both fingers of a pinch from reaching the canvas; a window-capture listener still sees them. The tracker drops a pointer on `pointercancel`, `lostpointercapture`, `blur` and `visibilitychange`, so a missed lift cannot leave a ghost finger that turns the next one-finger drag into a pinch (draw#275). It also takes draw's anchored pinch maths (`pinchStart`/`pinchMove` from `camera.ts`): the board point under the fingers' centre stays under it. The fork's incremental pinch drifts. Pinch always zooms, pen mode included, as draw's does.

## Hand-over

Today draw waits 1.2 s of stillness before the editor rebuilds sharp, because the rebuild used to cost hundreds of ms. Inside the fork:

1. The last hold is released. After `SETTLE_MS` with no camera change, `AppNavigation` clears `compositing` and the static canvas draws at the final camera, with #188's budget (24 new bitmaps or 8 ms, the rest drawn directly).
2. The compositor stays on screen, unchanged, until `onPainted` reports a frame for that same camera (#123). Then it hides in the same frame. No fade, no timer.
3. If a hold starts before that, the paint is dropped and the compositor carries on.

`SETTLE_MS` starts at 150 ms for a pan (the static canvas reuses its bitmaps at the same zoom) and is measured, not assumed, for a zoom (#374; draw#112 stalled pans when it handed back too soon). Both draw from one `canvasSize` function and one camera, so the swap cannot shift the board by the camera maths (draw#91). The remaining sub-pixel shift is in the bitmap path (draw#191, fork #182) and is fixed there.

A pointerdown that starts something other than navigation, a key that is not a modifier, or a local edit calls `settleNow()`: the static canvas draws at once and the compositor hides when it is painted.

## Tiles

### Drawing a tile

`rasterTile` replaces draw's `export.ts`. It runs the static scene's element loop with a tile's viewport (scroll at the tile's corner, zoom `2^level / dpr`, 512 px) and draws every element directly. That removes, compared with draw:

- `exportToCanvas`, `restoreElements: false`, frameless copies of framed elements and the per-chunk canvases laid over each other: the loop draws onto one canvas and can stop between any two elements.
- Per-element bitmaps for tiles, which evicted the static canvas's own (#187).
- Frame names on tiles (`drawNames`, `nameOpacity`): names are DOM and follow `AppState` live while moving. Frame outlines stay on tiles.

Freedraw shapes are cached per element and version in the fork, so a stroke is traced once for every tile and the static canvas. The scheduler shapes the strokes under the floor between frames when a hold starts, as draw's `shapeAhead` does.

### Pyramid

Kept from draw: 512 px tiles at power-of-two densities (levels -8 to 24, deep enough for 1,000,000x on a 2x screen), wanted in rings around the view, a floor 4 levels coarser and 10 views wide. Added:

- **Best available (#117).** Where the view's level has no tile, draw loaded tiles up to 3 levels sharper, then coarser ones up to the floor. The floor under the view is pinned and never evicted.
- **Overscale cap (#119).** A tile is not shown more than 2x magnified while a sharper one is loaded or being drawn; the next sharper level is wanted at `soon` priority.
- **Fade (#118).** Draw's 150 ms per-tile fade-in moves over. A shader cross-fade with the parent is measured in PR 3, not assumed.
- **Seed.** When a hold starts, the static canvas's last frame is uploaded as one more layer at its own density, so the first frames are sharp where tiles are not drawn yet. Draw feathered its edges because its snapshot and tiles came from different code and drifted apart. Here both come from the same renderer and camera, so the seed is a plain layer in the best-available order.

### What shows where no tile is drawn

The compositor paints the board background and grid every frame at the live camera, so an area with no tile shows the empty board, never a hole or a stretched snapshot. With best-available and a pinned floor, that only happens on a cold open. The compositor only engages when tiles and the seed cover at least the view; otherwise the static canvas keeps drawing (with #188's budget) until they do.

### Memory

A tile is 512 x 512 x 4 bytes, 1.33 MiB with mipmaps. The budget is in bytes, not tiles (#120):

- `navigator.deviceMemory <= 4` (most phones): 96 MiB, about 72 tiles.
- Otherwise: 192 MiB, about 144 tiles.

Evicted least recently used within the lowest priority first. The pinned floor counts against the budget. Draw's budget today is 160 tiles (about 213 MiB) for a 1440x960 screen at 2x, and about 100 tiles on a phone.

### Invalidation

Agents write through the MCP and their edits arrive as remote scene updates. These must be cheap and show fast.

| Change | What happens |
| --- | --- |
| Local edit, remote edit, agent edit | `Scene.onUpdate`: compare each element's version with the last seen one (one number per element). Changed elements dirty their old and new bounds, grown by paint extent and a frame's name reach. Tiles under them go stale and keep showing until redrawn. Stale tiles in view get `now` priority. |
| Edit while still | The static canvas already shows it this frame. Tiles redraw in idle time. |
| Edit while moving | Stale tiles in view redraw between frames in 6 ms slices, so an agent's write appears mid-gesture within a few frames. |
| Image arrives (`imageCache` filled) | Elements with that `fileId` dirty their bounds. |
| Fonts finish loading | `dropAll`. |
| Light/dark, frame rendering, board theme canvas | `dropAll`. The background and grid are drawn by the compositor and change at once. |
| WebGL context lost | Compositor hides, holds end, static canvas draws. On restore, `dropAll` and refill. |

The version compare is the cost draw pays today on every change: under 0.1 ms for 5,000 elements. A store-delta source would avoid it but does not see every remote path; measure before adding one.

## Without a GPU

`createCompositor` returns null when the context is software-rendered or missing, as draw's does. Then `compositing` is always false and navigation is today's: the static canvas redraws each frame, with stretched bitmaps during zoom and #188's budget at the sharp frame. When the context is lost mid-gesture, the static canvas takes over at the current camera, which is already in `AppState`.

## What draw deletes

Everything in `frontend/src/board/view/` goes. The fork owns the camera, so draw no longer mirrors it, hands it back, or waits for it.

| Draw | Fate | Why |
| --- | --- | --- |
| `camera.ts` wheel maths, `zoomAbout`, `normalizeZoom` | deleted | The fork's own `getViewportForZoom` is the camera. |
| `camera.ts` anchored pinch | moved | Into the fork's touch tracker. |
| `camera.ts` lift guard (`?pinchguard=1`) | deleted | An experiment that never became the default. |
| `placeSnapshot`, `coverage`, snapshot feather | deleted | The seed is an ordinary layer. |
| `view.ts` commit, `handBack`, `polish`, `POLISH_MS`, `sharpAt`, `snappedSoft` | deleted | No camera to hand back; hand-over waits for `onPainted`. |
| `view.ts` window listeners for wheel and touch, `onCanvas` | deleted | `AppWheel` and the touch tracker already take them. |
| `view.ts` idle pump, `nextTask`, `idleFrom` | moved | Into `scheduler.ts`. |
| `canvasThemeOf`, `boardPaint`, `boardGrid` | deleted | Copies of the fork's own theme and grid rules ("change them together"). |
| `export.ts` `tileFrom`, `snapshotFrom`, `drawNames`, `laid`, `chunking` | deleted | `rasterTile` draws in the fork's loop; names are DOM. |
| `export.ts` `tileElements` overlap test | measured | Only ported if `bench/tile-tasks.mjs` shows box culling draws too much. |
| `frame.ts`, `tiles.ts`, `gl.ts`, `grid.ts` | moved | Into `plan.ts`, `pyramid.ts`, `compositor.ts`. |
| `readout.ts` | deleted | The fork's zoom readout follows `AppState`, which now updates live. |

Callers in draw: `Board.tsx` (attach), the ink layer (`paused`, `pinchable` read `api.isNavigating()` and the compositor's readiness), `bench/harness/main.tsx`, `bench/parity.mjs`, `bench/tile.mjs`, and e2e specs that read view-layer internals (`frame-tiles`, `theme-zoom`, `zoom-colours`). They migrate in the same draw PR that deletes `view/`. No adapter stays behind.

## Perf gate

Nothing may get measurably slower. Each PR reports before and after on the same machine with load recorded (`uptime`) and contended runs thrown away, as the tile issues ask.

- **Fork CI `perf` job** (`perf-bench/run.mjs`, `playground/bench/scenarios.ts`): pan and zoom on `mixed`, `freedraw`, `deep`, `big`, `huge`, `file`. Today it is `continue-on-error`. A small CI PR gives it a pass/fail rule (frame p95 and long-task total within noise of master) before any navigation PR lands. `deep/zoom` (#134: 1.3 s frames) should fall sharply once wheel goes through the compositor.
- **Fork `perf-bench/parity.mjs`**: tile pixels against the static canvas at the same camera.
- **Draw `bench/pinch.mjs`**: anchor drift, frame jumps, rebuild-shift (under 0.5 CSS px at 1x, 100x, 10,000x; draw#91), frame times, with `--tool hand` for one-finger pans.
- **Draw `bench/tile-tasks.mjs`**: the longest main-thread task tile drawing causes, cold and warm, phone and desktop, with `--pinch`. Must stay at or under today's.
- **Draw `bench/flight.mjs`, `bench/dive.mjs`, `bench/zoom-out.mjs`**: flights, 1x to 1,000,000x and back, zoom-out frames.
- **Real phone.** The owner's phone runs Android Firefox. Emulated touch has passed gestures that failed on it (draw#89). Every PR that changes a gesture (PRs 5 and 6, and 8 in draw) gets a check on that phone before merge: one-finger pan, two-finger pinch, a squeeze out, the hand-over, and draw#275's 20 messy round trips. Draw's `page-zoom` and `phone-pinch` e2e specs run in Firefox and Chromium as well.

## PRs

Each merges on its own and leaves master shippable. `gpuNavigation` keeps the fork's compositor off in draw until draw deletes its own layer, so a fork release installed into draw meanwhile (another session's work installs them) never runs two GPU layers and two tile caches at once.

| # | Repo | PR | Issues | Gate |
| --- | --- | --- | --- | --- |
| 0 | fork | This design | #198 | review |
| 1 | fork | `ci`: perf job becomes a gate | | perf job red on a planted slowdown |
| 2 | fork | `pyramid.ts` + `plan.ts`, pure, with draw's tests ported; best available, overscale cap, fade | #117 #118 #119 | unit tests |
| 3 | fork | `rasterTile`: sliced, direct draw, no element bitmaps | #187 | `parity.mjs`; draw's `tile-tasks.mjs` with draw's `tile()` pointed at it (draw-side one-line swap) |
| 4 | fork | cache + scheduler: byte budget, bins, cancel, velocity prefetch, invalidation | #120 | unit tests; idle-task bench |
| 5 | fork | compositor + `AppNavigation` + wheel and trackpad, behind `gpuNavigation`; atomic hand-over | #134 #123 #374 draw#91 | perf job, `pinch.mjs` rebuild-shift, desktop Firefox and Chromium |
| 6 | fork | `AppPan` holds: hand tool, space, middle and right drag, view mode | | perf job, real phone |
| 7 | fork | touch tracker on window capture, anchored pinch, ghost-pointer cleanup; Safari gesture holds | draw#275 | `pinch.mjs`, real phone, 20 round trips |
| 8 | fork | flights: `animateToViewport` holds | | `flight.mjs`, `dive.mjs` |
| 9 | draw | bump the fork, set `gpuNavigation`, migrate callers, delete `view/` | | every bench above, real phone |
| 10 | fork | delete the `gpuNavigation` prop; on wherever a GPU is | | perf job |

Later, each on its own measurements:

- #122 level of detail for coarse tiles: after PR 4, once the cross-fade is measured.
- #124 tiles in a Worker on OffscreenCanvas: a spike after PR 3. `rasterTile` takes a scene and a slice so a worker could run it, but fonts, images and text measurement still need the DOM.
- #125 GPU vector rendering: not in this series. The compositor's `Layer` is where a vector renderer would plug in.
- draw#53 (a whole-board open does not fit at 100x): not in this series. It is about loading and holding elements, not drawing them.
- draw#191 and fork #182 (bitmap sub-pixel phase): fixed in the bitmap path, ideally before PR 5 so the hand-over is invisible.

Draw PR 9 touches `Board.tsx`, the ink layer, the bench harness and e2e specs. Draw's Unify series (#460 to #464) is live in another session and also installs fork releases. PR 9 waits for that series to free `Board.tsx`, or merges `main` into its branch, and is the only draw PR that sets `gpuNavigation`.

## Risks

- **Hand-over cost on a phone.** Without the 1.2 s wait, a short pause mid-navigation hands over and redraws. If the redraw at a new zoom costs 100 ms on the phone, resuming feels like a hitch. #188's budget and a measured `SETTLE_MS` are the defence; PR 5 measures it before PR 6 extends it to one-finger pans.
- **Touch on Android Firefox.** Moving two-finger tracking to window capture changes when the fork sees fingers relative to draw's ink layer. Only the real phone can prove it.
- **Texture uploads on Firefox.** #124 notes slow paths there. Measure `texImage2D` of a 512 px canvas on the phone in PR 5.

## Open questions

1. Is 96 MiB of tiles on a phone acceptable, or should it be lower?
2. Should pinch zoom in pen mode for everyone using the fork (draw's behaviour), or only behind a prop?
3. Drop `?pinchguard=1` rather than port it?
4. Should the fork's own app (excalidraw-app) get GPU navigation from PR 10, or stay on the static path?
