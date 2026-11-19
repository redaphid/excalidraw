import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { KEYS, isWritableElement } from "@excalidraw/common";

import { actionChangeOpacity, actionChangeStrokeColor } from "../../actions";
import { actionApplyStyleRole } from "../../actions/actionApplyStyleRole";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { useApp, useExcalidrawSetAppState } from "../App";
import {
  ArrowIcon,
  DiamondIcon,
  EllipseIcon,
  EraserIcon,
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

import { getActivePenPreset, getPenPresets } from "./penPresets";
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
import {
  RECENT_COLOR_SLOTS,
  STYLE_ROLES,
  getRoleStyle,
  getThemeColors,
  getThemeInks,
  rememberColor,
} from "./themeInks";

import "./RadialPalette.scss";

import type { ActionManager } from "../../actions/manager";
import type { AppClassProperties, ToolType } from "../../types";
import type { PenPreset } from "./penPresets";
import type { RingHit, Sector, Slider } from "./radialLayout";
import type { RoleStyle } from "./themeInks";

type Icon = React.ReactElement<React.SVGProps<SVGSVGElement>>;

/** an icon as an 18-unit square centered on `x, y` */
const placeIcon = (icon: Icon, x: number, y: number) =>
  React.cloneElement(icon, { x: x - 9, y: y - 9, width: 18, height: 18 });

const TOOLS: readonly { type: ToolType; icon: Icon }[] = [
  { type: "selection", icon: SelectionIcon },
  { type: "rectangle", icon: RectangleIcon },
  { type: "diamond", icon: DiamondIcon },
  { type: "ellipse", icon: EllipseIcon },
  { type: "arrow", icon: ArrowIcon },
  { type: "line", icon: LineIcon },
  { type: "text", icon: TextIcon },
  { type: "stickynote", icon: stickyNoteToolIcon },
  { type: "frame", icon: frameToolIcon },
];

/** one opacity step on the ring */
const OPACITY_STEP = 5;

const toOpacity = (value: number) =>
  Math.max(OPACITY_STEP, Math.round((value * 100) / OPACITY_STEP) * OPACITY_STEP);

const toPenSize = (value: number) =>
  penSizeFromSlider(value * PEN_SIZE_SLIDER_MAX);

/** a sample stroke's width on the ring, from the pen's width */
const sampleWidth = (penSize: number) => {
  const position = sliderFromPenSize(penSize) / PEN_SIZE_SLIDER_MAX;
  return 1 + 11 * position * position;
};

const SAMPLE_STROKE = "M -12 3 C -8 -6, -2 -6, 0 0 S 8 6, 12 -3";

type Flick = Readonly<{ pointerId: number; startX: number; startY: number }>;

type Opening = Readonly<{
  /** the center, in editor coordinates */
  x: number;
  y: number;
  scale: number;
  flick: Flick | null;
}>;

const openingAt = (
  app: AppClassProperties,
  clientX: number,
  clientY: number,
  flick: Flick | null,
): Opening => {
  const { offsetLeft, offsetTop, width, height } = app.state;
  return {
    ...placeRing(
      { x: clientX - offsetLeft, y: clientY - offsetTop },
      { width, height },
    ),
    flick,
  };
};

/**
 * The radial palette: a puck that opens into a ring of diagram tools, pen
 * presets, style roles, colors, pen size and opacity. Closed, it renders
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
    const [opening, setOpening] = useState<Opening | null>(null);
    const [recent, setRecent] = useState<readonly string[]>([]);
    // the opacity a pen preset set, to undo when a diagram tool is picked
    const presetOpacity = useRef<number | null>(null);
    const close = useCallback(() => setOpening(null), []);

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          event.key.toLowerCase() !== KEYS.W ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          isWritableElement(event.target) ||
          app.state.editingTextElement ||
          app.state.openDialog ||
          app.state.viewModeEnabled
        ) {
          return;
        }
        event.preventDefault();
        const pointer = app.lastPointerMoveEvent;
        const { offsetLeft, offsetTop, width, height } = app.state;
        setOpening((current) =>
          current
            ? null
            : openingAt(
                app,
                pointer?.clientX ?? offsetLeft + width / 2,
                pointer?.clientY ?? offsetTop + height / 2,
                null,
              ),
        );
      };
      const doc = app.ownerDocument;
      doc.addEventListener("keydown", onKeyDown);
      return () => doc.removeEventListener("keydown", onKeyDown);
    }, [app]);

    return (
      <>
        <button
          type="button"
          className={clsx("RadialPalette__puck", {
            "RadialPalette__puck--phone": phone,
          })}
          aria-label={t("radialPalette.open")}
          title={`${t("radialPalette.open")} — W`}
          aria-expanded={!!opening}
          data-testid="radial-palette-puck"
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            if (opening) {
              close();
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setOpening(
              openingAt(
                app,
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                },
              ),
            );
          }}
          onClick={(event) => {
            // a keyboard press; pointers open it on pointerdown
            if (event.detail === 0) {
              const rect = event.currentTarget.getBoundingClientRect();
              setOpening((current) =>
                current
                  ? null
                  : openingAt(
                      app,
                      rect.left + rect.width / 2,
                      rect.top + rect.height / 2,
                      null,
                    ),
              );
            }
          }}
        >
          <svg viewBox="-12 -12 24 24" aria-hidden="true">
            <circle r="10" className="RadialPalette__puck-ring" />
            <circle r="5.5" className="RadialPalette__puck-ring" />
            <circle r="2" className="RadialPalette__puck-dot" />
          </svg>
        </button>
        {opening && (
          <RadialRing
            opening={opening}
            actionManager={actionManager}
            recent={recent}
            setRecent={setRecent}
            presetOpacity={presetOpacity}
            onClose={close}
          />
        )}
      </>
    );
  },
);
RadialPalette.displayName = "RadialPalette";

const RadialRing = ({
  opening,
  actionManager,
  recent,
  setRecent,
  presetOpacity,
  onClose,
}: {
  opening: Opening;
  actionManager: ActionManager;
  recent: readonly string[];
  setRecent: (recent: readonly string[]) => void;
  presetOpacity: React.MutableRefObject<number | null>;
  onClose: () => void;
}) => {
  const app = useApp();
  const appState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  const inks = getThemeInks(app.cssTheme, appState, app.getCanvasMode());
  const themeColors = getThemeColors(app.cssTheme, inks);
  const colors: readonly (string | null)[] = [
    ...themeColors,
    ...Array.from(
      { length: RECENT_COLOR_SLOTS },
      (_, index) => recent[index] ?? null,
    ),
  ];
  const presets = getPenPresets(app.cssTheme);
  const roleStyles = STYLE_ROLES.map((role) => getRoleStyle(role, inks));
  // a host pen width replaces the user's, so the size arc would do nothing
  const showSize = app.props.freedrawStrokeWidth === undefined;
  const layout = getRingLayout({
    tools: TOOLS.length,
    pens: presets.length + 1,
    roles: STYLE_ROLES.length,
    colors: colors.length,
  });

  const [hover, setHover] = useState<RingHit | null>(null);
  const [dragging, setDragging] = useState<"size" | "opacity" | null>(null);
  const [flick, setFlick] = useState(opening.flick);

  // the color in use joins the recent colors when the ring opens
  useLayoutEffect(() => {
    setRecent(rememberColor(recent, appState.currentItemStrokeColor, themeColors));
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toLocal = (clientX: number, clientY: number) => ({
    dx: (clientX - app.state.offsetLeft - opening.x) / opening.scale,
    dy: (clientY - app.state.offsetTop - opening.y) / opening.scale,
  });

  const hitAt = (clientX: number, clientY: number) => {
    const { dx, dy } = toLocal(clientX, clientY);
    return hitTest(layout, dx, dy, { size: showSize });
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

  const pickTool = (type: ToolType) => {
    if (
      type !== "eraser" &&
      presetOpacity.current !== null &&
      app.state.currentItemOpacity === presetOpacity.current
    ) {
      setAppState({ currentItemOpacity: 100 });
    }
    presetOpacity.current = null;
    app.setActiveTool({ type });
  };

  const pickPreset = (preset: PenPreset) => {
    setAppState(preset.state);
    presetOpacity.current =
      preset.state.currentItemOpacity < 100
        ? preset.state.currentItemOpacity
        : null;
    app.setActiveTool({ type: "freedraw" });
  };

  const pickRole = (style: RoleStyle) => {
    actionManager.executeAction(actionApplyStyleRole, "ui", style);
  };

  const pickColor = (color: string) => {
    actionManager.executeAction(actionChangeStrokeColor, "ui", { color });
    setRecent(rememberColor(recent, color, themeColors));
  };

  /** does what `hit` names; false when it names nothing to do */
  const activate = (hit: RingHit): boolean => {
    switch (hit.kind) {
      case "hub":
        return true;
      case "tool":
        pickTool(TOOLS[hit.index].type);
        return true;
      case "pen": {
        const preset = presets[hit.index];
        if (preset) {
          pickPreset(preset);
        } else {
          pickTool("eraser");
        }
        return true;
      }
      case "role":
        pickRole(roleStyles[hit.index]);
        return true;
      case "color": {
        const color = colors[hit.index];
        if (!color) {
          return false;
        }
        pickColor(color);
        return true;
      }
      case "size":
        previewSlider(hit);
        return true;
      case "opacity":
        previewSlider(hit);
        commitOpacity();
        return true;
    }
  };

  const pick = (hit: RingHit) => {
    if (activate(hit)) {
      onClose();
    }
  };

  // a flick: press the puck, drag to a segment, lift to pick it
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
        Math.hypot(event.clientX - flick.startX, event.clientY - flick.startY) >
        FLICK_DISTANCE;
      if (!moved) {
        return;
      }
      last = hitAt(event.clientX, event.clientY);
      setHover(last);
      if (last?.kind === "size" || last?.kind === "opacity") {
        previewSlider(last);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== flick.pointerId) {
        return;
      }
      setFlick(null);
      setHover(null);
      if (!moved) {
        // a tap: the ring stays open for the next tap
        return;
      }
      if (last?.kind === "opacity") {
        commitOpacity();
        onClose();
      } else if (!last || last.kind === "size" || activate(last)) {
        onClose();
      }
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === flick.pointerId) {
        setFlick(null);
        setHover(null);
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
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const doc = app.ownerDocument;
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [app, onClose]);

  const isHover = (kind: RingHit["kind"], index?: number) =>
    hover?.kind === kind &&
    (index === undefined || ("index" in hover && hover.index === index));

  const activePreset =
    appState.activeTool.type === "freedraw"
      ? getActivePenPreset(presets, appState)
      : null;
  const strokeColor = appState.currentItemStrokeColor.toLowerCase();

  const button = (
    key: string,
    label: string,
    testId: string,
    hit: RingHit,
    active: boolean,
    hovered: boolean,
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
        "RadialPalette__segment--hover": hovered,
        "RadialPalette__segment--disabled": disabled,
      })}
      onClick={() => !disabled && pick(hit)}
      onKeyDown={(event) => {
        if (!disabled && (event.key === KEYS.ENTER || event.key === " ")) {
          event.preventDefault();
          pick(hit);
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
    const knob = polar(OUTER_BAND.inner + 17, sliderAngle(config, value));
    const low = polar(
      OUTER_BAND.inner + 17,
      config.from + Math.sign(config.from - config.to) * 4,
    );
    const high = polar(
      OUTER_BAND.inner + 17,
      config.to + Math.sign(config.to - config.from) * 4,
    );
    const radius = OUTER_BAND.inner + 17;
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
            dragging === kind || hover?.kind === kind,
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

  const size = RING_RADIUS * 2 * opening.scale;
  const penSize = appState.currentItemFreedrawStrokeWidth;
  const sizeValue = sliderFromPenSize(penSize) / PEN_SIZE_SLIDER_MAX;
  const opacityValue = appState.currentItemOpacity / 100;

  return (
    <>
      <div
        className="RadialPalette__backdrop"
        data-testid="radial-palette-backdrop"
        onPointerDown={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="RadialPalette"
        role="dialog"
        aria-label={t("radialPalette.open")}
        data-testid="radial-palette"
        style={{
          left: opening.x - size / 2,
          top: opening.y - size / 2,
          width: size,
          height: size,
        }}
      >
        <svg
          viewBox={`${-RING_RADIUS} ${-RING_RADIUS} ${RING_RADIUS * 2} ${
            RING_RADIUS * 2
          }`}
          width={size}
          height={size}
          onPointerMove={(event) => {
            if (dragging) {
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
            }
          }}
          onPointerUp={() => {
            if (dragging === "opacity") {
              commitOpacity();
            }
            setDragging(null);
          }}
        >
          <circle r={RING_RADIUS} className="RadialPalette__disc" />
          <circle r={MIDDLE_BAND.outer + 1} className="RadialPalette__rule" />
          <circle r={TOOLS_BAND.outer + 1} className="RadialPalette__rule" />
          <circle r={HUB_RADIUS + 1} className="RadialPalette__rule" />

          {TOOLS.map(({ type, icon }, index) => {
            const sector = layout.tools[index];
            const { x, y } = at((TOOLS_BAND.inner + TOOLS_BAND.outer) / 2, sector);
            return button(
              type,
              t(`toolBar.${type}` as const),
              `radial-tool-${type}`,
              { kind: "tool", index },
              appState.activeTool.type === type,
              isHover("tool", index),
              sectorPath(TOOLS_BAND, sector),
              placeIcon(icon, x, y),
            );
          })}

          {[...presets, null].map((preset, index) => {
            const sector = layout.pens[index];
            const { x, y } = at(MIDDLE_BAND.inner + 20, sector);
            const label = at(MIDDLE_BAND.outer - 9, sector);
            if (!preset) {
              return button(
                "eraser",
                t("toolBar.eraser"),
                "radial-tool-eraser",
                { kind: "pen", index },
                appState.activeTool.type === "eraser",
                isHover("pen", index),
                sectorPath(MIDDLE_BAND, sector),
                placeIcon(EraserIcon, x, y),
              );
            }
            return button(
              preset.id,
              t(`radialPalette.pen_${preset.id}` as const),
              `radial-pen-${preset.id}`,
              { kind: "pen", index },
              activePreset?.id === preset.id,
              isHover("pen", index),
              sectorPath(MIDDLE_BAND, sector),
              <>
                <path
                  d={SAMPLE_STROKE}
                  transform={`translate(${x} ${y})`}
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

          {STYLE_ROLES.map((role, index) => {
            const sector = layout.roles[index];
            const style = roleStyles[index];
            const { x, y } = at(MIDDLE_BAND.inner + 26, sector);
            const label = at(MIDDLE_BAND.inner + 8, sector);
            const active =
              appState.currentItemStrokeColor === style.strokeColor &&
              appState.currentItemBackgroundColor === style.backgroundColor &&
              appState.currentItemStrokeStyle === style.strokeStyle;
            return button(
              role,
              `${t("radialPalette.role")}: ${t(
                `radialPalette.role_${role}` as const,
              )}`,
              `radial-role-${role}`,
              { kind: "role", index },
              active,
              isHover("role", index),
              sectorPath(MIDDLE_BAND, sector),
              <>
                <rect
                  x={x - 11}
                  y={y - 7}
                  width={22}
                  height={14}
                  rx={2}
                  className="RadialPalette__role"
                  fill={style.backgroundColor}
                  stroke={style.strokeColor}
                  strokeDasharray={
                    style.strokeStyle === "dashed" ? "3 2" : undefined
                  }
                />
                <text x={label.x} y={label.y} className="RadialPalette__label">
                  {t(`radialPalette.role_${role}` as const)}
                </text>
              </>,
            );
          })}

          {colors.map((color, index) => {
            const sector = layout.colors[index];
            const { x, y } = at((OUTER_BAND.inner + OUTER_BAND.outer) / 2, sector);
            return button(
              `color-${index}`,
              color ?? t("radialPalette.emptyRecent"),
              `radial-color-${index}`,
              { kind: "color", index },
              !!color && color.toLowerCase() === strokeColor,
              isHover("color", index),
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
            aria-label={t("radialPalette.close")}
            data-testid="radial-palette-close"
            className="RadialPalette__hub"
            onClick={onClose}
            onKeyDown={(event) => {
              if (event.key === KEYS.ENTER || event.key === " ") {
                event.preventDefault();
                onClose();
              }
            }}
          >
            <title>{t("radialPalette.close")}</title>
            <circle r={HUB_RADIUS} className="RadialPalette__hub-bg" />
            <circle
              r={Math.max(2, sampleWidth(penSize) / 2 + 1)}
              fill={appState.currentItemStrokeColor}
              opacity={appState.currentItemOpacity / 100}
            />
          </g>
        </svg>
      </div>
    </>
  );
};
