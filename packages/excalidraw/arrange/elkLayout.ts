import type {
  LayoutEngine,
  LayoutGraph,
  LayoutOptions,
  LayoutPositions,
} from "@excalidraw/element";

import type { ELK, ElkNode } from "elkjs/lib/elk-api";

type Layout = (graph: ElkNode) => Promise<ElkNode>;

class ElkWorkerError extends Error {}

const loadMainThread = async (): Promise<Layout> => {
  const { default: ELKBundled } = await import("elkjs/lib/elk.bundled.js");
  const elk: ELK = new ELKBundled();
  return (graph) => elk.layout(graph);
};

/** null when this environment cannot run the layout worker */
const loadWorker = async (): Promise<Layout | null> => {
  if (typeof Worker === "undefined") {
    return null;
  }
  const { default: ELKApi } = await import("elkjs/lib/elk-api.js");
  let fail: (error: ElkWorkerError) => void = () => {};
  // ELK's API never hears about a worker that fails to load or crashes, so
  // its answers race the worker's own error events
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  failed.catch(() => {});
  const elk: ELK = new ELKApi({
    workerFactory: () => {
      // the extensionless path resolves to the .ts source in this repo's
      // bundlers and to the built .js next to it in the published package
      const worker = new Worker(
        new URL("./elk-worker.chunk", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("error", (event) =>
        fail(new ElkWorkerError(event.message)),
      );
      worker.addEventListener("messageerror", () =>
        fail(new ElkWorkerError("unreadable message from the ELK worker")),
      );
      return worker;
    },
  });
  return (graph) =>
    Promise.race([elk.layout(graph), failed]).catch((error) => {
      if (error instanceof ElkWorkerError) {
        elk.terminateWorker();
      }
      throw error;
    });
};

let worker: Promise<Layout | null> | null = null;
let mainThread: Promise<Layout> | null = null;

const layOut = async (graph: ElkNode): Promise<ElkNode> => {
  worker ??= loadWorker().catch((error) => {
    console.error("Failed to load the ELK worker.", error);
    return null;
  });
  const inWorker = await worker;
  if (inWorker) {
    try {
      return await inWorker(graph);
    } catch (error) {
      if (!(error instanceof ElkWorkerError)) {
        throw error;
      }
      console.error(
        "The ELK worker failed, laying out on the main thread.",
        error,
      );
      worker = Promise.resolve(null);
    }
  }
  mainThread ??= loadMainThread();
  return (await mainThread)(graph);
};

/** layered's strategies that read the nodes' input coordinates instead of starting over */
const INTERACTIVE: Record<string, string> = {
  "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
  "elk.layered.layering.strategy": "INTERACTIVE",
  "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
  "elk.layered.nodePlacement.strategy": "INTERACTIVE",
  "elk.layered.interactiveReferencePoint": "TOP_LEFT",
};

const elkOptionsOf = ({
  algorithm,
  direction,
  spacing,
  mode,
  elkOptions,
}: LayoutOptions): Record<string, string> => ({
  "elk.algorithm": algorithm,
  "elk.direction": direction.toUpperCase(),
  "elk.spacing.nodeNode": String(spacing.node),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(spacing.rank),
  "elk.spacing.componentComponent": String(spacing.node),
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  ...(mode === "incremental" && algorithm === "layered" ? INTERACTIVE : {}),
  ...elkOptions,
});

/**
 * Lays a graph out with ELK in a web worker, or on the main thread where
 * workers are unavailable or fail. ELK loads on first use only.
 */
export const elkLayout: LayoutEngine = async (
  { nodes, edges }: LayoutGraph,
  options: LayoutOptions,
): Promise<LayoutPositions> => {
  const laid = await layOut({
    id: "excalidraw-arrange",
    layoutOptions: elkOptionsOf(options),
    children: nodes.map(({ id, width, height, previous }) => ({
      id,
      width,
      height,
      ...previous,
    })),
    edges: edges.map(({ id, source, target }) => ({
      id,
      sources: [source],
      targets: [target],
    })),
  });
  const children = laid.children ?? [];
  const left = Math.min(...children.map(({ x = 0 }) => x));
  const top = Math.min(...children.map(({ y = 0 }) => y));
  return new Map(
    children.map(({ id, x = 0, y = 0 }): [string, { x: number; y: number }] => [
      id,
      { x: x - left, y: y - top },
    ]),
  );
};
