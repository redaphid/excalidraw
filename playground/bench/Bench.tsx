import { useEffect, useRef, useState } from "react";

import { Excalidraw } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { SCENARIOS } from "./scenarios";
import { SCENES } from "./scenes";

import type { Scenario } from "./scenarios";
import type { BenchScene, SceneName } from "./scenes";

type Stats = { median: number; p95: number; mean: number };

type Counters = {
  drawImage: number;
  blitMpx: number;
  fill: number;
  stroke: number;
  fillText: number;
  canvasesCreated: number;
  arrayElementsWalked: number;
  mapSets: number;
  mapGets: number;
  boundingRectReads: number;
};

type ScenarioResult = {
  id: string;
  steps: number;
  frameMs: Stats;
  releaseMs: number;
  settleMaxFrameMs: number;
  countersPerFrame?: Counters;
  countersAtRelease?: Counters;
};

export type BenchReport = {
  version: 1;
  userAgent: string;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
  mountMs: Partial<Record<SceneName, number>>;
  heapMB?: number;
  results: ScenarioResult[];
};

type Mounted = { name: SceneName; scene: BenchScene };

type BenchUi = {
  status: (text: string) => void;
  mount: (mounted: Mounted) => Promise<ExcalidrawImperativeAPI>;
};

declare global {
  interface Window {
    benchReport?: BenchReport;
    benchError?: string;
    profilerHook?: (id: string, phase: "start" | "stop") => Promise<void>;
  }
}

const params = new URLSearchParams(window.location.search);
const only = params.get("only")?.split(",");
const auto = params.get("bench") === "auto";
const counting = params.has("counters");

const TASK_HOPS = 3;
const SETTLE_WINDOW_MS = 400;
const VIEW_RESET_MS = Number(params.get("wait") ?? 500);

// synthetic pointers are unknown to the browser, so capturing one throws and
// aborts the editor's pointerdown before it records a pinch
for (const name of ["setPointerCapture", "releasePointerCapture"] as const) {
  const original = Element.prototype[name];
  Element.prototype[name] = function (this: Element, pointerId: number) {
    try {
      original.call(this, pointerId);
    } catch {}
  };
}

const nextFrame = () =>
  new Promise<number>((resolve) =>
    requestAnimationFrame(() => resolve(performance.now())),
  );

const flushTasks = async () => {
  for (let i = 0; i < TASK_HOPS; i++) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const round = (ms: number) => Math.round(ms * 100) / 100;

const stats = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  return { median: round(at(0.5)), p95: round(at(0.95)), mean: round(mean) };
};

const counters: Counters = {
  drawImage: 0,
  blitMpx: 0,
  fill: 0,
  stroke: 0,
  fillText: 0,
  canvasesCreated: 0,
  arrayElementsWalked: 0,
  mapSets: 0,
  mapGets: 0,
  boundingRectReads: 0,
};

const wrap = <T extends object>(
  target: T,
  name: keyof T & string,
  count: (self: any, args: any[]) => void,
) => {
  const original = target[name] as (...args: unknown[]) => unknown;
  Object.assign(target, {
    [name](this: unknown, ...args: unknown[]) {
      count(this, args);
      return original.apply(this, args);
    },
  });
};

const installCounters = () => {
  const context = CanvasRenderingContext2D.prototype;
  wrap(context, "fill", () => counters.fill++);
  wrap(context, "stroke", () => counters.stroke++);
  wrap(context, "fillText", () => counters.fillText++);
  wrap(context, "drawImage", (self: CanvasRenderingContext2D, args) => {
    const { a, b, c, d } = self.getTransform();
    const [w, h] =
      args.length >= 9
        ? [args[7], args[8]]
        : args.length >= 5
        ? [args[3], args[4]]
        : [args[0].width, args[0].height];
    counters.drawImage++;
    counters.blitMpx += (w * Math.hypot(a, b) * h * Math.hypot(c, d)) / 1e6;
  });
  for (const name of [
    "filter",
    "forEach",
    "map",
    "some",
    "every",
    "find",
    "findIndex",
    "reduce",
  ] as const) {
    wrap(Array.prototype, name, (self: unknown[]) => {
      counters.arrayElementsWalked += self.length;
    });
  }
  wrap(Map.prototype, "set", () => counters.mapSets++);
  wrap(Map.prototype, "get", () => counters.mapGets++);
  wrap(
    Element.prototype,
    "getBoundingClientRect",
    () => counters.boundingRectReads++,
  );
  wrap(document, "createElement", (_, [tag]) => {
    if (String(tag).toLowerCase() === "canvas") {
      counters.canvasesCreated++;
    }
  });
};

const takeCounters = (steps: number): Counters => {
  const taken = { ...counters };
  for (const key of Object.keys(counters) as (keyof Counters)[]) {
    taken[key] = round(counters[key] / steps);
    counters[key] = 0;
  }
  return taken;
};

const runScenario = async (
  scenario: Scenario,
  api: ExcalidrawImperativeAPI,
  scene: BenchScene,
): Promise<ScenarioResult> => {
  api.updateScene({ appState: { ...scene.view, selectedElementIds: {} } });
  await wait(VIEW_RESET_MS);
  const canvas = document.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.interactive",
  )!;
  api.setActiveTool({ type: scenario.tool });
  await flushTasks();
  scenario.begin(api, canvas);
  await flushTasks();
  takeCounters(1);

  await window.profilerHook?.(scenario.id, "start");
  const frames: number[] = [];
  let frameStart = await nextFrame();
  for (let i = 1; i <= scenario.steps; i++) {
    scenario.step(canvas, i);
    await flushTasks();
    const next = await nextFrame();
    frames.push(next - frameStart);
    frameStart = next;
  }
  await window.profilerHook?.(scenario.id, "stop");
  const countersPerFrame = counting ? takeCounters(scenario.steps) : undefined;

  const releaseStart = performance.now();
  scenario.end(canvas);
  await flushTasks();
  const releaseMs = performance.now() - releaseStart;
  const countersAtRelease = counting ? takeCounters(1) : undefined;

  let settleMaxFrameMs = 0;
  let last = await nextFrame();
  const until = last + SETTLE_WINDOW_MS;
  while (last < until) {
    const next = await nextFrame();
    settleMaxFrameMs = Math.max(settleMaxFrameMs, next - last);
    last = next;
  }

  return {
    id: scenario.id,
    steps: scenario.steps,
    frameMs: stats(frames),
    releaseMs: round(releaseMs),
    settleMaxFrameMs: round(settleMaxFrameMs),
    countersPerFrame,
    countersAtRelease,
  };
};

const selected = SCENARIOS.filter((s) => !only || only.includes(s.id));
const sceneOrder = [...new Set(selected.map((s) => s.scene))];

const runBench = async (ui: BenchUi): Promise<BenchReport> => {
  if (counting) {
    installCounters();
  }
  const results: ScenarioResult[] = [];
  const mountMs: BenchReport["mountMs"] = {};
  for (const name of sceneOrder) {
    ui.status(`mounting ${name}`);
    const scene = SCENES[name]();
    const start = performance.now();
    const api = await ui.mount({ name, scene });
    while (api.getSceneElements().length < scene.elements.length) {
      await nextFrame();
    }
    await nextFrame();
    await flushTasks();
    mountMs[name] = round(performance.now() - start);
    for (const scenario of selected.filter((s) => s.scene === name)) {
      ui.status(`running ${scenario.id}`);
      results.push(await runScenario(scenario, api, scene));
    }
  }
  const memory = (performance as any).memory;
  return {
    version: 1,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    mountMs,
    heapMB: memory ? Math.round(memory.usedJSHeapSize / 1e5) / 10 : undefined,
    results,
  };
};

let benchRun: Promise<BenchReport> | null = null;

export const Bench = () => {
  const [mounted, setMounted] = useState<Mounted | null>(null);
  const [started, setStarted] = useState(auto);
  const [status, setStatus] = useState(auto ? "starting" : "idle");
  const [report, setReport] = useState<BenchReport | null>(null);
  const apiResolver = useRef<(api: ExcalidrawImperativeAPI) => void>(undefined);

  useEffect(() => {
    if (!started) {
      return;
    }
    benchRun ??= runBench({
      status: setStatus,
      mount: (next) =>
        new Promise((resolve) => {
          apiResolver.current = resolve;
          setMounted(next);
        }),
    });
    benchRun.then(
      (done) => {
        window.benchReport = done;
        setReport(done);
        setStatus("done");
      },
      (error) => {
        window.benchError = String(error?.stack ?? error);
        setStatus(`failed: ${error}`);
      },
    );
  }, [started]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {mounted && (
        <Excalidraw
          key={mounted.name}
          authoringUnits="screen"
          initialData={{
            elements: mounted.scene.elements,
            files: mounted.scene.files,
            appState: { ...mounted.scene.view, viewBackgroundColor: "#fff" },
          }}
          onExcalidrawAPI={(api) => api && apiResolver.current?.(api)}
        />
      )}
      <div
        style={{
          position: "fixed",
          left: 8,
          bottom: 48,
          zIndex: 10000,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "60vh",
          overflow: "auto",
          background: "rgba(255,255,255,0.95)",
          border: "1px solid #999",
          borderRadius: 6,
          padding: 8,
          font: "12px monospace",
        }}
      >
        <div>
          bench: {status}{" "}
          {!started && <button onClick={() => setStarted(true)}>run</button>}
          {report && (
            <button
              onClick={() =>
                navigator.clipboard.writeText(JSON.stringify(report, null, 2))
              }
            >
              copy JSON
            </button>
          )}
        </div>
        {report && (
          <table>
            <thead>
              <tr>
                <th>scenario</th>
                <th>frame p50</th>
                <th>frame p95</th>
                <th>frame mean</th>
                <th>release</th>
                <th>settle max</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.frameMs.median}</td>
                  <td>{r.frameMs.p95}</td>
                  <td>{r.frameMs.mean}</td>
                  <td>{r.releaseMs}</td>
                  <td>{r.settleMaxFrameMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {report && (
          <div>
            dpr {report.devicePixelRatio}, {report.viewport.width}x
            {report.viewport.height}, mount ms {JSON.stringify(report.mountMs)}
          </div>
        )}
      </div>
    </div>
  );
};
