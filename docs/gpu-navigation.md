# GPU navigation

Status: design. No code yet. Part of #198.

Every pan and zoom should draw from tiles the GPU already holds, instead of redrawing the scene each frame. Draw (redaphid/draw) has this today for wheel and two-finger pinch, in a layer outside the editor (`frontend/src/board/view/`, 2,344 lines plus tests). One-finger hand-tool pans still go through the editor, which redraws every frame. This doc moves the layer into the fork, where it becomes the renderer while the camera moves, and deletes the parts that only existed because it lived outside.

## What changes for a person

- One finger with the hand tool, space+drag, middle and right drag, and view mode pan as smoothly as a pinch does now.
- Wheel, trackpad pinch, two-finger touch, flights (`scrollToContent`, frame links), snap-back and follow mode all take the same path.
- After a gesture, the sharp picture replaces the tiles in one frame, once it is painted. Draw's 1.2 s wait goes.
- Selection, collaborator cursors and frame names stay on screen while moving. Draw's layer covers them today.

## How it works

```
                              every StaticCanvas render
                                        │
                          only the camera moved?
                         ┌──────────────┴──────────────┐
                        yes                            no (edit, resize, theme, still)
                         │                              │
              compositor draws tiles            renderStaticScene, sharp
              at the new camera                 (#188 caps new bitmaps)
                                                        │
                                       onPainted for the current camera
                                                        │
                                              compositor hides, same frame
```

The camera stays in `AppState` and every input keeps updating it as now. The fork's inputs (`AppPan`, `AppWheel`, two-finger touch, Safari gesture events) end in `AppViewport.translate`, and flights, snap-back, follow mode and the initial viewport set the camera directly. Every one of them re-renders `StaticCanvas`. So the compositor hooks in at one place, the paint, and needs no wiring per input:

```ts
// StaticCanvas effect, before renderStaticScene
if (compositor?.frame(input) === "composite") return; // the GPU drew this camera
renderStaticScene(...);
```

`frame()` composites when nothing but the camera changed since the last sharp paint, and no element is being created, dragged, resized or edited. Anything else paints, as today. When the camera has been still for `SETTLE_MS`, the compositor asks for a paint. The static canvas paints sharp, and `onPainted` with a matching camera, size, look and scene is the only thing that hides the compositor (#123). No timer or input handler can hide it, so a missed path leaves tiles on screen a little longer, never a wrong picture.

The compositor canvas sits between the static and interactive canvases. Draw's had to cover everything.

## Modules

| Fork file | From draw | What it does |
| --- | --- | --- |
| `excalidraw/renderer/compositor/index.ts` | `view.ts` (part) | `createCompositor`: `frame`, `painted`, owns the rest. |
| `.../compositor/phase.ts` | `view.ts` (part) | Pure state machine: who draws, when to settle, when to hide. |
| `.../compositor/pyramid.ts` | `tiles.ts`, `rect.ts` | Levels, tile rects, wanted tiles by priority, evictions. Pure. |
| `.../compositor/plan.ts` | `frame.ts` | Layers of one frame: best available (#117), overscale cap (#119), fade-in (#118). Pure. |
| `.../compositor/store.ts` | tile map and diff in `view.ts` | Tiles, bytes, staleness, invalidation from the scene. |
| `.../compositor/scheduler.ts` | idle pump in `view.ts` | Idle slices, priority bins, byte budget, cancelling, prefetch (#120). |
| `.../compositor/paintTile.ts` | replaces `export.ts` | One tile, the fork's own element renderer, direct draw, in slices. |
| `.../compositor/gl.ts` | `gl.ts`, `grid.ts` | WebGL2: backdrop, grid, textured quads, context loss. |
| `excalidraw/components/canvases/StaticCanvas.tsx` |  | Calls `frame()`; sizes the compositor canvas in its own sizing loop. |
| `excalidraw/components/App.tsx` (two-finger handler) | `camera.ts` pinch | Anchored pinch, ghost-pointer cleanup, `takeOverPinch`. |
| `element/src/Scene.ts` |  | `repaint(elements)`: fonts and images, which change pixels without a version bump. |

## Types

```ts
// renderer/compositor/index.ts
export type Camera = Readonly<{
  zoom: number;
  scrollX: number;
  scrollY: number;
}>;
export type Size = Readonly<{ width: number; height: number; dpr: number }>;
/** Everything a tile's pixels depend on besides its elements. Derived, never stored by callers. */
export type LookKey = string & { readonly __brand: "LookKey" };
/** What the static canvas shows. Only onPainted produces one. */
export type Painted = Readonly<{
  camera: Camera;
  size: Size;
  look: LookKey;
  nonce: string;
}>;

export type FrameInput = Readonly<{
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
  scale: number;
  elementsMap: RenderableElementsMap;
  sceneNonce: string;
}>;
export type Decision = "composite" | "paint";

export type Compositor = {
  /** Every StaticCanvas render. Draws on the GPU when it answers "composite". */
  frame(input: FrameInput): Decision;
  /** The static canvas finished a paint for `input`. The only thing that hides the compositor. */
  painted(input: FrameInput): void;
  /** Asks StaticCanvas for a paint no prop change would cause (settle, context lost). */
  subscribe(cb: () => void): () => void;
  isNavigating(): boolean;
  destroy(): void;
};
/** Null without hardware WebGL2: App runs today's path. */
export const createCompositor = (host: {
  ownerWindow: Window;
  scene: Scene;
}): Compositor | null => {
  throw new Error("not implemented");
};

// renderer/compositor/phase.ts (pure; every transition tested without GL)
export type Phase =
  | { kind: "idle"; sharp: Painted }
  | { kind: "covering"; sharp: Painted; shown: Camera; movedAt: number }
  | { kind: "settling"; shown: Camera }
  | { kind: "lost"; sharp: Painted | null };
export type Effect =
  | { kind: "seed" } // upload the static canvas's last sharp frame as a layer
  | { kind: "draw"; camera: Camera }
  | { kind: "show" }
  | { kind: "hide" }
  | { kind: "requestPaint" }
  | { kind: "armSettle"; at: number };
export const step = (
  phase: Phase,
  event:
    | { kind: "frame"; target: Painted; navigationOnly: boolean; now: number }
    | { kind: "painted"; painted: Painted }
    | { kind: "settleDue"; now: number }
    | { kind: "lost" }
    | { kind: "restored" },
): { phase: Phase; decision: Decision; effects: readonly Effect[] } => {
  // frame: lost, !navigationOnly, or size/look differ from sharp -> paint
  //        idle, camera unchanged -> paint (the normal edit path)
  //        idle, camera moved -> covering; seed, draw, show (draw before show)
  //        covering -> draw; armSettle(now + SETTLE_MS)
  //        settling, camera moved -> covering
  // settleDue: covering and still -> settling; requestPaint
  // painted: matches the target -> idle; hide. Otherwise sharp = painted.
  throw new Error("not implemented");
};

// renderer/compositor/pyramid.ts
export type Tile = Readonly<{ level: number; col: number; row: number }>;
export type TileKey = string & { readonly __brand: "TileKey" };
export type Wanted = Readonly<{
  tile: Tile;
  priority: "now" | "soon" | "eventually";
}>;
/** Nearest first; nothing outside the scene's bounds. */
export const wantedTiles = (
  c: Camera,
  size: Size,
  sceneBounds: Bounds | null,
  velocity: Camera,
): readonly Wanted[] => {
  throw new Error("not implemented");
};

// renderer/compositor/store.ts
export type Seq = number & { readonly __brand: "Seq" };
export type TileEntry = Readonly<{
  tile: Tile;
  /** null: drawn, and nothing reaches into it. Costs no texture. */
  texture: WebGLTexture | null;
  bytes: number;
  /** The scene seq its drawing started at. */
  drawnAt: Seq;
  stale: boolean;
  used: number;
  arrived: number;
}>;
/** At most once per frame or scheduler tick: if sceneNonce moved, diff versions and repaints into dirty boxes. */
export const observe = (
  store: TileStore,
  scene: Scene,
  look: LookKey,
): readonly Bounds[] => {
  throw new Error("not implemented");
};

// renderer/compositor/paintTile.ts
export type Slice = { left(): number; next(): Promise<void> };
/**
 * Draws the elements meeting `tile` on a 512 px canvas in scene order with
 * the fork's element renderer, drawing each directly: no element bitmaps,
 * so it never evicts the static canvas's (#187). Stops between elements
 * when the slice runs out.
 */
export const paintTile = (
  scene: Scene,
  tile: Tile,
  look: LookKey,
  slice: Slice,
): Promise<HTMLCanvasElement | null> => {
  throw new Error("not implemented");
};
```

Public surface for hosts:

```tsx
<Excalidraw gpuNavigation />   // opt-in until draw migrates (PR 7), deleted in PR 8
api.isNavigating(): boolean   // draw's ink layer asks this instead of view.moving()
api.takeOverPinch(pointers)   // the ink layer hands a pinch's two fingers to the fork
```

## Inputs

No input is wired to the compositor; each only changes the camera, as now. Three input changes come with the move:

- **Anchored pinch.** Draw's `pinchStart`/`pinchMove` replace the fork's incremental pinch: the board point under the fingers' centre stays under it. The fork's pinch drifts. Pinch always zooms, pen mode included, as draw's does.
- **`takeOverPinch`.** Draw's ink layer hides a pinch's fingers from the editor, because the first finger was a stroke. It hands both pointers to the fork's two-finger handler, which then owns them.
- **Ghost pointers.** The two-finger handler drops a pointer on `pointercancel`, `lostpointercapture`, `blur` and `visibilitychange`, so a missed lift cannot pair with the next finger into a pinch (draw#275).

| Input | Today in the fork | After |
| --- | --- | --- |
| Hand tool, space+drag, middle drag, right drag, view mode | redraws each frame | composites |
| Wheel, ctrl+wheel (trackpad) | stretched bitmaps, settle redraws (#134) | composites |
| Two fingers, Safari gesture events | stretched bitmaps | composites, anchored |
| `scrollToContent`, `setViewport`, frame links, snap-back, follow | redraws each frame | composites |

## Hand-over

1. While moving, the static canvas keeps its last sharp paint. It is uploaded once as the seed layer when moving starts, so the first frames are sharp where no tile is drawn yet.
2. After `SETTLE_MS` of stillness the phase becomes `settling` and the static canvas paints sharp, with #188's caps (24 new bitmaps or 8 ms, the rest drawn directly).
3. When `onPainted` reports that camera, the compositor hides in the same frame. No fade: tiles come from the same renderer as the sharp paint, so they match. A fade comes back only if `parity.mjs` shows they do not.
4. If the camera moves before then, the phase goes back to `covering`.

`SETTLE_MS` starts at 400 ms and is tuned on the benches (#374). It must exceed `ZOOM_SETTLE_TIMEOUT` (100 ms) plus a frame, so the sharp paint is not a stretched one. Draw#112 handed back early and stalled pans after a zoom; PR 5 measures that case before the value is set. The compositor canvas is sized in StaticCanvas's own sizing loop, so the two cannot disagree by a pixel (draw#91). The rest of the sub-pixel shift is in the bitmap path (draw#191, fork #182) and is fixed there.

## Tiles

### Drawing one

`paintTile` replaces draw's `export.ts`. It runs the fork's element renderer over the tile's elements with the tile's transform and draws each directly. Gone, compared with draw: `exportToCanvas`, `restoreElements: false`, frameless copies of framed elements, chunk canvases laid over each other, per-element bitmaps for tiles (#187), and frame names on tiles (names are DOM and follow `AppState` live). Frame outlines stay on tiles. Freedraw shapes are cached per element and version, so a stroke is traced once for all tiles and the static canvas; strokes under the floor are shaped between frames when moving starts, as draw's `shapeAhead` does.

Draw's `tileElements` ink-overlap test is not ported up front. If `bench/tile-tasks.mjs` shows box culling draws too much, a spatial index over element bounds comes first, which also answers empty tiles without painting.

### Pyramid

Kept from draw: 512 px tiles at power-of-two densities (levels -8 to 24, enough for 1,000,000x on a 2x screen), rings around the view, a floor 4 levels coarser and 10 views wide. Added:

- **Best available (#117).** Where the view's level has no tile, loaded tiles up to 3 levels sharper, then coarser ones down to the floor. The floor under the view is never evicted.
- **Overscale cap (#119).** No tile shows more than 2x magnified while a sharper one is loaded or drawing; the next sharper level is wanted at `soon`.
- **Fade-in (#118).** Draw's 150 ms per-tile fade moves over. A shader cross-fade with the parent is measured, not assumed.
- **Scene bounds.** No tile is wanted outside them. Empty tiles store no texture.

### Where no tile is drawn

The compositor paints the board background and grid every frame at the live camera. An area with no tile shows the empty board, never a hole. With best available and the pinned floor, that only happens on a cold open.

### Memory

A tile is 512 x 512 x 4 bytes, 1.33 MiB with mipmaps. The budget is bytes, not tiles (#120): 96 MiB where `navigator.deviceMemory <= 4` (about 72 tiles), 192 MiB otherwise (about 144). Least recently used goes first within the lowest priority. Draw keeps about 160 tiles (213 MiB) on a 1440x960 2x screen today, and about 100 (133 MiB) on a phone.

### Invalidation

Agents write through the MCP and their edits arrive as remote scene updates, so this path must be cheap and show fast.

| Change | What happens |
| --- | --- |
| Local, remote or agent edit | `observe`: when `sceneNonce` moved, compare each element's version with the last seen (one number per element, under 0.1 ms for 5,000). Changed elements dirty their old and new bounds, grown by paint extent and frame-name reach. Tiles under them go stale and keep showing until redrawn; stale tiles in view get `now`. |
| Edit while still | The static canvas shows it this frame. Tiles redraw in idle time. |
| Edit while moving | Stale tiles in view redraw between frames in 6 ms slices. An agent's write appears within a few frames. |
| Tile finishes after an edit | It uploads anyway. It is stale only if an edit since it started (`drawnAt`) touches it. Draw drops every tile in flight on any change, which starves tiles while agents stream edits. |
| Font loads, image arrives | Both repaint today without a version bump (`ShapeCache.delete` plus `triggerUpdate`), so draw's tiles miss them. `Scene.repaint(elements)` records them and `observe` dirties their bounds. |
| Light or dark, frame rendering, board theme | New `LookKey`: every tile goes. Background and grid change at once. |
| WebGL context lost | Phase `lost`: the static canvas paints. On restore every tile is redrawn. |

## Without a GPU

`createCompositor` returns null for software or missing WebGL2, as draw's does, and App runs exactly today's path: the static canvas redraws, stretched during zoom, with #188's caps. A context lost mid-gesture paints the static canvas at the current camera, which is already in `AppState`.

## What draw deletes

All of `frontend/src/board/view/`.

| Draw | Fate | Why |
| --- | --- | --- |
| `camera.ts` wheel maths, `zoomAbout`, `normalizeZoom` | deleted | The fork's camera is the camera. |
| `camera.ts` anchored pinch | moved | Into the fork's two-finger handler. |
| `camera.ts` lift guard (`?pinchguard=1`) | deleted | An experiment that never became the default. |
| `placeSnapshot`, `coverage`, snapshot feather | deleted | The seed is a plain layer from the same renderer. |
| `view.ts` commit, `handBack`, `polish`, `POLISH_MS`, `sharpAt` | deleted | Nothing to hand back; `onPainted` decides. |
| `view.ts` window listeners, `onCanvas`, `busy` | deleted | The fork's own inputs move the camera. |
| `view.ts` idle pump, `nextTask`, `idleFrom` | moved | `scheduler.ts`. |
| `canvasThemeOf`, `boardPaint`, `boardGrid` | deleted | Copies of the fork's theme and grid rules. |
| `export.ts` | deleted | `paintTile`; names are DOM. |
| `frame.ts`, `tiles.ts`, `gl.ts`, `grid.ts` | moved | `plan.ts`, `pyramid.ts`, `gl.ts`. |
| `readout.ts` | deleted | The zoom readout follows `AppState`, live. |

About 1,100 lines move and 1,250 go (estimate). Draw's callers: `Board.tsx`, the ink layer (`paused` and `pinchable` become `api.isNavigating()` and `takeOverPinch`), `bench/harness/main.tsx`, `bench/parity.mjs`, `bench/tile.mjs`, and e2e specs that read view internals (`frame-tiles`, `theme-zoom`, `zoom-colours`). They migrate in the draw PR that deletes `view/`. No adapter stays.

## Perf gate

Nothing may get measurably slower. Each PR reports before and after on one machine, load recorded (`uptime`), contended runs thrown away.

- **Fork CI `perf` job** (`perf-bench/run.mjs`, `playground/bench/scenarios.ts`): pan and zoom on `mixed`, `freedraw`, `deep`, `big`, `huge`, `file`. It is `continue-on-error` today; PR 1 gives it a pass/fail rule. `deep/zoom` (#134, 1.3 s frames) should fall sharply in PR 5.
- **Fork `perf-bench/parity.mjs`**: tile pixels against the sharp paint.
- **Draw `bench/pinch.mjs`**: anchor drift, frame jumps, rebuild-shift (under 0.5 CSS px at 1x, 100x and 10,000x), frame times; `--tool hand` for one-finger pans.
- **Draw `bench/tile-tasks.mjs`**: longest main-thread task from tile drawing, cold and warm, phone and desktop, `--pinch`. At or under today's.
- **Draw `bench/flight.mjs`, `dive.mjs`, `zoom-out.mjs`**: flights, 1x to 1,000,000x and back, zoom-out frames.
- **Real phone.** The owner's phone runs Android Firefox, and emulated touch has passed gestures that failed on it (draw#89). PRs 5, 6 and 7 get a check on that phone before merge, on a draw preview build with the fork's tarball: one-finger pan, pinch, a squeeze out, the hand-over, and draw#275's 20 messy round trips. Draw's `page-zoom` and `phone-pinch` e2e specs run in Firefox and Chromium too.

## PRs

Each merges on its own and leaves master shippable. Until draw migrates, the fork's compositor stays off in draw (`gpuNavigation` unset), so a fork release installed into draw meanwhile never runs two GPU layers and two tile stores.

| # | Repo | PR | Issues | Gate |
| --- | --- | --- | --- | --- |
| 0 | fork | This design | #198 | review |
| 1 | fork | `ci`: the perf job becomes a gate |  | goes red on a planted slowdown |
| 2 | fork | `pyramid.ts`, `plan.ts`, `phase.ts`: pure, draw's tests ported | #117 #118 #119 | unit tests |
| 3 | fork | `paintTile`, sliced, direct draw | #187 | `parity.mjs`; draw's `tile-tasks.mjs` with draw's `tile()` pointed at it |
| 4 | fork | `store.ts`, `scheduler.ts`, `Scene.repaint` | #120 | unit tests; idle-task bench |
| 5 | fork | `gl.ts`, `createCompositor`, the StaticCanvas hook, behind `gpuNavigation` | #134 #123 #374 draw#91 | perf job, `pinch.mjs`, `flight.mjs`, real phone |
| 6 | fork | Two fingers: anchored pinch, ghost-pointer cleanup, `takeOverPinch` | draw#275 | `pinch.mjs`, real phone, 20 round trips |
| 7 | draw | Bump the fork, set `gpuNavigation`, migrate callers, delete `view/` |  | every bench above, real phone |
| 8 | fork | Delete the `gpuNavigation` prop: on wherever a GPU is |  | perf job |

Later, each on its own numbers:

- #122 level of detail for coarse tiles: after PR 5, once the fade is measured.
- #124 tiles in a Worker on OffscreenCanvas: a spike after PR 3. `paintTile` takes a scene and a slice, but fonts, images and text measuring still need the DOM.
- #125 GPU vector rendering: not in this series. A layer in `plan.ts` is where a vector renderer would plug in.
- draw#53 (a whole-board open does not fit at 100x): not in this series. It is about loading and holding elements, not drawing them.
- draw#191, fork #182 (bitmap sub-pixel phase): fixed in the bitmap path, ideally before PR 5 so the hand-over is invisible.

Draw PR 7 touches `Board.tsx`, the ink layer, the bench harness and e2e specs. Draw's Unify series (#460 to #464) is live in another session and also installs fork releases. PR 7 merges draw's `main` in before it lands, and it is the only draw PR that sets `gpuNavigation`. Fork bumps by that session stay safe because the prop is off.

## Risks

- **React per frame.** The camera stays in `AppState`, so every moving frame still renders App, LayerUI and the interactive canvas, and computes visible elements. Draw's layer skipped all of that with a camera of its own. The fork pays it today on every pan anyway, so fork pans only get faster; draw's pinch and wheel could get slower on the phone. PR 5 measures `pinch.mjs` frame times on the phone against draw today. If it loses, the fallback is candidate B's frozen camera: the compositor steers its own camera while `covering` and commits to `AppState` once at settle.
- **Hand-over cost on the phone.** A pause mid-navigation now settles and paints. If that paint at a new zoom costs 100 ms on the phone, resuming hitches. #188's caps and a measured `SETTLE_MS` are the defence.
- **Touch on Android Firefox.** `takeOverPinch` and the new pointer cleanup change who owns fingers. Only the real phone can prove it.
- **Texture uploads on Firefox.** #124 reports slow paths there. PR 5 measures `texImage2D` of a 512 px canvas on the phone.

## Design record

Three shapes were sketched.

- **Chosen: the paint decides.** One check in StaticCanvas: only the camera moved, so composite. No input wiring, every camera source covered, `AppState` stays the only camera. Costs a React render per frame.
- **Hook `translate` and holds per input.** The first sketch. Misses flights, snap-back, follow mode and the initial viewport, which set the camera without `translate`, and needs a hold and release at every input. Lost on coverage and surface.
- **A controller owns the camera during a gesture** (candidate B). Inputs call the controller, which steers, composites and commits once. No React per frame, which also fixes #134 at its root. Lost on two camera authorities mid-gesture: collab pointers, the zoom readout, `onScrollChange` and follow mode read `AppState` and would be wrong until the commit, and the audit for other readers was not finished. Kept as the fallback for the first risk.

From the candidates: the paint hook, `phase.ts`, per-tile staleness instead of draw's global epoch, `Scene.repaint` and `takeOverPinch` (A); the byte budget by device class and the spatial index for empty tiles (B).

## Open questions

1. Is 96 MiB of tiles on a phone acceptable, or lower?
2. Should pinch zoom in pen mode for everyone using the fork (draw's behaviour), or behind a prop?
3. Drop `?pinchguard=1` rather than port it?
4. Should the fork's own app (excalidraw-app) get GPU navigation from PR 8, or stay on the static path?
