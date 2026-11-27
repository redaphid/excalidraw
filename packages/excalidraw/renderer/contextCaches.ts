import type { ExcalidrawElement } from "@excalidraw/element/types";

/** drops a cache's canvases; given the scene's elements, for caches keyed
 * by element */
type Forget = (elements: readonly ExcalidrawElement[]) => void;

/**
 * Caches of canvases drawn on a 2D context. A lost context (a GPU process
 * crash, say) comes back blank, and so does every canvas cached from one, so
 * a repaint would draw them blank. Each cache's module registers how to drop
 * it, beside the cache, and the editor drops them all before it repaints.
 */
const caches = new Map<string, Forget>();

/** @returns a function that unregisters it */
export const registerContextCache = (name: string, forget: Forget) => {
  caches.set(name, forget);
  return () => {
    caches.delete(name);
  };
};

export const getContextCacheNames = () => [...caches.keys()].sort();

export const forgetContextCaches = (elements: readonly ExcalidrawElement[]) => {
  for (const forget of caches.values()) {
    forget(elements);
  }
};
