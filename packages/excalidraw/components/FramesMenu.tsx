import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { KEYS, THEME } from "@excalidraw/common";
import {
  elementsOverlappingBBox,
  isInitializedImageElement,
} from "@excalidraw/element";
import { clamp } from "@excalidraw/math";
import { exportToCanvas } from "@excalidraw/utils/export";

import { useCurrentFrameId, useFrameModel } from "../hooks/useFrameModel";
import { getShortcutKey } from "../shortcut";
import { useUIAppState } from "../context/ui-appState";
import { t } from "../i18n";

import { liveBookmarks, slideOrder } from "../frameNavigation";

import { useApp, useAppProps, useEditorInterface } from "./App";
import { FilledButton } from "./FilledButton";
import { eyeClosedIcon, eyeIcon, playerPlayIcon } from "./icons";

import "./FramesMenu.scss";

import type { Frame, FrameModel, FrameNode } from "../frameNavigation";
import type { AppClassProperties, FrameNavigation, Slide } from "../types";

const THUMBNAIL_PX = 96;
const THUMBNAIL_DEBOUNCE_MS = 500;
const SCROLL_EDGE_PX = 40;
const SCROLL_STEP_PX = 8;

const MOVES: Record<string, number> = {
  [KEYS.ARROW_UP]: -1,
  [KEYS.ARROW_DOWN]: 1,
};

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

const Thumb = ({ thumbnail }: { thumbnail?: Thumbnail }) => (
  <span className="frames-menu__thumb">
    {thumbnail && <img src={thumbnail.url} alt="" />}
  </span>
);

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
        <Thumb thumbnail={thumbnails.get(frame.id)} />
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

/** A grip held down, with the rows as they stood when it was pressed: the
 * transforms that draw the drag must not move where it lands. */
type Drag = {
  pointerId: number;
  from: number;
  startY: number;
  scrollTop: number;
  rows: readonly DOMRect[];
};

/** The drag as drawn: how far the held row has moved and where it lands. */
type Sorting = { from: number; to: number; dy: number; height: number };

const moved = (order: readonly Slide[], from: number, to: number) => {
  const next = order.filter((_, i) => i !== from);
  next.splice(to, 0, order[from]);
  return next;
};

/** How far row `i` is drawn from its place: the held row follows the
 * pointer, the rows it passes step aside by one row. */
const shift = ({ from, to, dy, height }: Sorting, i: number) => {
  if (i === from) {
    return dy;
  }
  const rest = i < from ? i : i - 1;
  return ((rest < to ? rest : rest + 1) - i) * height;
};

/**
 * The host's talk: Present, then the slides in order. A grip carries its
 * slide by pen, touch or mouse, or moves it with Alt+↑↓; the eye skips it.
 */
const Slides = ({
  slides,
  model,
  current,
  thumbnails,
  rows,
  onGo,
}: {
  slides: NonNullable<FrameNavigation["slides"]>;
  model: FrameModel;
  current: string | null;
  thumbnails: ReadonlyMap<string, Thumbnail>;
  rows: Map<string, HTMLButtonElement>;
  onGo(id: string, fromPointer: boolean): void;
}) => {
  const app = useApp();
  const order = slideOrder(model, slides.order);
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<Drag | null>(null);
  const [sorting, setSorting] = useState<Sorting | null>(null);

  const dragging = sorting !== null;
  useEffect(() => {
    if (!dragging) {
      return;
    }
    // on the window's way down, before the drawer closes on Escape
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        drag.current = null;
        setSorting(null);
      }
    };
    const win = app.ownerWindow;
    win.addEventListener("keydown", onKeyDown, true);
    return () => win.removeEventListener("keydown", onKeyDown, true);
  }, [app, dragging]);

  const follow = (d: Drag, clientY: number): Sorting => {
    const y = clientY + list.current!.scrollTop - d.scrollTop;
    const held = d.rows[d.from];
    return {
      from: d.from,
      to: d.rows.filter(
        (row, i) => i !== d.from && row.top + row.height / 2 < y,
      ).length,
      dy: clamp(
        y - d.startY,
        d.rows[0].top - held.top,
        d.rows[d.rows.length - 1].bottom - held.bottom,
      ),
      height: held.height,
    };
  };

  // a talk longer than the drawer scrolls while a slide is held at its edge
  const scrollAtEdge = (clientY: number) => {
    const scroller = list.current!;
    if (scroller.scrollHeight <= scroller.clientHeight) {
      return;
    }
    const { top, bottom } = scroller.getBoundingClientRect();
    if (clientY < top + SCROLL_EDGE_PX) {
      scroller.scrollTop -= SCROLL_STEP_PX;
    } else if (clientY > bottom - SCROLL_EDGE_PX) {
      scroller.scrollTop += SCROLL_STEP_PX;
    }
  };

  /** the drag this pointer holds; a second finger on the drawer has none */
  const dragOf = (event: React.PointerEvent) =>
    drag.current?.pointerId === event.pointerId ? drag.current : null;

  if (!order.length) {
    return (
      <p className="frames-menu__empty">{t("frameNavigation.noSlides")}</p>
    );
  }

  let number = 0;
  return (
    <>
      <FilledButton
        className="frames-menu__present"
        size="large"
        fullWidth
        icon={playerPlayIcon}
        label={t("frameNavigation.present")}
        disabled={!order.some((slide) => slide.included)}
        onClick={() => slides.onPresent()}
      />
      <ol
        ref={list}
        className={clsx("frames-menu__slides", { "is-sorting": dragging })}
      >
        {order.map((slide, i) => {
          const frame = model.byId.get(slide.frameId)!;
          number += slide.included ? 1 : 0;
          return (
            <li
              key={frame.id}
              className={clsx({
                "is-skipped": !slide.included,
                "is-held": sorting?.from === i,
              })}
              style={
                sorting
                  ? { transform: `translateY(${shift(sorting, i)}px)` }
                  : undefined
              }
            >
              <button
                type="button"
                className="frames-menu__grip"
                aria-label={t("frameNavigation.moveSlide", {
                  name: frame.name,
                })}
                onPointerDown={(event) => {
                  if (drag.current || event.button !== 0) {
                    return;
                  }
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    pointerId: event.pointerId,
                    from: i,
                    startY: event.clientY,
                    scrollTop: list.current!.scrollTop,
                    rows: [...list.current!.children].map((row) =>
                      row.getBoundingClientRect(),
                    ),
                  };
                  setSorting(follow(drag.current, event.clientY));
                }}
                onPointerMove={(event) => {
                  const d = dragOf(event);
                  if (d) {
                    scrollAtEdge(event.clientY);
                    setSorting(follow(d, event.clientY));
                  }
                }}
                onPointerUp={(event) => {
                  const d = dragOf(event);
                  if (!d) {
                    return;
                  }
                  drag.current = null;
                  setSorting(null);
                  const { to } = follow(d, event.clientY);
                  if (to !== d.from) {
                    slides.onChange(moved(order, d.from, to));
                  }
                }}
                onPointerCancel={(event) => {
                  if (dragOf(event)) {
                    drag.current = null;
                    setSorting(null);
                  }
                }}
                onKeyDown={(event) => {
                  const by = event.altKey ? MOVES[event.key] : undefined;
                  if (!by) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (order[i + by]) {
                    slides.onChange(moved(order, i, i + by));
                  }
                }}
              >
                ⋮⋮
              </button>
              <button
                type="button"
                className="frames-menu__go"
                data-frame={frame.id}
                ref={(node) => {
                  if (node) {
                    rows.set(frame.id, node);
                  } else {
                    rows.delete(frame.id);
                  }
                }}
                aria-current={frame.id === current ? "location" : undefined}
                onClick={(event) => onGo(frame.id, event.detail > 0)}
              >
                <span className="frames-menu__number">
                  {slide.included ? number : "–"}
                </span>
                <Thumb thumbnail={thumbnails.get(frame.id)} />
                <span className="frames-menu__name">{frame.name}</span>
              </button>
              <button
                type="button"
                className="frames-menu__skip"
                aria-pressed={!slide.included}
                aria-label={t(
                  slide.included
                    ? "frameNavigation.skipSlide"
                    : "frameNavigation.includeSlide",
                  { name: frame.name },
                )}
                onClick={() =>
                  slides.onChange(
                    order.map((s) =>
                      s === slide ? { ...s, included: !s.included } : s,
                    ),
                  )
                }
              >
                {slide.included ? eyeIcon : eyeClosedIcon}
              </button>
            </li>
          );
        })}
      </ol>
      <footer className="frames-menu__hint">
        {t("frameNavigation.slidesHint")}
      </footer>
    </>
  );
};

/**
 * The Frames tab of the default sidebar: bookmarks, then every frame as a
 * tree. Enter goes into a frame's first child, Escape out to its parent or,
 * at the top, closes the drawer. With the host's talk it opens on its
 * slides instead.
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
  const slides = frameNavigation?.slides;
  const [view, setView] = useState<"slides" | "frames">("slides");

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

  const views = slides && (
    <div className="frames-menu__views">
      <button
        type="button"
        aria-pressed={view === "slides"}
        onClick={() => setView("slides")}
      >
        {t("frameNavigation.slides")}
      </button>
      <button
        type="button"
        aria-pressed={view === "frames"}
        onClick={() => setView("frames")}
      >
        {t("frameNavigation.title")}
      </button>
    </div>
  );

  if (slides && view === "slides") {
    return (
      <div className="frames-menu">
        {views}
        <Slides
          slides={slides}
          model={model}
          current={current}
          thumbnails={thumbnails}
          rows={rows.current}
          onGo={go}
        />
      </div>
    );
  }

  return (
    <div className="frames-menu">
      {views}
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
