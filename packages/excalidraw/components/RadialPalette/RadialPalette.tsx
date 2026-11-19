import clsx from "clsx";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { KEYS, isWritableElement } from "@excalidraw/common";

import { actionChangeOpacity } from "../../actions";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { useApp, useExcalidrawSetAppState } from "../App";
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
  stickyNoteToolIcon,
} from "../icons";
import {
  PEN_SIZE_SLIDER_MAX,
  penSizeFromSlider,
  sliderFromPenSize,
} from "../penSize";

import { getActivePenPreset } from "./penPresets";
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
import { RECENT_COLOR_SLOTS } from "./themeInks";

import "./RadialPalette.scss";

import type { ActionManager } from "../../actions/manager";
import type { RingHit, Sector, Slider } from "./radialLayout";
import type {
  RadialPaletteController,
  RadialRing,
  RadialSession,
  RadialTool,
} from "./radialPaletteController";

type Icon = React.ReactElement<React.SVGProps<SVGSVGElement>>;

/** an icon as a square of `--control-icon-size` centered on `x, y` */
const placeIcon = (icon: Icon, x: number, y: number) =>
  React.cloneElement(icon, {
    x: x - 9,
    y: y - 9,
    width: 18,
    height: 18,
    className: "RadialPalette__icon",
  });

const TOOL_ICONS: Record<RadialTool, Icon> = {
  selection: SelectionIcon,
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
  event.key === KEYS.COMMA && !event.ctrlKey && !event.metaKey && !event.altKey;

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
  }: {
    actionManager: ActionManager;
    phone: boolean;
  }) => {
    const app = useApp();
    const controller = app.radialPalette;
    const session = useSyncExternalStore(
      controller.subscribe,
      () => controller.session,
    );

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          !isPaletteKey(event) ||
          isWritableElement(event.target) ||
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
    }, [app, controller]);

    const puckCenter = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    return (
      <>
        <button
          type="button"
          className={clsx("RadialPalette__puck", {
            "RadialPalette__puck--phone": phone,
          })}
          aria-label={t("radialPalette.open")}
          title={`${t("radialPalette.open")} — ,`}
          aria-expanded={!!session}
          data-testid="radial-palette-puck"
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            if (session) {
              controller.close();
              return;
            }
            controller.open({
              at: puckCenter(event.currentTarget),
              flick: {
                pointerId: event.pointerId,
                start: { x: event.clientX, y: event.clientY },
              },
            });
          }}
          onClick={(event) => {
            // a keyboard press; pointers open it on pointerdown
            if (event.detail === 0) {
              if (session) {
                controller.close();
              } else {
                controller.open({ at: puckCenter(event.currentTarget) });
              }
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
}: {
  session: RadialSession;
  controller: RadialPaletteController;
  actionManager: ActionManager;
}) => {
  const app = useApp();
  const appState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  const { offsetLeft, offsetTop, width, height } = appState;
  const place = placeRing(
    { x: session.at.x - offsetLeft, y: session.at.y - offsetTop },
    { width, height },
  );

  const themeColors = controller.getThemeColors();
  const recent = controller.recentColors;
  const colors: readonly (string | null)[] = [
    ...themeColors,
    ...Array.from(
      { length: RECENT_COLOR_SLOTS },
      (_, index) => recent[index] ?? null,
    ),
  ];
  const presets = controller.getPresets();
  // a host pen width replaces the user's, so the size arc would do nothing
  const showSize = app.props.freedrawStrokeWidth === undefined;
  const layout = getRingLayout({
    tools: RADIAL_TOOLS.length,
    pens: presets.length + 1,
    colors: colors.length,
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
      controller.highlight(RING_OF[hit.kind], hit.index);
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
    let moved = false;
    let last: RingHit | null = null;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== flick.pointerId) {
        return;
      }
      moved ||=
        Math.hypot(
          event.clientX - flick.start.x,
          event.clientY - flick.start.y,
        ) > FLICK_DISTANCE;
      if (!moved) {
        return;
      }
      last = latest.current.hitAt(event.clientX, event.clientY);
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
        controller.pick(RING_OF[hit.kind], hit.index);
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
  }, [app, controller, flick]);

  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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

  const isHighlighted = (ring: RadialRing, index: number) =>
    session.ring === ring && session.index === index;

  const activePreset =
    appState.activeTool.type === "freedraw"
      ? getActivePenPreset(presets, appState)
      : null;
  const strokeColor = appState.currentItemStrokeColor.toLowerCase();

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
  const preventMenu = (event: React.MouseEvent) => event.preventDefault();

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
        className="RadialPalette"
        role="dialog"
        aria-label={t("radialPalette.open")}
        data-testid="radial-palette"
        data-ring={session.ring}
        onContextMenu={preventMenu}
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

          {RADIAL_TOOLS.map((type, index) => {
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

          {[...presets, null].map((preset, index) => {
            const sector = layout.pens[index];
            const sample = at(MIDDLE_BAND.inner + 17, sector);
            const label = at(MIDDLE_BAND.outer - 10, sector);
            if (!preset) {
              const icon = at(
                (MIDDLE_BAND.inner + MIDDLE_BAND.outer) / 2,
                sector,
              );
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
              !!color && color.toLowerCase() === strokeColor,
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
            onClick={controller.menu}
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
