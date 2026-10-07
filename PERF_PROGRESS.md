# Perf hillclimb progress

Worktree `D:\projects\_wt\excalidraw-perf`, branch `perf/hillclimb` from origin/master 8bf5db3a.
Decision log: `perf-decisions.tsv` (committed). Benchmark: `perf-bench/` (see below).

## Playbook checklist (Hillclimb, verbatim steps)

- [ ] 1. Ground the workload and architecture before choosing the metric. Run the **how** skill over the target, name the realistic workload dimensions that can move the result (data size, history, state, concurrency), and select a case that reproduces the user's complaint. If no case reproduces it, fix the repro instead of hillclimbing. Then fix one metric, the direction that counts as better, and a checkable stop predicate that pairs a target with a floor on attempts so a lucky early win can't end the run.
- [ ] 2. Build the measurement harness, prove its sensitivity, then freeze it. Run contrasting realistic workloads and confirm the target case reproduces the symptom while easier cases separate as expected. Once frozen, one repeatable command emits the metric, sampled enough to clear the noise (median of N, not a single run). Record the baseline metric and a green run of the regression gate before any change.
- [ ] 3. Open the decision log via the **show-me-your-work** skill. One row per attempt. (User override: commit it at the worktree root.)
- [ ] 4. Ground each hypothesis in the architecture model from step 1, so it names a specific mechanism.
- [ ] 5. Loop, one hypothesis per iteration: change, measure before and after with the frozen harness, run the regression gate, accept only past noise, one commit per accepted fix, log the row either way.
- [ ] 6. Push past the first plateau.
- [ ] 7. Stop when the predicate is met, or when the remaining ideas are marginal and not worth their cost.
- [ ] 8. Run **Opening a PR** with the accepted commits (user override: one branch + PR per accepted win, against redaphid/excalidraw master).

## Notes (append as I go)

- 2026-10-07: yarn is not on Git Bash PATH. Use `corepack yarn` from PowerShell.
- Matrix (coordinator correction): engines Chromium, Firefox, WebKit via playwright-core 1.63.0 (chromium-1243, firefox-1543, webkit-2359 in %LOCALAPPDATA%\ms-playwright). Form factors: desktop 1440x900 DPR1, desktop 1440x900 DPR2, tablet 1024x1366 DPR2 touch, phone 390x844 DPR3 touch. All numbers are EMULATION, not real devices.
- Win rule: ship only if win or neutral in EVERY measured cell. Engine-conditional only if clean. Log rejects.
- PR rule (user, final): open each PR against redaphid/excalidraw master and STOP. Do not merge. SendMessage main each PR URL. Installing dev tooling is fine.
- SCOPE CUT (user, supersedes matrix): no per-cell matrix, no no-GPU tier, no affinity. Per hypothesis: Chromium + CDP CPU throttle 4x, plus cheap draw-call/pixel counters. Firefox + WebKit sanity check only on final wins. KEEP a lean `?bench` page in the playground (deterministic scenes, scripted pan/zoom/pinch/freedraw, median+p95, UA+DPR, copy-as-JSON) as its own small PR. The Playwright harness drives that same page.
- 08:40 Bench built: playground/bench/{scenes,scenarios}.ts + Bench.tsx (?bench, ?bench=auto, &only=, &counters). Runner perf-bench/run.mjs (A/B alternating, OS-assigned port), build perf-bench/build.mjs <name> [--no-minify], profiler perf-bench/profile.mjs. Metric: rAF frame interval (p50/p95/mean) one input per frame, Chromium 4x throttle, vsync unlocked, laptop 1440x900 DPR2.
- A full 11-scenario page run takes >5 min at 4x. Use --only for per-hypothesis runs.
- Context: draw app's GPU ink + view layers take live strokes/pan/zoom when a GPU exists; Excalidraw paths matter for no-GPU, playground, and handovers (pen-up commit, gesture end, crisp settle redraw).
- Leads from 3 how-explorers (unmeasured): O(n) renderable map + cull per pan/zoom frame (Renderer.ts memo keyed on scroll/zoom); interactive scene loops all elements with empty selection (interactiveScene.ts ~1879, hasBoundingBox([])=true); updateEmbeddables O(n) per commit; framed freedraw repaints whole static scene per move (Renderer.ts:252, upstream #11257 for z-order); live stroke outline O(points) per frame; unbudgeted crisp settle redraw; frameNameOpacities O(v^2) frames; currentId forced layout read per pan frame.
- 10:10 #10 (bench) and #11 (empty bitmap canvas) MERGED by main. PR titles: scope must be one of app, editor, packages/excalidraw, packages/utils, docker, repo (use perf(editor)). Rebase new branches on origin/master.
- Bench bug: tool switch raced the first pointerdown (pan dragged a shape). Fixed in PR #12. Pre-fix pan/freedraw numbers are void.
- h2 (Renderer map memo apart from viewport) counters: Map.set/frame 2041->41 on mixed/pan. Tests running (.perf-vitest-h2.log).
- Next: embeddable scans per commit (updateEmbeddables/renderEmbeddables), framed freedraw full repaint (203 drawImage/move), interactive loop with empty selection.
- Gate rule: full vitest is load-flaky (27 failures); rerun failing files in isolation on both sides.
- 11:30 #13, #21 merged. h4 (in-frame stroke layer cache) committed on lab as bd19f91d, parity 0 px vs master, tests green, interrogate running (3 reviewers). Known fix to apply: scene nonce in key (image decode mid-stroke). h5 (interactive loop guard) uncommitted, counters pass, tests running. Bench now has &wait= and mapGets counter (needs its own playground PR).
- 12:40 #23 merged. #24 (in-frame stroke underlay) open after interrogate + rework: 203 -> 8.6 drawImage/move, parity 0 px.
- Bench changes pending their own playground PR: &wait= param, mapGets counter, perf-bench/parity.mjs, perf-bench/callsites.mjs.
- Next leads: framed stroke still rebuilds the renderable map per move (canvasNonce includes versionNonce): Map.set 2040/move; freedraw outline recomputed per move O(points); settle redraw unbudgeted.
- 14:00 PRs: #26 cull memo, #27 static restore fix (master bug). Design E being prototyped by a subagent in D:/projects/_wt/excalidraw-perf-e (branch perf/split-overlay). Parity harness extended (per-scenario pages, composite, --expect-split, webkit). #24 (u2 build) parity: 0 px everywhere except resize (AA timing, explained). Decision pending E's numbers.
- 15:10 Merged so far: #10 #11 #12 #13 #21 #23 #25 #26 #27. Open: #24 (underlay, decision pending E), #32 (builder skip), #33 (parity harness), #34 (bounds cache). PR worktree D:/projects/_wt/excalidraw-perf-pr now has a real install (tests run there).
- Next leads (from callsites on pan): frame clip segments per framed element per frame (isElementIntersectingFrame/getElementLineSegments uncached); visibleBitmapRect allocates ~10 arrays per blit.
- 16:00 PRs #34 (bounds cache), #35 (frame intersection cache), #36 (scalar blit rect) open. Design E (split overlay) nearly done in D:/projects/_wt/excalidraw-perf-e: drawImage per framed move 203 -> 0 (underlay: 1-8.6), webkit parity d1 only. Likely: ship E, close #24. Remaining hot spot: first-sight hachure/shape generation when elements enter view (inherent; could move to idle).
- 18:30 E shipped as PR #41 (perf/split-overlay 0143bf42). #39 test-only (merging), #40 parity settle fix, issue #42 (arrows). #24 stays open until #41 merges.

## Status at wind-down (2026-10-07)

Merged: #10 bench page, #11 empty bitmap canvas, #12 bench tool fix, #13 renderable map memo, #21 embeds memo, #23 selection scan guard, #25 bench tools, #26 cull memo, #27 static restore fix, #32 builder skip, #33 parity gestures, #34 bounds cache, #35 frame intersection cache, #36 scalar blit rect, #39 frame replacement test (merging).

Open:
- #41 split overlay (design E), awaiting review; #24 (underlay) to be closed by main when #41 merges. Last underlay rework kept on origin/perf/underlay-final.
- #40 parity settle fix + pngdiff.mjs; #43 callsites --depth/--match.
- Issue #42: arrows and lines repaint the whole static scene on every move (LinearElementEditor.movePoints informs the scene).

Review follow-ups not done:
- #34: the render-override test's new assertion can pass vacuously; add a check that the overridden draws reuse the cached bitmap.
- pngdiff.mjs: add a byte-identity shortcut; it false-reds on a loaded box.
- No frame timings anywhere: every PR's timing is pending a quiet box or ?bench on the user's laptop. No cumulative before/after table was built.
- Test gate: failing files were rerun in isolation with the change only, not on both sides, after #11.

Leads not tried:
- First-sight shape and bitmap generation as elements enter view (rough.js hachure dominates what a pan still walks); could be built ahead in idle time near the viewport.
- The O(n) viewport cull per pan/zoom frame (a spatial index).
- The unbudgeted crisp redraw after a zoom settles.
- The live freedraw outline rebuilt from every point on each move.
