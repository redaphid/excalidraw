import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { KEYS, THEME } from "@excalidraw/common";
import { elementsOverlappingBBox } from "@excalidraw/element";
import { exportToCanvas } from "@excalidraw/utils/export";

import { useAppStateValue } from "../hooks/useAppStateValue";
import { useUIAppState } from "../context/ui-appState";
import { t } from "../i18n";

import { useApp, useAppProps, useEditorInterface } from "./App";

import "./FramesMenu.scss";

import type { Frame, FrameNode } from "../frameNavigation";
import type { AppClassProperties } from "../types";

const THUMBNAIL_PX = 96;
const THUMBNAIL_DEBOUNCE_MS = 500;

/** Frame thumbnails, redrawn once the scene settles, and only for the frames
 * whose contents changed. */
const useThumbnails = (app: AppClassProperties, dark: boolean) => {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const drawn = useRef(new Map<string, string>());
  const nonce = app.scene.getSceneNonce();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const elements = app.scene.getNonDeletedElements();
      const appState = {
        ...app.state,
        exportBackground: true,
        exportWithDarkMode: dark,
      };
      const next = new Map<string, string>();
      for (const frame of app.scene.getNonDeletedFramesLikes()) {
        const key = `${dark}:${elementsOverlappingBBox({
          elements,
          bounds: frame,
          type: "overlap",
        })
          .map((e) => `${e.id}:${e.version}`)
          .join()}`;
        if (drawn.current.get(frame.id) === key) {
          continue;
        }
        const canvas = await exportToCanvas({
          elements,
          appState,
          files: app.files,
          exportingFrame: frame,
          exportPadding: 0,
          maxWidthOrHeight: THUMBNAIL_PX,
          restoreElements: false,
        });
        if (cancelled) {
          return;
        }
        next.set(frame.id, canvas.toDataURL());
        drawn.current.set(frame.id, key);
      }
      if (next.size) {
        setUrls((prev) => new Map([...prev, ...next]));
      }
    }, THUMBNAIL_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [app, nonce, dark]);

  return urls;
};

type RowProps = {
  current: string | null;
  bookmarked: ReadonlySet<string> | null;
  thumbnails: ReadonlyMap<string, string>;
  onGo(id: string, fromPointer: boolean): void;
  onStar(id: string, starred: boolean): void;
};

const Row = ({
  frame,
  hint,
  onKeyDown,
  current,
  bookmarked,
  thumbnails,
  onGo,
  onStar,
}: RowProps & {
  frame: Frame;
  hint?: string;
  onKeyDown?(event: React.KeyboardEvent<HTMLButtonElement>): void;
}) => {
  const starred = bookmarked?.has(frame.id) ?? false;
  return (
    <div className="frames-menu__row">
      <button
        type="button"
        className="frames-menu__go"
        data-frame={frame.id}
        aria-current={frame.id === current ? "location" : undefined}
        onClick={(event) => onGo(frame.id, event.detail > 0)}
        onKeyDown={onKeyDown}
      >
        <span className="frames-menu__thumb">
          {thumbnails.has(frame.id) && (
            <img src={thumbnails.get(frame.id)} alt="" />
          )}
        </span>
        <span className="frames-menu__name">{frame.name}</span>
        {hint && <kbd>{hint}</kbd>}
      </button>
      {bookmarked && (
        <button
          type="button"
          className={clsx("frames-menu__star", { "is-on": starred })}
          aria-pressed={starred}
          aria-label={t(
            starred
              ? "frameNavigation.removeBookmark"
              : "frameNavigation.bookmark",
            { name: frame.name },
          )}
          onClick={() => onStar(frame.id, !starred)}
        >
          {starred ? "★" : "☆"}
        </button>
      )}
    </div>
  );
};

const Tree = ({
  nodes,
  parent,
  onLeave,
  ...row
}: RowProps & {
  nodes: readonly FrameNode[];
  parent: string | null;
  onLeave(to: string | null): void;
}) => (
  <ul>
    {nodes.map(({ frame, children }) => (
      <li key={frame.id}>
        <Row
          frame={frame}
          onKeyDown={(event) => {
            if (event.key === KEYS.ENTER && children[0]) {
              event.preventDefault();
              event.stopPropagation();
              return onLeave(children[0].frame.id);
            }
            if (event.key === KEYS.ESCAPE) {
              event.preventDefault();
              event.stopPropagation();
              onLeave(parent);
            }
          }}
          {...row}
        />
        {children.length > 0 && (
          <Tree nodes={children} parent={frame.id} onLeave={onLeave} {...row} />
        )}
      </li>
    ))}
  </ul>
);

/**
 * The Frames tab of the default sidebar: bookmarks, then every frame as a
 * tree. Enter goes into a frame's first child, Escape out to its parent or,
 * at the top, closes the drawer.
 */
export const FramesMenu = () => {
  const app = useApp();
  const { frameNavigation } = useAppProps();
  const { theme } = useUIAppState();
  const editorInterface = useEditorInterface();
  const list = useRef<HTMLDivElement>(null);
  const current = useAppStateValue((state) =>
    app.frameNavigation.currentId(state),
  );
  const thumbnails = useThumbnails(app, theme === THEME.DARK);

  useEffect(() => {
    list.current
      ?.querySelector(`.frames-menu__tree [data-frame="${current}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const model = app.frameNavigation.model();
  const bookmarks = app.frameNavigation.bookmarks();
  const onBookmarkChange = frameNavigation?.onBookmarkChange;

  const go = (id: string, fromPointer: boolean) => {
    app.frameNavigation.goTo(id);
    if (editorInterface.formFactor === "phone") {
      app.toggleSidebar({ name: null });
    }
    if (fromPointer) {
      app.focusContainer();
    }
  };

  const row: RowProps = {
    current,
    bookmarked: onBookmarkChange
      ? new Set(bookmarks.map((frame) => frame.id))
      : null,
    thumbnails,
    onGo: go,
    onStar: (id, starred) => onBookmarkChange?.(id, starred),
  };

  return (
    <div className="frames-menu" ref={list}>
      {bookmarks.length > 0 && (
        <section
          className="frames-menu__bookmarks"
          aria-label={t("frameNavigation.bookmarks")}
        >
          <h3>{t("frameNavigation.bookmarks")}</h3>
          {bookmarks.map((frame, i) => (
            <Row
              key={frame.id}
              frame={frame}
              hint={i < 9 ? `⌥${i + 1}` : undefined}
              {...row}
            />
          ))}
        </section>
      )}
      <section
        className="frames-menu__tree"
        aria-label={t("frameNavigation.allFrames")}
      >
        <Tree
          nodes={model.tree}
          parent={null}
          onLeave={(to) => {
            if (to === null) {
              app.toggleSidebar({ name: null });
              app.focusContainer();
              return;
            }
            app.frameNavigation.goTo(to);
            list.current
              ?.querySelector<HTMLButtonElement>(
                `.frames-menu__tree [data-frame="${to}"]`,
              )
              ?.focus();
          }}
          {...row}
        />
      </section>
      <footer className="frames-menu__hint">{t("frameNavigation.hint")}</footer>
    </div>
  );
};
