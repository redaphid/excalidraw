import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { debounce } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";

import {
  loadBookmarks,
  loadScene,
  saveScene,
  toggleBookmark,
} from "./persistence";

const save = debounce(saveScene, 300);
window.addEventListener("pagehide", save.flush);

const Playground = () => {
  const [initialData] = useState(() => loadScene(localStorage));
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(localStorage));
  const frameNavigation = useMemo(
    () => ({
      bookmarks,
      onBookmarkChange: (frameId: string, bookmarked: boolean) =>
        setBookmarks(toggleBookmark(localStorage, frameId, bookmarked)),
    }),
    [bookmarks],
  );
  return (
    <Excalidraw
      authoringUnits="screen"
      initialData={initialData}
      frameNavigation={frameNavigation}
      onChange={(elements, appState, files) =>
        save(localStorage, elements, appState, files)
      }
    />
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
