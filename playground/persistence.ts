import { z } from "zod";

import {
  getNonDeletedElements,
  isInitializedImageElement,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

type SavedAppState = Pick<
  AppState,
  "zoom" | "scrollX" | "scrollY" | "theme" | "viewBackgroundColor"
>;

const SCENE_KEY = "excalidraw-playground-scene";

export const loadScene = (storage: Storage): ImportedDataState | null => {
  const saved = storage.getItem(SCENE_KEY);
  if (!saved) {
    return null;
  }
  return JSON.parse(saved);
};

export const saveScene = (
  storage: Storage,
  elements: readonly ExcalidrawElement[],
  { zoom, scrollX, scrollY, theme, viewBackgroundColor }: SavedAppState,
  files: BinaryFiles,
) => {
  const liveElements = getNonDeletedElements(elements);
  storage.setItem(
    SCENE_KEY,
    JSON.stringify({
      elements: liveElements,
      appState: { zoom, scrollX, scrollY, theme, viewBackgroundColor },
      files: Object.fromEntries(
        liveElements
          .filter(isInitializedImageElement)
          .map(({ fileId }) => [fileId, files[fileId]]),
      ),
    }),
  );
};

const BOOKMARKS_KEY = "excalidraw-playground-bookmarks";

const Bookmarks = z.array(z.string());

export const loadBookmarks = (storage: Storage) =>
  Bookmarks.parse(JSON.parse(storage.getItem(BOOKMARKS_KEY) ?? "[]"));

export const toggleBookmark = (
  storage: Storage,
  frameId: string,
  bookmarked: boolean,
) => {
  const others = loadBookmarks(storage).filter((id) => id !== frameId);
  const next = bookmarked ? [...others, frameId] : others;
  storage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  return next;
};

export const ciFailProofTypeError: number = "not a number";
