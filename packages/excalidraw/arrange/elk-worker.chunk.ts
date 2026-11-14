/**
 * The layout worker. ELK's worker build installs its message dispatcher on
 * `self` as it loads. Nothing imports this module: `elkLayout` spawns it with
 * `new Worker(new URL(...))`, which bundlers follow to build it as a worker.
 * Its imports stay static, since a dynamic one would pull a bundler's
 * preload helper, and with it the editor, into the worker.
 */
import "elkjs/lib/elk-worker.min.js";
