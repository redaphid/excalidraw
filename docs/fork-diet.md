# What draw could cut from the fork, measured

Draw is this fork's main consumer. This page asks what draw could drop or specialise if the fork drifts further from upstream Excalidraw, and what each change would buy. Every number is marked MEASURED or ESTIMATE. Measurements were taken on 2026-11-18 against draw `main` (1716e35, fork v1.12.1) and fork `master` (eae8d992, v1.12.2).

## The short answer

Cutting features draw never calls buys little. Those features are small (each under 30 KB of eager code) and cost under 2% of the time of any interaction I profiled. The weight is elsewhere:

1. Draw's service worker precaches 26.4 MB, and 17.5 MB of it is never needed offline. That is a draw change with no fork drift.
2. Mermaid loads on every board open, though draw only needs it when an agent sends a Mermaid diagram. Making it lazy took 744 KB off the board's eager JavaScript and 656 ms off a cold open at 4x CPU throttle. It needs one fork import fixed (an upstream bug) and one draw import.
3. A few hot paths can be specialised for how draw uses the editor, without removing anything.

## Ranked plan

Gain is for draw. Drift is the merge cost against upstream: "none" means draw-only or fork-only code that upstream never touches.

### 1. Precache only what a board needs offline

`frontend/pwa.ts` precaches every built file. MEASURED, draw's production build, files listed in `sw.js`, maps excluded:

| Part | MB | Needed offline? |
| --- | --- | --- |
| Xiaolai CJK font, 209 files | 12.67 | Only for Chinese or Japanese text |
| ELK, two copies (Worker build and no-Worker fallback) | 2.88 | One copy, for arrange |
| Mermaid and its diagram chunks | ~2.7 | Yes, draw's Mermaid tool |
| Editor (fork core chunk) | 2.42 | Yes |
| Font subsetting WASM (HarfBuzz, woff2) | 1.82 | Only for SVG export from the menu |
| Locales other than English | 1.56 | No. Draw sets no `langCode` and shows no language picker |
| Everything else | ~2.4 | Mostly yes |

Leaving Xiaolai, the subsetting WASM, the locales and the ELK fallback to load on demand cuts the precache from 26.4 MB to about 8.9 MB (-66%). That is 17.5 MB less to download on a first visit and after every deploy, since each deploy gets a new cache.

- Drift: none (draw only).
- Loses: offline, CJK text falls back to a system font, and SVG export without a network fails to embed fonts. Online, nothing changes.
- Risk: low. A missed file shows up as a network fetch, not a failure.

### 2. Take Mermaid off the eager path

Two static imports pull `@excalidraw/mermaid-to-excalidraw`, and with it Mermaid's core, marked, DOMPurify, d3 and lodash, into the chunk every board loads:

- the fork's `components/TTDDialog/hooks/useTextGeneration.ts` imports `parseMermaidToExcalidraw` statically. The TTD dialog and `App.clipboard.ts` already use `import()`, so this one line defeats them. It is upstream code.
- draw's `frontend/src/board/tasks.ts` imports it statically for the agent Mermaid tool.

MEASURED A/B, with the package aliased to a stub (an upper bound for what a lazy import moves):

- Draw's board route, eager JS: 2,985,081 B to 2,240,962 B (-744 KB, -25%).
- Bench harness, cold load at 4x CPU throttle, 9 loads each, interleaved: time to editor ready 6,667 ms to 6,011 ms (median, -656 ms, -10%). Module evaluation fell in all 3 rounds (2,870, 3,015, 2,623 ms against 2,595, 2,414, 2,187 ms).
- Profile at 1x: Mermaid's module init costs 22-37 ms of main-thread time per load.

- Drift: about 3 lines in an upstream file, and the fix belongs upstream too, so the drift can go to zero.
- Loses: nothing. The first Mermaid diagram pays the load instead.

### 3. Drop ELK's no-Worker fallback

`arrange/elkLayout.ts` imports `elkjs/lib/elk.bundled.js` when it cannot start a Worker, and bundlers ship it beside the Worker build. Draw always has Workers. MEASURED: 1.44 MB of precache and deploy, never run in a browser.

- Drift: none (fork-only code). Keep the fallback reachable for tests through a separate entry.
- Loses: arrange in an environment without Workers.

### 4. Load the CJK font table on first use

`fonts/Xiaolai/index.ts` is a 113 KB unicode-range table in the eager chunk (MEASURED, esbuild metafile). `Fonts.init()` builds about 230 font faces at startup, 209 of them Xiaolai's. MEASURED: `ExcalidrawFontFace` construction costs 24-31 ms at 1x across all fonts. ESTIMATE: about 90% of that is Xiaolai, so roughly 20-28 ms at 1x and 90 ms at 4x.

- Drift: moderate. `Fonts.ts` is upstream code that changes.
- Loses: nothing if the table loads when text with CJK code points first appears.

### 5. Skip the scroll-container walk at mount

`App.componentDidMount` calls `getNearestScrollableContainer`, which walks up the DOM calling `getComputedStyle` and reading `scrollHeight`. MEASURED: 45, 55 and 69 ms of main thread across three cold loads at 1x, the hottest single fork function at load. Draw's board fills the page and never scrolls.

- Saving: ESTIMATE, below the measured cost. The walk forces style and layout early, and the browser would do part of that work before the first paint anyway. Needs an A/B before acting.
- Drift: small, a prop or a check in `App.tsx` (upstream).

### 6. Rebuild the frame model only when frames change

`AppFrameNavigation.model()` runs on every scene change. When the scene nonce moves it filters every element and joins an `id:version:versionNonce` string for frames and frame-to-frame arrows, so a drag pays an O(N) string build per pointer move. MEASURED (dev build of the fork, 600 shapes, 500 arrows, 20 frames): 181 ms of 2,411 ms of drag JS (7.5%).

- Drift: none (fork-only code). Track frame and arrow versions as `Scene` updates them.
- Draw uses `frameNavigation` (`usePresentation.tsx`), so this is a speedup of a used path, not a cut.

### 7. Cheaper remote updates

Each `updateScene` with a full element array runs `syncInvalidIndices` (validates every fractional index), rebuilds the element R-tree and diffs the store. MEASURED, 60 remote updates of about 30 elements each on the same scene: fractional indices 155 ms (11%), store 171 ms (12%), R-tree 217 ms (15%) of 1,420 ms. Production timing: about 18 ms per update (median of 3 runs).

- Specialisation: draw's Worker orders elements, so indices arrive valid. Checking only the changed elements, and updating the R-tree incrementally, would cut most of this. Upstream would likely take the incremental version.
- Drift: moderate to high (`element/src/Scene.ts`, `store.ts`). Risk: an invalid index slipping through reorders the scene. Needs tests before it ships.

### 8. Load MIDI only when `props.midi` is set

MIDI is 32 KB of eager code (MEASURED) behind `props.midi`, which draw never passes. ESTIMATE: about 10 ms at 4x. The fork's own app uses it, so make it lazy instead of cutting it.

- Drift: none (fork-only code).

## What not to cut

These are small, and people can reach them on a board, so cutting them buys a few KB for merge conflicts in upstream's busiest files. MEASURED eager bytes (minified, from an esbuild metafile of the fork):

- TTD and AI dialogs 149 KB (Mermaid's own bytes not included; see item 2 for the bigger win)
- library UI 30 KB, logo 29 KB, Stats 23 KB, elbow arrows 16 KB, charts paste 15 KB, bucket fill 16 KB
- command palette 10 KB, search 9 KB, help 9 KB, laser and trails 10 KB, welcome screen 4 KB

At runtime they barely register. MEASURED across hover, drag, remote update, zoom and select-all: i18n peaks at 19 ms of 1,420 ms, `HintViewer` at 8 ms, `Hyperlink` at 5 ms, and snapping, lasso, eraser and trails each stay under 2 ms. Per-interaction time goes to rendering, bounds, the R-tree, React and the store, which draw needs.

Load-bearing for draw, never candidates: shapes, arrows and binding, frames, text, sticky notes, `getElementBounds` and `getElementPaintExtent` (imported by the Worker), themes and `generateThemeCss`, Mermaid, arrange, freedraw and its `strokeOptions` (the ink layer and the coming art tools mirror them), the laser's constant-width maths, `exportToCanvas` and `exportToBlob`, collaborator cursors, grid, view and zen modes, frame navigation, and the export menu items `BoardMenu.tsx` re-adds.

## Other consumers

- A second, private app pins the fork's v1.11.2 tarballs and was last bumped on 2026-11-17. A cut reaches it only when it upgrades. Check it before removing any export.
- `excalidraw-theme-gallery` publishes screenshots and imports nothing from the fork.
- The fork's own `excalidraw-app` uses MIDI.

## How it was measured

- Usage: every `@excalidraw/*` value import in draw's `src/` (Worker), `frontend/` and `scripts/`, the props Board passes, and the `BoardMenu` default items.
- Bytes: draw's production frontend built with source maps and read with source-map-explorer, plus a minified esbuild build of the fork from source with a metafile, which splits bytes per source file into eager and lazy chunks.
- Runtime: draw's bench harness (`bench/harness`), production build for timings and the named build for attribution, in Edge with GPU compositing. The scene was 600 labelled shapes, 500 bound arrows and 20 frames. Steps: 300 hover moves, a 200-move drag, 60 remote updates, 20 ctrl+wheel steps and select-all. Load: Chrome traces of cold loads at 1x and 4x CPU throttle.
- The scripts (`diet-prof.mjs`, `diet-load.mjs`, `diet-loadprof.mjs`, `diet-self.mjs`, `diet-files.mjs`) were not committed. They live in draw's `bench/` style and can be added there if wanted.

### Checks that the numbers can fail

- The first production run measured someone else's server, which already held port 8811. The chunk names did not match my build, so I discarded those numbers and re-ran on a port whose served `index.html` named my chunk.
- The profiles tell interactions apart: `dragElements.ts` costs 366 ms in the drag and 0 in hover.
- The Mermaid A/B moved the same way in every round, and the stub build's chunk is 745 KB smaller.
- The "unused features" check found nonzero time for i18n and hints, so it did see them. Their share is just small.

## Not measured

- A real phone. 4x CPU throttle on a desktop stands in for one.
- Draw's real board page against a running Worker. The harness loads the same fork chunk but not the hub or the socket.
- Attribution in a production build of the fork. The tarball ships no production source maps, so shares come from its development build and totals from production.
- Per-feature compile time for the small features. Those numbers scale bytes by the measured Mermaid rate and are ESTIMATES.
- Items 4 to 8 were not built and A/B tested.

## Effects on work in flight

- `radial-art-tools` relies on freedraw, `strokeOptions`, the colour picker and top picks. Nothing here cuts them.
- `gpu-nav-design` moves the view layer into the fork. The zoom step cost here (about 550 ms of script for 20 ctrl+wheel steps without the view layer) is what that work replaces, so this page makes no zoom recommendation. Item 5 touches mount, which their move may also touch.
