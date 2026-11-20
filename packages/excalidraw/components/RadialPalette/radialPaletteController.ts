import { Emitter } from "@excalidraw/common";

import { actionChangeStrokeColor } from "../../actions/actionProperties";
import { t } from "../../i18n";

import { getActivePenPreset, getPenPresets } from "./penPresets";
import { getThemeColors, getThemeInks, rememberColor } from "./themeInks";

import type { ToolType, UnsubscribeCallback } from "../../types";
import type App from "../App";
import type { PenPreset } from "./penPresets";

/** the shapes and tools on the inner ring, clockwise from the top */
export const RADIAL_TOOLS = [
  "selection",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "frame",
] as const;

export type RadialTool = typeof RADIAL_TOOLS[number];

/** the rings a controller can step through: shapes, pens and colors */
export const RADIAL_RINGS = ["tools", "pens", "colors"] as const;

export type RadialRing = typeof RADIAL_RINGS[number];

export type RadialPaletteItem = Readonly<{
  /** a tool type, a pen preset id, `"eraser"`, or a color */
  id: string;
  label: string;
}>;

export type RadialPaletteState = Readonly<{
  open: boolean;
  /** the ring the highlight is on */
  ring: RadialRing;
  /** the highlighted item in `items` */
  index: number;
  /** the ring's items, in order */
  items: readonly RadialPaletteItem[];
}>;

/** a point in client coordinates, as on a `PointerEvent` */
export type ClientPoint = Readonly<{ x: number; y: number }>;

export type RadialPaletteOpenOptions = Readonly<{
  /** the ring to highlight; `"tools"` by default */
  ring?: RadialRing;
  /** the ring's center, in client coordinates; the last pointer position,
   * else the middle of the editor, by default */
  at?: ClientPoint;
}>;

/**
 * Drives the radial palette without a pointer, e.g. from a MIDI knob. Needs
 * the `radialPalette` prop; without it every call does nothing.
 */
export type RadialPaletteAPI = Readonly<{
  /** opens the palette, or moves the highlight to `ring` when it is open */
  open: (options?: RadialPaletteOpenOptions) => void;
  /** moves the highlight `delta` items round its ring, wrapping */
  step: (delta: number) => void;
  /** picks the highlighted item, as a tap on it would, and closes */
  choose: () => void;
  close: () => void;
  state: () => RadialPaletteState;
  /** called after every change to `state()`; returns the unsubscribe */
  onChange: (
    callback: (state: RadialPaletteState) => void,
  ) => UnsubscribeCallback;
}>;

/** the pointer that opened the ring and is still down: lifting it after a
 * drag picks what it is over */
export type RadialFlick = Readonly<{
  pointerId: number;
  /** where it was when the ring opened, in client coordinates */
  start: ClientPoint;
}>;

/** where the ring is open and what is highlighted */
export type RadialSession = Readonly<{
  at: ClientPoint;
  ring: RadialRing;
  index: number;
  flick: RadialFlick | null;
}>;

const wrap = (index: number, length: number) =>
  length ? ((index % length) + length) % length : 0;

/**
 * The palette's state and what its items do. The ring's pointer and keyboard
 * handling, the editor's gestures and `RadialPaletteAPI` all go through it.
 */
export class RadialPaletteController {
  private current: RadialSession | null = null;
  /** the ring and highlight to report while closed */
  private last: Pick<RadialSession, "ring" | "index"> = {
    ring: "tools",
    index: 0,
  };
  private recent: readonly string[] = [];
  /** the opacity a pen preset set, to undo when a shape tool is picked */
  private presetOpacity: number | null = null;
  private readonly emitter = new Emitter<[]>();

  constructor(private readonly app: App) {}

  /** the open session, or null; a new object on every change */
  get session() {
    return this.current;
  }

  get recentColors() {
    return this.recent;
  }

  /** for `useSyncExternalStore` */
  subscribe = (callback: () => void) => this.emitter.on(callback);

  private get enabled() {
    return !!this.app.props.radialPalette && !this.app.state.viewModeEnabled;
  }

  private update(session: RadialSession | null) {
    this.current = session;
    if (session) {
      this.last = { ring: session.ring, index: session.index };
    }
    this.emitter.trigger();
  }

  getPresets(): readonly PenPreset[] {
    return getPenPresets(this.app.cssTheme);
  }

  getThemeColors(): readonly string[] {
    const theme = this.app.cssTheme;
    return getThemeColors(theme, getThemeInks(theme));
  }

  /** the ring's colors: the theme's, then the recent ones */
  getColors(): readonly string[] {
    return [...this.getThemeColors(), ...this.recent];
  }

  items(ring: RadialRing): readonly RadialPaletteItem[] {
    switch (ring) {
      case "tools":
        return RADIAL_TOOLS.map((type) => ({
          id: type,
          label: t(`toolBar.${type}` as const),
        }));
      case "pens":
        return [
          ...this.getPresets().map(({ id }) => ({
            id,
            label: t(`radialPalette.pen_${id}` as const),
          })),
          { id: "eraser", label: t("toolBar.eraser") },
        ];
      case "colors":
        return this.getColors().map((color) => ({ id: color, label: color }));
    }
  }

  /** the item in `ring` that is in use now, else the first */
  private activeIndex(ring: RadialRing) {
    const { state } = this.app;
    const ids = this.items(ring).map(({ id }) => id);
    const active =
      ring === "tools"
        ? state.activeTool.type
        : ring === "pens"
        ? state.activeTool.type === "eraser"
          ? "eraser"
          : state.activeTool.type === "freedraw"
          ? getActivePenPreset(this.getPresets(), state)?.id
          : undefined
        : state.currentItemStrokeColor.toLowerCase();
    return Math.max(
      0,
      ids.findIndex((id) => id.toLowerCase() === active),
    );
  }

  /** the last pointer position, else the middle of the editor */
  private defaultPoint(): ClientPoint {
    const pointer = this.app.lastPointerMoveEvent;
    const { offsetLeft, offsetTop, width, height } = this.app.state;
    return pointer
      ? { x: pointer.clientX, y: pointer.clientY }
      : { x: offsetLeft + width / 2, y: offsetTop + height / 2 };
  }

  open = (
    options: RadialPaletteOpenOptions & { flick?: RadialFlick | null } = {},
  ) => {
    if (!this.enabled) {
      return;
    }
    const ring =
      options.ring && RADIAL_RINGS.includes(options.ring)
        ? options.ring
        : this.current?.ring ?? "tools";
    if (this.current) {
      if (this.current.ring !== ring) {
        this.update({ ...this.current, ring, index: this.activeIndex(ring) });
      }
      return;
    }
    // the color in use joins the recent colors when the ring opens
    this.recent = rememberColor(
      this.recent,
      this.app.state.currentItemStrokeColor,
      this.getThemeColors(),
    );
    this.update({
      at: options.at ?? this.defaultPoint(),
      ring,
      index: this.activeIndex(ring),
      flick: options.flick ?? null,
    });
  };

  toggle = () => {
    if (this.current) {
      this.close();
    } else {
      this.open();
    }
  };

  close = () => {
    if (this.current) {
      this.update(null);
    }
  };

  /** moves the open ring, as a drag of its hub does */
  moveTo = (at: ClientPoint) => {
    const { current } = this;
    if (current && (current.at.x !== at.x || current.at.y !== at.y)) {
      this.update({ ...current, at });
    }
  };

  /** the opening pointer was lifted or lost: no flick any more */
  endFlick = () => {
    if (this.current?.flick) {
      this.update({ ...this.current, flick: null });
    }
  };

  /** closes, and opens the context menu for what is under the ring's
   * center: the touch context menu's way in while the palette has the
   * long press */
  menu = () => {
    const { current } = this;
    if (current) {
      this.close();
      this.app.openContextMenu({
        clientX: current.at.x,
        clientY: current.at.y,
      });
    }
  };

  /** highlights an item, as a pointer over it does */
  highlight = (ring: RadialRing, index: number) => {
    const { current } = this;
    if (current && (current.ring !== ring || current.index !== index)) {
      this.update({ ...current, ring, index });
    }
  };

  step = (delta: number) => {
    const { current } = this;
    if (!current || !Number.isFinite(delta)) {
      return;
    }
    const length = this.items(current.ring).length;
    const index = wrap(current.index + Math.trunc(delta), length);
    if (index !== current.index) {
      this.update({ ...current, index });
    }
  };

  /** moves the highlight to the next ring out (or in), wrapping */
  stepRing = (delta: number) => {
    const { current } = this;
    if (!current) {
      return;
    }
    const ring =
      RADIAL_RINGS[
        wrap(RADIAL_RINGS.indexOf(current.ring) + delta, RADIAL_RINGS.length)
      ];
    this.update({ ...current, ring, index: this.activeIndex(ring) });
  };

  choose = () => {
    if (this.current) {
      this.pick(this.current.ring, this.current.index);
    }
  };

  /** does what the item does, then closes; false when there is no item */
  pick = (ring: RadialRing, index: number): boolean => {
    const item = this.items(ring)[index];
    if (!this.enabled || !item) {
      return false;
    }
    if (ring === "tools") {
      this.pickTool(item.id as RadialTool);
    } else if (ring === "pens") {
      const preset = this.getPresets().find(({ id }) => id === item.id);
      if (preset) {
        this.pickPreset(preset);
      } else {
        this.pickTool("eraser");
      }
    } else {
      this.pickColor(item.id);
    }
    this.close();
    return true;
  };

  private pickTool(type: ToolType) {
    this.app.setActiveTool({ type });
  }

  /** the active tool changed, from the ring or anywhere else: a pen
   * preset's see-through ink does not carry over to shapes */
  toolChanged() {
    const { app, presetOpacity } = this;
    const { type } = app.state.activeTool;
    if (presetOpacity === null || type === "freedraw" || type === "eraser") {
      return;
    }
    this.presetOpacity = null;
    if (app.state.currentItemOpacity === presetOpacity) {
      app.setAppState({ currentItemOpacity: 100 });
    }
  }

  private pickPreset(preset: PenPreset) {
    this.app.setAppState(preset.state);
    this.presetOpacity =
      preset.state.currentItemOpacity < 100
        ? preset.state.currentItemOpacity
        : null;
    this.app.setActiveTool({ type: "freedraw" });
  }

  private pickColor(color: string) {
    this.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
      color,
    });
    this.recent = rememberColor(this.recent, color, this.getThemeColors());
  }

  state = (): RadialPaletteState => {
    const { ring, index } = this.current ?? this.last;
    const items = this.items(ring);
    return {
      open: !!this.current,
      ring,
      index: wrap(index, items.length),
      items,
    };
  };

  readonly api: RadialPaletteAPI = {
    open: ({ ring, at } = {}) => this.open({ ring, at }),
    step: (delta) => this.step(delta),
    choose: () => this.choose(),
    close: () => this.close(),
    state: () => this.state(),
    onChange: (callback) => {
      // only what `state()` reports: a flick ending or the ring moving is
      // not a change to a knob
      let last = this.state();
      return this.emitter.on(() => {
        const next = this.state();
        if (
          next.open !== last.open ||
          next.ring !== last.ring ||
          next.index !== last.index
        ) {
          last = next;
          callback(next);
        }
      });
    },
  };

  /** the editor unmounted: no session, no listeners */
  destroy() {
    this.current = null;
    this.emitter.clear();
  }
}
