import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { KEYS, THEME } from "@excalidraw/common";
import {
  elementsOverlappingBBox,
  isInitializedImageElement,
} from "@excalidraw/element";
import { exportToCanvas } from "@excalidraw/utils/export";

import { useCurrentFrameId, useFrameModel } from "../hooks/useFrameModel";
import { getShortcutKey } from "../shortcut";
import { useUIAppState } from "../context/ui-appState";
import { t } from "../i18n";

import { liveBookmarks } from "../frameNavigation";

import { useApp, useAppProps, useEditorInterface } from "./App";

import "./FramesMenu.scss";

import type { Frame, FrameNode } from "../frameNavigation";
import type { AppClassProperties } from "../types";

const THUMBNAIL_PX = 96;
const THUMBNAIL_DEBOUNCE_MS = 500;

type Thumbnail = { key: string; url: string };

/**
 * Frame thumbnails, redrawn once the scene has been still for a moment, and
 * only for the frames whose contents changed. What was drawn and what is
 * shown are one map, so a pass that is abandoned or fails leaves no frame
 * recorded as drawn without its image.
 */
const useThumbnails = (app: AppClassProperties, dark: boolean) => {
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, Thumbnail>>(
    new Map(),
  );
  const shown = useRef(thumbnails);
  shown.current = thumbnails;

  useEffect(() => {
    let alive = true;
    let busy = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const draw = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      const elements = app.scene.getNonDeletedElements();
      const appState = {
        ...app.state,
        exportBackground: true,
        exportWithDarkMode: dark,
      };
      const drawn = new Map<string, Thumbnail>();
      try {
        for (const frame of app.scene.getNonDeletedFramesLikes()) {
          const key = `${dark}:${elementsOverlappingBBox({
            elements,
            bounds: frame,
            type: "overlap",
          })
            .map((e) =>
              [
                e.id,
                e.version,
                e.versionNonce,
                isInitializedImageElement(e) && e.fileId in app.files,
              ].join(":"),
            )
            .join()}`;
          if (shown.current.get(frame.id)?.key === key) {
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
          drawn.set(frame.id, { key, url: canvas.toDataURL() });
        }
      } finally {
        busy = false;
      }
      if (!alive) {
        return;
      }
      if (drawn.size) {
        setThumbnails((prev) => new Map([...prev, ...drawn]));
      }
      if (again) {
        again = false;
        schedule();
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(draw, THUMBNAIL_DEBOUNCE_MS);
    };

    schedule();
    const unsubscribe = app.frameNavigation.sceneUpdated.on(schedule);
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [app, dark]);

  return thumbnails;
};

type RowProps = {
  current: string | null;
  bookmarked: ReadonlySet<string> | null;
  thumbnails: ReadonlyMap<string, Thumbnail>;
  onGo(id: string, fromPointer: boolean): void;
  onStar(id: string, starred: boolean): void;
};

const Row = ({
  frame,
  hint,
  onKeyDown,
  buttonRef,
  current,
  bookmarked,
  thumbnails,
  onGo,
  onStar,
}: RowProps & {
  frame: Frame;
  hint?: string;
  onKeyDown?(event: React.KeyboardEvent<HTMLButtonElement>): void;
  buttonRef?(node: HTMLButtonElement | null): void;
}) => {
  const starred = bookmarked?.has(frame.id) ?? false;
  return (
    <div className="frames-menu__row">
      <button
        type="button"
        className="frames-menu__go"
        data-frame={frame.id}
        ref={buttonRef}
        aria-current={frame.id === current ? "location" : undefined}
        onClick={(event) => onGo(frame.id, event.detail > 0)}
        onKeyDown={onKeyDown}
      >
        <span className="frames-menu__thumb">
          {thumbnails.has(frame.id) && (
            <img src={thumbnails.get(frame.id)?.url} alt="" />
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
  rows,
  ...row
}: RowProps & {
  nodes: readonly FrameNode[];
  parent: string | null;
  onLeave(to: string | null): void;
  /** the tree's row buttons by frame id, for moving focus and scrolling */
  rows: Map<string, HTMLButtonElement>;
}) => (
  <ul>
    {nodes.map(({ frame, children }) => (
      <li key={frame.id}>
        <Row
          frame={frame}
          buttonRef={(node) =>
            node ? rows.set(frame.id, node) : rows.delete(frame.id)
          }
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
          <Tree
            nodes={children}
            parent={frame.id}
            onLeave={onLeave}
            rows={rows}
            {...row}
          />
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
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const current = useCurrentFrameId(app);
  const thumbnails = useThumbnails(app, theme === THEME.DARK);

  // a closed drawer takes the focused row with it; hand focus back to the
  // editor so the frame keys keep working
  useEffect(
    () => () => {
      if (app.ownerDocument.activeElement === app.ownerDocument.body) {
        app.focusContainer();
      }
    },
    [app],
  );

  useEffect(() => {
    if (current) {
      rows.current.get(current)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [current]);

  const model = useFrameModel(app);
  const bookmarks = liveBookmarks(model, frameNavigation?.bookmarks ?? []);
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
    <div className="frames-menu">
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
              hint={i < 9 ? getShortcutKey(`Alt+${i + 1}`) : undefined}
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
            rows.current.get(to)?.focus();
          }}
          rows={rows.current}
          {...row}
        />
      </section>
      <footer className="frames-menu__hint">
        {t("frameNavigation.hint", {
          bookmarks: getShortcutKey("Alt+1…9"),
        })}
      </footer>
    </div>
  );
};
