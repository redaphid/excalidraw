/// <reference path="./elkjs.d.ts" />
/**
 * The layout worker. `elkLayout` imports this chunk for `WorkerUrl` and
 * spawns it from that URL, so the worker resolves wherever the bundle that
 * carries it is served, in this repo's bundlers and in the published package
 * alike. Importing it on the main thread costs only this module: ELK itself
 * loads in the worker.
 *
 * `import.meta.url` is undefined in nodejs.
 */
export const WorkerUrl: URL | undefined = import.meta.url
  ? new URL(import.meta.url)
  : undefined;

// ELK's worker build installs its dispatcher on `self` as it loads, so the
// messages that arrive before then are kept and handed to it after
if (typeof window === "undefined" && typeof self !== "undefined") {
  const early: MessageEvent[] = [];
  self.onmessage = (event) => {
    early.push(event);
  };
  import("elkjs/lib/elk-worker.min.js").then(() => {
    for (const event of early) {
      self.onmessage?.(event);
    }
  }, reportError);
}
