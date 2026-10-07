import { lazy, StrictMode, Suspense, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { debounce } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { THEMES } from "./themes";
import {
  loadBookmarks,
  loadScene,
  saveScene,
  toggleBookmark,
} from "./persistence";

const Bench = lazy(() =>
  import("./bench/Bench").then(({ Bench }) => ({ default: Bench })),
);

declare global {
  interface Window {
    /** for scripted drivers such as scripts/theme-screenshots */
    excalidrawAPI?: ExcalidrawImperativeAPI | null;
  }
}

const save = debounce(saveScene, 300);
window.addEventListener("pagehide", save.flush);

const params = new URLSearchParams(window.location.search);
const showSwitcher = params.get("switcher") !== "0";

const setThemeParam = (id: string | null) => {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("theme", id);
  } else {
    url.searchParams.delete("theme");
  }
  window.history.replaceState(null, "", url);
};

const ThemeSwitcher = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) => (
  <select
    aria-label="Theme"
    value={value ?? ""}
    onChange={(event) => onChange(event.target.value || null)}
    style={{
      height: "var(--lg-button-size, 2.25rem)",
      font: "inherit",
      fontSize: "0.875rem",
      color: "var(--text-primary-color)",
      background: "var(--island-bg-color)",
      border: "1px solid var(--default-border-color)",
      borderRadius: "var(--border-radius-lg)",
      padding: "0 0.5rem",
      pointerEvents: "all",
    }}
  >
    <option value="">Default theme</option>
    {THEMES.map((theme) => (
      <option key={theme.id} value={theme.id}>
        {theme.label}
      </option>
    ))}
  </select>
);

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
  const [themeId, setThemeId] = useState(() =>
    THEMES.some((theme) => theme.id === params.get("theme"))
      ? params.get("theme")
      : null,
  );
  const theme = THEMES.find(({ id }) => id === themeId);
  return (
    <Excalidraw
      css={theme?.css}
      theme={theme?.mode}
      renderTopRightUI={
        showSwitcher
          ? () => (
              <ThemeSwitcher
                value={themeId}
                onChange={(id) => {
                  setThemeId(id);
                  setThemeParam(id);
                }}
              />
            )
          : undefined
      }
      authoringUnits="screen"
      initialData={initialData}
      frameNavigation={frameNavigation}
      onExcalidrawAPI={(api) => {
        window.excalidrawAPI = api;
      }}
      onChange={(elements, appState, files) =>
        save(localStorage, elements, appState, files)
      }
    />
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).has("bench") ? (
      <Suspense fallback={null}>
        <Bench />
      </Suspense>
    ) : (
      <Playground />
    )}
  </StrictMode>,
);
