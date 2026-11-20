import { Emitter } from "@excalidraw/common";

import {
  actionChangeBackgroundColor,
  actionChangeStrokeColor,
} from "../../actions/actionProperties";
import { t } from "../../i18n";

import { getActivePenPreset, getPenPresets } from "./penPresets";
import {
  RECENT_COLOR_SLOTS,
  getThemeColors,
  getThemeInks,
  rememberColor,
} from "./themeInks";

import type { RadialHostPen, ToolType, UnsubscribeCallback } from "../../types";
import type App from "../App";
import type { PenPreset } from "./penPresets";
import { FLICK_DISTANCE } from "./radialLayout";
import {
  STYLE_PROPERTIES,
  getStyleProperty,
  styleOptionId,
} from "./styleProperties";

import type { StylePropertyId } from "./styleProperties";

/** the shapes and tools on the inner ring, clockwise from the top */
export const RADIAL_TOOLS = [
  "selection",
  "hand",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "stickynote",
  "frame",
] as const;

export type RadialTool = typeof RADIAL_TOOLS[number];

/** the rings a controller can step through: shapes, pens and colors */
export const RADIAL_RINGS = ["tools", "pens", "colors", "style"] as const;

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
  /** on the style ring, the property whose options it shows; null for the
   * list of properties */
  style: StylePropertyId | null;
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
  /** what a color pick paints: the stroke, or the fill after the chip flips it */
  private colorTarget: "stroke" | "fill" = "stroke";
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

  get colorsFill() {
    return this.colorTarget === "fill";
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

  /** the host's own pens, from `radialPalette={{ pens }}` */
  hostPens(): readonly RadialHostPen[] {
    const { radialPalette } = this.app.props;
    return typeof radialPalette === "object" ? radialPalette.pens ?? [] : [];
  }

  getPresets(): readonly PenPreset[] {
    return getPenPresets(this.app.cssTheme);
  }

  getThemeColors(): readonly string[] {
    const theme = this.app.cssTheme;
    return getThemeColors(theme, getThemeInks(theme));
  }

  /** the ring's color slots as drawn: the theme's, then every recent
   * slot, null where none is remembered yet */
  colorSlots(): readonly (string | null)[] {
    return [
      ...this.getThemeColors(),
      ...Array.from(
        { length: RECENT_COLOR_SLOTS },
        (_, index) => this.recent[index] ?? null,
      ),
    ];
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
          ...this.hostPens().map(({ id, label }) => ({
            id: `host-${id}`,
            label,
          })),
          { id: "eraser", label: t("toolBar.eraser") },
        ];
      case "colors":
        return [
          // one item per drawn slot, so a slot's index is its item's
          ...this.colorSlots().map((color) =>
            color
              ? { id: color, label: color }
              : { id: "", label: t("radialPalette.emptyRecent") },
          ),
          { id: "fill", label: t("radialPalette.fill") },
        ];
      case "style": {
        const style = this.current?.style;
        const property = style && getStyleProperty(style);
        if (property) {
          return property.options.map((option) => ({
            id: styleOptionId(option),
            label:
              typeof option.label === "string"
                ? t(option.label)
                : option.label.text,
          }));
        }
        const elements = this.selectedElements();
        return STYLE_PROPERTIES.filter((candidate) =>
          candidate.applies(elements, this.app.state),
        ).map(({ id, label }) => ({ id, label: t(label) }));
      }
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
          : this.hostPens().some(({ active }) => active)
          ? `host-${this.hostPens().find(({ active }) => active)!.id}`
          : state.activeTool.type === "freedraw"
          ? getActivePenPreset(this.getPresets(), state)?.id
          : undefined
        : this.colorsFill
        ? state.currentItemBackgroundColor.toLowerCase()
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
        this.update({
          ...this.current,
          ring,
          style: null,
          index: this.activeIndex(ring),
        });
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
      style: null,
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
    // whole steps over the items that can be picked: empty recent color
    // slots are drawn but hold nothing
    const items = this.items(current.ring);
    const direction = Math.sign(Math.trunc(delta));
    let index = current.index;
    for (let left = Math.abs(Math.trunc(delta)); left > 0; ) {
      index = wrap(index + direction, items.length);
      if (items[index].id !== "" || index === current.index) {
        left--;
      }
    }
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
    this.update({
      ...current,
      ring,
      style: null,
      index: this.activeIndex(ring),
    });
  };

  choose = () => {
    if (this.current) {
      this.pick(this.current.ring, this.current.index);
    }
  };

  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  /** a press held still on a tool for `delay` picks it locked, as Q does */
  hold = (
    ring: RadialRing,
    index: number,
    delay: number,
    at: ClientPoint = { x: 0, y: 0 },
  ) => {
    this.release();
    if (ring === "tools") {
      this.holdStart = at;
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        this.pick(ring, index, true);
      }, delay);
    }
  };

  private holdStart: ClientPoint = { x: 0, y: 0 };

  /** a held press that moves more than FLICK_DISTANCE is not held still */
  drift = ({ x, y }: ClientPoint) => {
    if (
      Math.hypot(x - this.holdStart.x, y - this.holdStart.y) > FLICK_DISTANCE
    ) {
      this.release();
    }
  };

  release = () => {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  };

  /** does what the item does, then closes; false when there is no item */
  pick = (ring: RadialRing, index: number, locked = false): boolean => {
    const item = this.items(ring)[index];
    if (!this.enabled || !item?.id) {
      return false;
    }
    if (ring === "tools") {
      this.pickTool(item.id as RadialTool, locked);
    } else if (ring === "pens") {
      const preset = this.getPresets().find(({ id }) => id === item.id);
      const host = this.hostPens().find(({ id }) => `host-${id}` === item.id);
      if (preset) {
        this.pickPreset(preset);
      } else if (host) {
        host.onPick();
      } else {
        this.pickTool("eraser");
      }
    } else if (ring === "style") {
      const property =
        this.current?.style && getStyleProperty(this.current.style);
      if (!property) {
        // a property opens its options in place
        if (this.current) {
          this.update({
            ...this.current,
            style: item.id as StylePropertyId,
            index: 0,
          });
        }
        return true;
      }
      this.app.actionManager.executeAction(
        property.action,
        "ui",
        property.options[index].value,
      );
    } else if (item.id === "fill") {
      // the chip flips the arc and leaves the ring open for the pick
      this.colorTarget = this.colorsFill ? "stroke" : "fill";
      if (this.current) {
        this.update({ ...this.current });
      }
      return true;
    } else {
      this.pickColor(item.id);
    }
    this.close();
    return true;
  };

  private selectedElements() {
    return this.app.scene.getSelectedElements({
      selectedElementIds: this.app.state.selectedElementIds,
      includeBoundTextElement: true,
    });
  }

  private pickTool(type: ToolType, locked = false) {
    this.app.setActiveTool({ type, locked });
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
    this.app.actionManager.executeAction(
      this.colorsFill ? actionChangeBackgroundColor : actionChangeStrokeColor,
      "ui",
      { color },
    );
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
