import clsx from "clsx";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { KEYS, isWritableElement } from "@excalidraw/common";

import { actionChangeOpacity } from "../../actions";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import {
  useApp,
  useExcalidrawContainer,
  useExcalidrawSetAppState,
} from "../App";
import {
  ArrowIcon,
  DiamondIcon,
  DotsHorizontalIcon,
  EllipseIcon,
  EraserIcon,
  FreedrawIcon,
  LineIcon,
  RectangleIcon,
  SelectionIcon,
  TextIcon,
  frameToolIcon,
  handIcon,
  stickyNoteToolIcon,
} from "../icons";
import {
  PEN_SIZE_SLIDER_MAX,
  penSizeFromSlider,
  sliderFromPenSize,
} from "../penSize";

import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "../App.radialPalette";

import { getActivePenPreset } from "./penPresets";
import { dropPuck, loadPuckPlace, savePuckPlace } from "./puckPlace";
import {
  FLICK_DISTANCE,
  HUB_RADIUS,
  MIDDLE_BAND,
  OPACITY_SLIDER,
  OUTER_BAND,
  RING_RADIUS,
  SIZE_SLIDER,
  TOOLS_BAND,
  arcPath,
  getRingLayout,
  hitTest,
  placeRing,
  polar,
  sectorMiddle,
  sectorPath,
  sliderAngle,
  sliderValue,
  toPolar,
} from "./radialLayout";
import { RADIAL_TOOLS } from "./radialPaletteController";
import { getStyleProperty } from "./styleProperties";

import "./RadialPalette.scss";

import type { ActionManager } from "../../actions/manager";
import type { PuckPlace } from "./puckPlace";
import type { RingHit, Sector, Slider } from "./radialLayout";
import type {
  ClientPoint,
  RadialPaletteController,
  RadialRing,
  RadialSession,
  RadialTool,
} from "./radialPaletteController";

type Icon = React.ReactElement<React.SVGProps<SVGSVGElement>>;

/** an icon as a square of `--control-icon-size` centered on `x, y` */
/** puts an icon in its segment: a bare svg takes the place itself, anything
 * else (a host's component, say) fills a placed svg around it */
const placeIcon = (icon: Icon, x: number, y: number) => {
  const place = {
    x: x - 9,
    y: y - 9,
    width: 18,
    height: 18,
    className: "RadialPalette__icon",
  };
  return icon.type === "svg" ? (
    React.cloneElement(icon, place)
  ) : (
    <svg {...place}>{icon}</svg>
  );
};

const TOOL_ICONS: Record<RadialTool, Icon> = {
  selection: SelectionIcon,
  hand: handIcon,
  rectangle: RectangleIcon,
  diamond: DiamondIcon,
  ellipse: EllipseIcon,
  arrow: ArrowIcon,
  line: LineIcon,
  freedraw: FreedrawIcon,
  text: TextIcon,
  stickynote: stickyNoteToolIcon,
  frame: frameToolIcon,
};

/** the ring each hit kind's items belong to */
const RING_OF = { tool: "tools", pen: "pens", color: "colors" } as const;

/** how far a finger travels before it is a flick: a finger rolls by more
 * than a pen or a mouse drifts as it lifts, in CSS px */
const TOUCH_FLICK_DISTANCE = 24;

/** whether two hits are on the same slice, slider or empty space */
const isSameTarget = (a: RingHit | null, b: RingHit | null) =>
  a?.kind === b?.kind &&
  (a && "index" in a && b && "index" in b ? a.index === b.index : true);

/** one opacity step on the ring */
const OPACITY_STEP = 5;

const toOpacity = (value: number) =>
  Math.max(
    OPACITY_STEP,
    Math.round((value * 100) / OPACITY_STEP) * OPACITY_STEP,
  );

const toPenSize = (value: number) =>
  penSizeFromSlider(value * PEN_SIZE_SLIDER_MAX);

/** a sample stroke's width on the ring, from the pen's width */
const sampleWidth = (penSize: number) => {
  const position = sliderFromPenSize(penSize) / PEN_SIZE_SLIDER_MAX;
  return 1 + 11 * position * position;
};

const SAMPLE_STROKE = "M -12 3 C -8 -6, -2 -6, 0 0 S 8 6, 12 -3";

const isPaletteKey = (event: KeyboardEvent) =>
  event.key === KEYS.COMMA &&
  !event.repeat &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey;

/** a field the user types in, `contenteditable` included */
const isTypingTarget = (target: EventTarget | null) =>
  isWritableElement(target) ||
  (target instanceof Element &&
    !!target.closest('[contenteditable]:not([contenteditable="false"])'));

/** how long after a press on the radial lifts its context menu event may
 * still come: Windows sends it on the lift, others with the hold */
const MENU_AFTER_LIFT_MS = 300;

/**
 * Keeps every context menu shut, the browser's and the editor's, while a
 * press on the radial lasts: a hold there is the radial's, never a
 * right-click, wherever the platform sends its menu event (the puck, or the
 * canvas a drag has moved over). Returns the release; after a hold, the
 * menus stay shut a moment longer, for the event Windows sends on the lift.
 */
const holdMenusShut = (win: Window) => {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const open = () => win.removeEventListener("contextmenu", swallow, true);
  win.addEventListener("contextmenu", swallow, true);
  let released = false;
  return (afterHold: boolean) => {
    if (released) {
      return;
    }
    released = true;
    if (afterHold) {
      win.setTimeout(open, MENU_AFTER_LIFT_MS);
    } else {
      open();
    }
  };
};

/** keeps the browser's menu shut over the radial's own parts */
const preventMenu = (event: React.MouseEvent) => event.preventDefault();

/**
 * The radial palette: a puck that opens into a ring of shapes, pens,
 * colors, pen size and opacity. `,` opens it at the pointer; the editor
 * opens it on a long press or a pen's barrel button. Closed, it renders
 * only the puck and reads no app state.
 */
export const RadialPalette = React.memo(
  ({
    actionManager,
    phone,
    besideSidebar,
  }: {
    actionManager: ActionManager;
    phone: boolean;
    /** a sidebar is open on the editor's right, where the puck sits */
    besideSidebar: boolean;
  }) => {
    const app = useApp();
    const { container } = useExcalidrawContainer();
    const controller = app.radialPalette;
    const session = useSyncExternalStore(
      controller.subscribe,
      () => controller.session,
    );

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        const { target } = event;
        const doc = app.ownerDocument;
        // like the editor's own shortcuts: from inside the editor, or from
        // anywhere with `handleKeyboardGlobally`, but never from a host's
        // focused control while nothing in the editor has focus
        const fromHost =
          target instanceof Element &&
          target !== doc.body &&
          target !== doc.documentElement &&
          !container?.contains(target);
        if (
          !isPaletteKey(event) ||
          isTypingTarget(target) ||
          (fromHost && !app.props.handleKeyboardGlobally) ||
          app.state.editingTextElement ||
          app.state.openDialog ||
          app.state.viewModeEnabled
        ) {
          return;
        }
        event.preventDefault();
        controller.toggle();
      };
      const doc = app.ownerDocument;
      doc.addEventListener("keydown", onKeyDown);
      return () => doc.removeEventListener("keydown", onKeyDown);
    }, [app, controller, container]);

    const puckCenter = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const [place, setPlace] = useState<PuckPlace | null>(() =>
      loadPuckPlace(app.ownerWindow),
    );
    /** where a puck being moved is, as fractions of the editor */
    const [moving, setMoving] = useState<ClientPoint | null>(null);
    /** ends the press in progress, if any */
    const endPress = useRef<((afterHold?: boolean) => void) | null>(null);
    useEffect(() => () => endPress.current?.(false), []);

    const keep = (next: PuckPlace) => {
      setPlace(next);
      savePuckPlace(app.ownerWindow, next);
    };

    const inEditor = (clientX: number, clientY: number) => {
      const { offsetLeft, offsetTop, width, height } = app.state;
      return {
        at: { x: clientX - offsetLeft, y: clientY - offsetTop },
        bounds: { width, height },
      };
    };

    const fractionAt = (clientX: number, clientY: number) => {
      const { at, bounds } = inEditor(clientX, clientY);
      const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
      return {
        x: clamp01(at.x / bounds.width),
        y: clamp01(at.y / bounds.height),
      };
    };

    /**
     * A press opens nothing yet, like Sporefall Station's sticks, which
     * appear only once the thumb moves. Held still for the long press, it
     * lifts the puck, which follows the pointer until it is dropped. Moved
     * first, it opens the ring and hands it the flick. Lifted first, it is a
     * tap and opens the ring for taps. A dot (a collapsed puck) lifts as soon
     * as it is dragged, and a tap on it brings the puck back.
     */
    const trackPress = (
      event: React.PointerEvent<HTMLButtonElement>,
      collapsed: boolean,
    ) => {
      endPress.current?.();
      const win = app.ownerWindow;
      const { pointerId } = event;
      const start = { x: event.clientX, y: event.clientY };
      const center = puckCenter(event.currentTarget);
      const releaseMenus = holdMenusShut(win);
      let lifted = false;
      const liftPuck = () => {
        lifted = true;
        controller.close();
        setMoving(fractionAt(start.x, start.y));
      };
      const timer = collapsed
        ? undefined
        : win.setTimeout(liftPuck, LONG_PRESS_DELAY);
      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        if (!lifted) {
          const travel = Math.hypot(
            moveEvent.clientX - start.x,
            moveEvent.clientY - start.y,
          );
          if (travel <= LONG_PRESS_TOLERANCE) {
            return;
          }
          if (!collapsed) {
            end();
            controller.open({ at: center, flick: { pointerId, start } });
            return;
          }
          liftPuck();
        }
        setMoving(fractionAt(moveEvent.clientX, moveEvent.clientY));
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        end();
        if (lifted) {
          const { at, bounds } = inEditor(upEvent.clientX, upEvent.clientY);
          keep(dropPuck(at, bounds));
        } else if (collapsed && place) {
          keep({ ...place, collapsed: false });
        } else if (!collapsed) {
          controller.open({ at: center });
        }
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === pointerId) {
          end();
        }
      };
      const end = (afterHold = lifted) => {
        win.clearTimeout(timer);
        win.removeEventListener("pointermove", onMove);
        win.removeEventListener("pointerup", onUp);
        win.removeEventListener("pointercancel", onCancel);
        releaseMenus(afterHold);
        setMoving(null);
        endPress.current = null;
      };
      endPress.current = end;
      win.addEventListener("pointermove", onMove);
      win.addEventListener("pointerup", onUp);
      win.addEventListener("pointercancel", onCancel);
    };

    const shown = moving ?? place;
    const collapsed = !moving && !!place?.collapsed;

    return (
      <>
        <button
          type="button"
          className={clsx("RadialPalette__puck", {
            "RadialPalette__puck--phone": phone,
            "RadialPalette__puck--beside-sidebar": besideSidebar,
            "RadialPalette__puck--placed": !!shown,
            "RadialPalette__puck--moving": !!moving,
            "RadialPalette__puck--collapsed": collapsed,
          })}
          style={
            shown
              ? ({
                  "--radial-puck-x": `${shown.x * 100}%`,
                  "--radial-puck-y": `${shown.y * 100}%`,
                } as React.CSSProperties)
              : undefined
          }
          aria-label={t(
            collapsed ? "radialPalette.expand" : "radialPalette.open",
          )}
          title={
            collapsed
              ? t("radialPalette.expand")
              : `${t("radialPalette.open")} — ,`
          }
          aria-expanded={!!session}
          data-testid="radial-palette-puck"
          onContextMenu={preventMenu}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            if (session) {
              controller.close();
              return;
            }
            trackPress(event, collapsed);
          }}
          onClick={(event) => {
            // a keyboard press; pointers open it on pointerdown
            if (event.detail !== 0) {
              return;
            }
            if (collapsed && place) {
              keep({ ...place, collapsed: false });
            } else if (session) {
              controller.close();
            } else {
              controller.open({ at: puckCenter(event.currentTarget) });
            }
          }}
        >
          <svg viewBox="-12 -12 24 24" aria-hidden="true">
            <circle r="10" className="RadialPalette__puck-ring" />
            <circle r="5.5" className="RadialPalette__puck-ring" />
            <circle r="2" className="RadialPalette__puck-dot" />
          </svg>
        </button>
        {session && (
          <Ring
            session={session}
            controller={controller}
            actionManager={actionManager}
            onMoved={(at) =>
              keep({ ...fractionAt(at.x, at.y), collapsed: false })
            }
          />
        )}
      </>
    );
  },
);
RadialPalette.displayName = "RadialPalette";

const Ring = ({
  session,
  controller,
  actionManager,
  onMoved,
}: {
  session: RadialSession;
  controller: RadialPaletteController;
  actionManager: ActionManager;
  /** the ring was dragged by its hub and dropped, centered at `at` */
  onMoved: (at: ClientPoint) => void;
}) => {
  const app = useApp();
  const appState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  const { offsetLeft, offsetTop, width, height } = appState;
  /** where the ring is drawn when it is open at `at`, in client terms */
  const drawnAt = (at: ClientPoint) => {
    const placed = placeRing(
      { x: at.x - offsetLeft, y: at.y - offsetTop },
      { width, height },
    );
    return { x: placed.x + offsetLeft, y: placed.y + offsetTop };
  };
  const place = placeRing(
    { x: session.at.x - offsetLeft, y: session.at.y - offsetTop },
    { width, height },
  );

  // the style ring shows its properties, or one's options, in the tools band
  const styleRing = session.ring === "style";
  const toolsRing: RadialRing = styleRing ? "style" : "tools";
  const ringOf = (kind: keyof typeof RING_OF): RadialRing =>
    kind === "tool" ? toolsRing : RING_OF[kind];
  const styleItems = styleRing ? controller.items("style") : [];
  const styleProperty = session.style && getStyleProperty(session.style);
  const selected = app.scene.getSelectedElements(appState);
  const styleIcon = (index: number): Icon | null => {
    if (styleProperty) {
      return (styleProperty.options[index]?.icon as Icon) ?? null;
    }
    const property = getStyleProperty(styleItems[index].id);
    if (!property) {
      return null;
    }
    const current = property.current(selected, app.state);
    return (
      property.options.find((option) => option.value === current) ??
      property.options[0]
    )?.icon as Icon;
  };

  const colors = controller.colorSlots();
  const presets = controller.getPresets();
  const hostPens = controller.hostPens();
  // a host pen width replaces the user's, so the size arc would do nothing
  const showSize = app.props.freedrawStrokeWidth === undefined;
  const layout = getRingLayout({
    tools: styleRing ? styleItems.length : RADIAL_TOOLS.length,
    pens: presets.length + hostPens.length + 1,
    // the fill chip ends the arc
    colors: colors.length + 1,
  });

  const [sliderHover, setSliderHover] = useState<"size" | "opacity" | null>(
    null,
  );
  const [dragging, setDragging] = useState<"size" | "opacity" | null>(null);

  const toLocal = (clientX: number, clientY: number) => ({
    dx: (clientX - offsetLeft - place.x) / place.scale,
    dy: (clientY - offsetTop - place.y) / place.scale,
  });

  const hitAt = (clientX: number, clientY: number) => {
    const { dx, dy } = toLocal(clientX, clientY);
    return hitTest(layout, dx, dy, { size: showSize });
  };

  /** highlights what a pointer is over, as a knob would */
  const follow = (hit: RingHit | null) => {
    setSliderHover(
      hit?.kind === "size" || hit?.kind === "opacity" ? hit.kind : null,
    );
    if (hit && (hit.kind === "tool" || hit.kind === "pen")) {
      controller.highlight(ringOf(hit.kind), hit.index);
    } else if (hit?.kind === "color" && colors[hit.index]) {
      controller.highlight("colors", hit.index);
    }
  };

  const previewSlider = (hit: RingHit) => {
    if (hit.kind === "size") {
      setAppState({ currentItemFreedrawStrokeWidth: toPenSize(hit.value) });
    } else if (hit.kind === "opacity") {
      setAppState({ currentItemOpacity: toOpacity(hit.value) });
    }
  };

  const commitOpacity = () => {
    // one history entry for the whole drag, and the selection follows
    actionManager.executeAction(
      actionChangeOpacity,
      "ui",
      app.state.currentItemOpacity,
    );
  };

  // the handlers a flick calls, current as of the last render
  const latest = useRef({ hitAt, follow, previewSlider, commitOpacity });
  latest.current = { hitAt, follow, previewSlider, commitOpacity };

  // a flick: press, drag to a segment, lift to pick it
  const { flick } = session;
  useEffect(() => {
    if (!flick) {
      return;
    }
    const win = app.ownerWindow;
    // what the pointer was over when the ring opened: a finger rolling on
    // it as it lifts is not a flick, so a long press near an edge, where
    // the ring opens under the finger, picks nothing by accident
    const startHit = latest.current.hitAt(flick.start.x, flick.start.y);
    let moved = false;
    let last: RingHit | null = null;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== flick.pointerId) {
        return;
      }
      const hit = latest.current.hitAt(event.clientX, event.clientY);
      moved ||=
        Math.hypot(
          event.clientX - flick.start.x,
          event.clientY - flick.start.y,
        ) >
          (event.pointerType === "touch"
            ? TOUCH_FLICK_DISTANCE
            : FLICK_DISTANCE) && !isSameTarget(hit, startHit);
      if (!moved) {
        return;
      }
      last = hit;
      latest.current.follow(last);
      if (last?.kind === "size" || last?.kind === "opacity") {
        latest.current.previewSlider(last);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== flick.pointerId) {
        return;
      }
      setSliderHover(null);
      if (!moved) {
        // a tap or a long press held still: the ring stays open for a tap
        controller.endFlick();
        return;
      }
      const hit: RingHit | null = last;
      if (hit?.kind === "opacity") {
        latest.current.commitOpacity();
      }
      const picked =
        (hit?.kind === "tool" ||
          hit?.kind === "pen" ||
          hit?.kind === "color") &&
        controller.pick(
          hit.kind === "tool" ? toolsRing : RING_OF[hit.kind],
          hit.index,
        );
      if (!picked) {
        controller.close();
      }
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === flick.pointerId) {
        setSliderHover(null);
        controller.endFlick();
      }
    };
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
    win.addEventListener("pointercancel", onCancel);
    return () => {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      win.removeEventListener("pointercancel", onCancel);
    };
  }, [app, controller, flick, toolsRing]);

  const ringRef = useRef<HTMLDivElement>(null);

  // a press on a slice focuses it; when the ring goes, that slice goes with
  // it and focus would fall to the page, where the editor takes no Ctrl+Z.
  // Focus goes back to the editor instead, unless it has moved elsewhere
  // (redaphid/excalidraw#283)
  useLayoutEffect(() => {
    const ring = ringRef.current;
    return () => {
      const doc = app.ownerDocument;
      const active = doc.activeElement;
      if (!active || active === doc.body || ring?.contains(active)) {
        app.focusContainer();
      }
    };
  }, [app]);
  // a long press opens the ring under the finger, and the browser's click
  // on release lands on the hub or a slice; only a press made on the ring
  // counts
  const pressedOnRing = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // typing in a field elsewhere, e.g. while a knob holds the ring open
      if (
        isTypingTarget(event.target) &&
        !(
          event.target instanceof Node &&
          ringRef.current?.contains(event.target)
        )
      ) {
        return;
      }
      if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        controller.close();
        return;
      }
      // a focused segment or slider handles its own keys
      if (
        event.target instanceof Node &&
        ringRef.current?.contains(event.target)
      ) {
        return;
      }
      const action = {
        [KEYS.ARROW_RIGHT]: () => controller.step(1),
        [KEYS.ARROW_LEFT]: () => controller.step(-1),
        [KEYS.ARROW_UP]: () => controller.stepRing(1),
        [KEYS.ARROW_DOWN]: () => controller.stepRing(-1),
        [KEYS.ENTER]: () => controller.choose(),
      }[event.key];
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        action();
      }
    };
    const doc = app.ownerDocument;
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [app, controller]);

  /** the ring being moved by its hub */
  const [moving, setMoving] = useState(false);
  /** ends the hub press in progress, if any */
  const endHubPress = useRef<((afterHold?: boolean) => void) | null>(null);
  useEffect(() => () => endHubPress.current?.(false), []);
  /** the click that follows a hold or a drag on the hub is no tap */
  const hubClickSpent = useRef(false);

  /**
   * A press on the hub: held still for the long press, it lifts the ring,
   * which follows the pointer, stays open where it is dropped, and takes the
   * puck there. Lifted first, it is a tap and opens the context menu.
   */
  const trackHubPress = (event: React.PointerEvent<SVGGElement>) => {
    if (event.button !== 0) {
      return;
    }
    endHubPress.current?.();
    hubClickSpent.current = false;
    const win = app.ownerWindow;
    const { pointerId } = event;
    const start = { x: event.clientX, y: event.clientY };
    // from where the ring is drawn, which an edge may have pushed in from
    // where it was opened, so it follows the finger from the first move
    const from = drawnAt(session.at);
    const releaseMenus = holdMenusShut(win);
    let lifted = false;
    let at = from;
    const timer = win.setTimeout(() => {
      lifted = true;
      hubClickSpent.current = true;
      setMoving(true);
    }, LONG_PRESS_DELAY);
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      if (!lifted) {
        if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE) {
          // a drag before the hold is no tap, and moves nothing
          hubClickSpent.current = true;
          end();
        }
        return;
      }
      at = { x: from.x + dx, y: from.y + dy };
      controller.moveTo(at);
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      end();
      if (lifted && at !== from) {
        const dropped = drawnAt(at);
        controller.moveTo(dropped);
        onMoved(dropped);
      }
    };
    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) {
        end();
      }
    };
    const end = (afterHold = lifted) => {
      win.clearTimeout(timer);
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerup", onUp);
      win.removeEventListener("pointercancel", onCancel);
      releaseMenus(afterHold);
      setMoving(false);
      endHubPress.current = null;
    };
    endHubPress.current = end;
    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerup", onUp);
    win.addEventListener("pointercancel", onCancel);
  };

  const isHighlighted = (ring: RadialRing, index: number) =>
    session.ring === ring && session.index === index;

  const activePreset =
    appState.activeTool.type === "freedraw"
      ? getActivePenPreset(presets, appState)
      : null;
  const activeColor = (
    controller.colorsFill
      ? appState.currentItemBackgroundColor
      : appState.currentItemStrokeColor
  ).toLowerCase();

  const button = (
    key: string,
    label: string,
    testId: string,
    ring: RadialRing,
    index: number,
    active: boolean,
    path: string,
    children: React.ReactNode,
    disabled = false,
  ) => (
    <g
      key={key}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      className={clsx("RadialPalette__segment", {
        "RadialPalette__segment--active": active,
        "RadialPalette__segment--highlight":
          !disabled && isHighlighted(ring, index),
        "RadialPalette__segment--disabled": disabled,
      })}
      onPointerDown={(event) =>
        !disabled &&
        controller.hold(ring, index, LONG_PRESS_DELAY, {
          x: event.clientX,
          y: event.clientY,
        })
      }
      onPointerMove={(event) =>
        controller.drift({ x: event.clientX, y: event.clientY })
      }
      onPointerUp={controller.release}
      onPointerLeave={controller.release}
      onPointerCancel={controller.release}
      onClick={() => !disabled && controller.pick(ring, index)}
      onKeyDown={(event) => {
        if (!disabled && (event.key === KEYS.ENTER || event.key === " ")) {
          event.preventDefault();
          controller.pick(ring, index);
        }
      }}
    >
      <title>{label}</title>
      <path d={path} className="RadialPalette__segment-bg" />
      <g className="RadialPalette__segment-content">{children}</g>
    </g>
  );

  const at = (radius: number, sector: Sector) =>
    polar(radius, sectorMiddle(sector));

  const slider = (
    kind: "size" | "opacity",
    config: Slider,
    value: number,
    label: string,
    valueText: string,
  ) => {
    const radius = OUTER_BAND.inner + 17;
    const knob = polar(radius, sliderAngle(config, value));
    const low = polar(
      radius,
      config.from + Math.sign(config.from - config.to) * 4,
    );
    const high = polar(
      radius,
      config.to + Math.sign(config.to - config.from) * 4,
    );
    const step = (delta: number) =>
      kind === "size"
        ? setAppState({
            currentItemFreedrawStrokeWidth: toPenSize(
              Math.min(1, Math.max(0, value + delta)),
            ),
          })
        : actionManager.executeAction(
            actionChangeOpacity,
            "ui",
            toOpacity(Math.min(1, Math.max(0, value + delta))),
          );
    return (
      <g
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={valueText}
        data-testid={`radial-${kind}`}
        className={clsx("RadialPalette__slider", {
          "RadialPalette__slider--active":
            dragging === kind || sliderHover === kind,
        })}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.ownerSVGElement?.setPointerCapture?.(
            event.pointerId,
          );
          setDragging(kind);
          const hit = hitAt(event.clientX, event.clientY);
          if (hit?.kind === kind) {
            previewSlider(hit);
          }
        }}
        onKeyDown={(event) => {
          const delta =
            event.key === KEYS.ARROW_UP || event.key === KEYS.ARROW_RIGHT
              ? 0.05
              : event.key === KEYS.ARROW_DOWN || event.key === KEYS.ARROW_LEFT
              ? -0.05
              : 0;
          if (delta) {
            event.preventDefault();
            step(delta);
          }
        }}
      >
        <title>{label}</title>
        <path
          className="RadialPalette__slider-hit"
          d={sectorPath(OUTER_BAND, {
            start: Math.min(config.from, config.to) - 2,
            end: Math.max(config.from, config.to) + 2,
          })}
        />
        <path
          className="RadialPalette__slider-track"
          d={arcPath(radius, config.from, config.to)}
        />
        <path
          className="RadialPalette__slider-value"
          d={arcPath(radius, config.from, sliderAngle(config, value))}
        />
        <circle
          className="RadialPalette__slider-end"
          cx={low.x}
          cy={low.y}
          r={kind === "size" ? 1.5 : 3}
          opacity={kind === "size" ? 1 : 0.25}
        />
        <circle
          className="RadialPalette__slider-end"
          cx={high.x}
          cy={high.y}
          r={kind === "size" ? 4.5 : 3}
        />
        <circle
          className="RadialPalette__slider-knob"
          cx={knob.x}
          cy={knob.y}
          r={8}
        />
      </g>
    );
  };

  const size = RING_RADIUS * 2 * place.scale;
  const penSize = appState.currentItemFreedrawStrokeWidth;
  const sizeValue = sliderFromPenSize(penSize) / PEN_SIZE_SLIDER_MAX;
  const opacityValue = appState.currentItemOpacity / 100;

  return (
    <>
      <div
        className="RadialPalette__backdrop"
        data-testid="radial-palette-backdrop"
        onContextMenu={preventMenu}
        onPointerDown={(event) => {
          event.preventDefault();
          controller.close();
        }}
      />
      <div
        ref={ringRef}
        className={clsx("RadialPalette", {
          "RadialPalette--moving": moving,
        })}
        role="dialog"
        aria-label={t("radialPalette.open")}
        data-testid="radial-palette"
        data-ring={session.ring}
        onContextMenu={preventMenu}
        onPointerDownCapture={() => {
          pressedOnRing.current = true;
        }}
        onClickCapture={(event) => {
          if (!pressedOnRing.current && event.detail > 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        style={{
          left: place.x - size / 2,
          top: place.y - size / 2,
          width: size,
          height: size,
        }}
      >
        <div className="RadialPalette__disc" />
        <svg
          viewBox={`${-RING_RADIUS} ${-RING_RADIUS} ${RING_RADIUS * 2} ${
            RING_RADIUS * 2
          }`}
          width={size}
          height={size}
          onPointerMove={(event) => {
            if (!dragging) {
              if (event.pointerType === "mouse" && !flick) {
                follow(hitAt(event.clientX, event.clientY));
              }
              return;
            }
            const hit = hitAt(event.clientX, event.clientY);
            const { dx, dy } = toLocal(event.clientX, event.clientY);
            // past the arc's ends the value clamps; anywhere is fine
            previewSlider(
              hit?.kind === dragging
                ? hit
                : {
                    kind: dragging,
                    value: sliderValue(
                      dragging === "size" ? SIZE_SLIDER : OPACITY_SLIDER,
                      toPolar(dx, dy).angle,
                    ),
                  },
            );
          }}
          onPointerUp={() => {
            if (dragging === "opacity") {
              commitOpacity();
            }
            setDragging(null);
          }}
        >
          <circle r={MIDDLE_BAND.outer + 1} className="RadialPalette__rule" />
          <circle r={TOOLS_BAND.outer + 1} className="RadialPalette__rule" />
          <circle r={HUB_RADIUS + 1} className="RadialPalette__rule" />

          {styleRing &&
            styleItems.map((item, index) => {
              const sector = layout.tools[index];
              const { x, y } = at(
                (TOOLS_BAND.inner + TOOLS_BAND.outer) / 2,
                sector,
              );
              return button(
                `style-${index}`,
                item.label,
                styleProperty
                  ? `radial-style-option-${index}`
                  : `radial-style-${item.id}`,
                "style",
                index,
                false,
                sectorPath(TOOLS_BAND, sector),
                styleIcon(index) && placeIcon(styleIcon(index)!, x, y),
              );
            })}

          {!styleRing &&
            RADIAL_TOOLS.map((type, index) => {
              const sector = layout.tools[index];
              const { x, y } = at(
                (TOOLS_BAND.inner + TOOLS_BAND.outer) / 2,
                sector,
              );
              return button(
                type,
                t(`toolBar.${type}` as const),
                `radial-tool-${type}`,
                "tools",
                index,
                appState.activeTool.type === type,
                sectorPath(TOOLS_BAND, sector),
                placeIcon(TOOL_ICONS[type], x, y),
              );
            })}

          {[...presets, ...hostPens, null].map((preset, index) => {
            const sector = layout.pens[index];
            const icon = at(
              (MIDDLE_BAND.inner + MIDDLE_BAND.outer) / 2,
              sector,
            );
            // stacked, not along the radius: side by side, the two would
            // overlap on the ring's left and right
            const sample = { x: icon.x, y: icon.y + 7 };
            const label = { x: icon.x, y: icon.y - 12 };
            if (preset && "onPick" in preset) {
              return button(
                `host-${preset.id}`,
                preset.label,
                `radial-pen-host-${preset.id}`,
                "pens",
                index,
                !!preset.active,
                sectorPath(MIDDLE_BAND, sector),
                placeIcon(preset.icon, icon.x, icon.y),
              );
            }
            if (!preset) {
              return button(
                "eraser",
                t("toolBar.eraser"),
                "radial-tool-eraser",
                "pens",
                index,
                appState.activeTool.type === "eraser",
                sectorPath(MIDDLE_BAND, sector),
                placeIcon(EraserIcon, icon.x, icon.y),
              );
            }
            return button(
              preset.id,
              t(`radialPalette.pen_${preset.id}` as const),
              `radial-pen-${preset.id}`,
              "pens",
              index,
              activePreset?.id === preset.id,
              sectorPath(MIDDLE_BAND, sector),
              <>
                <path
                  d={SAMPLE_STROKE}
                  transform={`translate(${sample.x} ${sample.y})`}
                  className="RadialPalette__sample"
                  stroke={appState.currentItemStrokeColor}
                  strokeWidth={sampleWidth(
                    preset.state.currentItemFreedrawStrokeWidth,
                  )}
                  opacity={preset.state.currentItemOpacity / 100}
                />
                <text x={label.x} y={label.y} className="RadialPalette__label">
                  {t(`radialPalette.pen_${preset.id}` as const)}
                </text>
              </>,
            );
          })}

          {colors.map((color, index) => {
            const sector = layout.colors[index];
            const { x, y } = at(
              (OUTER_BAND.inner + OUTER_BAND.outer) / 2,
              sector,
            );
            return button(
              `color-${index}`,
              color ?? t("radialPalette.emptyRecent"),
              `radial-color-${index}`,
              "colors",
              index,
              !!color && color.toLowerCase() === activeColor,
              sectorPath(OUTER_BAND, sector),
              <circle
                cx={x}
                cy={y}
                r={10}
                className={clsx("RadialPalette__swatch", {
                  "RadialPalette__swatch--empty": !color,
                })}
                fill={color ?? "none"}
              />,
              !color,
            );
          })}

          {(() => {
            const sector = layout.colors[colors.length];
            const { x, y } = at(
              (OUTER_BAND.inner + OUTER_BAND.outer) / 2,
              sector,
            );
            return button(
              "color-fill",
              t("radialPalette.fill"),
              "radial-color-fill",
              "colors",
              controller.items("colors").length - 1,
              controller.colorsFill,
              sectorPath(OUTER_BAND, sector),
              <text x={x} y={y} className="RadialPalette__label">
                {t("radialPalette.fill")}
              </text>,
            );
          })()}

          {showSize &&
            slider(
              "size",
              SIZE_SLIDER,
              sizeValue,
              t("labels.penSize"),
              penSize.toFixed(2),
            )}
          {slider(
            "opacity",
            OPACITY_SLIDER,
            opacityValue,
            t("labels.opacity"),
            `${appState.currentItemOpacity}%`,
          )}

          <g
            role="button"
            tabIndex={0}
            aria-label={t("radialPalette.menu")}
            data-testid="radial-palette-menu"
            className="RadialPalette__hub"
            onPointerDown={trackHubPress}
            onClick={() => {
              if (hubClickSpent.current) {
                hubClickSpent.current = false;
                return;
              }
              controller.menu();
            }}
            onKeyDown={(event) => {
              if (event.key === KEYS.ENTER || event.key === " ") {
                event.preventDefault();
                controller.menu();
              }
            }}
          >
            <title>{t("radialPalette.menu")}</title>
            <circle r={HUB_RADIUS} className="RadialPalette__hub-bg" />
            {placeIcon(DotsHorizontalIcon, 0, -5)}
            <circle
              cy={13}
              r={Math.min(6, Math.max(2, sampleWidth(penSize) / 2 + 1))}
              fill={appState.currentItemStrokeColor}
              opacity={appState.currentItemOpacity / 100}
            />
          </g>
        </svg>
      </div>
    </>
  );
};
