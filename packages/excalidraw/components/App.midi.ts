import {
  cloneJSON,
  DEFAULT_FONT_SIZE,
  DEFAULT_GRID_STEP,
  getColorSaturationLightness,
  getStrokeWidthByKey,
  setColorSaturationLightness,
  spinColorHue,
} from "@excalidraw/common";
import {
  CaptureUpdateAction,
  deepCopyElement,
  getAuthoringScale,
  getBaseFontSize,
  getBoundTextElement,
  getCommonBoundingBox,
  getCommonBounds,
  getElementAbsoluteCoords,
  getSelectedElements,
  hasBoundTextElement,
  isElementInViewport,
  isFrameLikeElement,
  isTextElement,
  resizeMultipleElements,
  selectGroupsForSelectedElements,
  transformElements,
} from "@excalidraw/element";
import { degreesToRadians, radiansToDegrees } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";

import type { ElementUpdate } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  accelerate,
  bindingKey,
  bindingsToMap,
  controlChangeBytes,
  decodeTurn,
  gatherDetents,
  MIDI_TARGETS,
  midiTargetStep,
  parseMidiMessage,
  resolveCommand,
  ringPosition,
  TWISTER_LAYOUT,
  withBinding,
} from "../midi";
import {
  actionChangeFillStyle,
  actionChangeRoundness,
  actionChangeStrokeStyle,
  actionChangeTextAlign,
} from "../actions/actionProperties";
import {
  actionBringForward,
  actionSendBackward,
} from "../actions/actionZindex";
import { getNormalizedGridStep, getNormalizedZoom } from "../scene";
import { getViewportForZoomWithScrollConstraints } from "../viewport";

import {
  handleDimensionChange as handleSingleDimension,
  handleDragFinished as finishSingleDimension,
} from "./Stats/Dimension";
import {
  handleDimensionChange as handleMultiDimension,
  handleDragFinished as finishMultiDimension,
} from "./Stats/MultiDimension";
import { handleFontSizeChange as handleSingleFontSize } from "./Stats/FontSize";
import {
  getApplicableTextElements,
  handleFontSizeChange as handleMultiFontSize,
} from "./Stats/MultiFontSize";
import { handlePositionChange as handleSinglePosition } from "./Stats/Position";
import { handlePositionChange as handleMultiPosition } from "./Stats/MultiPosition";

import type {
  KnobState,
  MidiBinding,
  MidiControlChange,
  MidiEncoding,
  MidiTarget,
  MidiTargetId,
} from "../midi";
import type { AppState, MidiOptions } from "../types";
import type App from "./App";

/** a pause this long ends a turn: its changes become one undo step */
export const MIDI_TURN_IDLE_MS = 450;

const TOAST_MS = 1200;

/** the style targets that set the next shape's style with nothing selected */
const STYLE_TARGETS = new Set<MidiTargetId>([
  "strokeWidth",
  "opacity",
  "roughness",
  "fontSize",
]);
const VIEW_TARGETS = new Set<MidiTargetId>(["zoom", "panX", "panY"]);

/** the choices a knob turns through, and the action that makes each */
const CHOICE_ACTIONS = {
  strokeStyle: actionChangeStrokeStyle,
  fillStyle: actionChangeFillStyle,
  roundness: actionChangeRoundness,
  textAlign: actionChangeTextAlign,
} as const;
type ChoiceTargetId = keyof typeof CHOICE_ACTIONS;
const isChoiceTarget = (id: MidiTargetId): id is ChoiceTargetId =>
  id in CHOICE_ACTIONS;

/** the colour component a knob sets */
const COLOUR_COMPONENTS: Partial<
  Record<
    MidiTargetId,
    {
      property: "strokeColor" | "backgroundColor";
      component: "saturation" | "lightness";
    }
  >
> = {
  strokeSaturation: { property: "strokeColor", component: "saturation" },
  strokeLightness: { property: "strokeColor", component: "lightness" },
  backgroundSaturation: {
    property: "backgroundColor",
    component: "saturation",
  },
  backgroundLightness: { property: "backgroundColor", component: "lightness" },
};

/** a turn in progress on the selection, measured from where it began */
type Turn = {
  target: MidiTargetId;
  selection: string;
  originalElementsMap: ElementsMap;
  originalElements: NonDeletedExcalidrawElement[];
  originalAppState: AppState;
  /** detents since the turn began, after acceleration */
  detents: number;
  timer: number | null;
};

const selectionKey = (state: Pick<AppState, "selectedElementIds">) =>
  Object.keys(state.selectedElementIds)
    .filter((id) => state.selectedElementIds[id])
    .sort()
    .join();

const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * MIDI knobs for `props.midi`: connects to the browser's MIDI devices, reads
 * each control change through the bindings and turns the selection, the next
 * shape's style or the view. A turn on the selection reuses the stats panel's
 * drag handlers, measured from where the turn began, and lands as one undo
 * step once the hand rests. Knobs with an LED ring (the Twister) are told
 * where their value sits after every turn and selection change.
 */
export class AppMidi {
  private access: MIDIAccess | null = null;
  private connecting: Promise<boolean> | null = null;
  private listeners = new Map<MIDIInput, (event: MIDIMessageEvent) => void>();
  private knobs = new Map<string, KnobState>();
  /** names of the ports that have spoken: their outputs get ring updates */
  private heardFrom = new Set<string>();
  private turn: Turn | null = null;
  private learning: MidiTargetId | null = null;
  private uncontrolledBindings: MidiBinding[] | null = null;
  private lastSelection = "";
  /** detents toward the next move of a stepped target */
  private carry = new Map<MidiTargetId, number>();

  constructor(private app: App) {}

  get options(): MidiOptions | null {
    const midi = this.app.props.midi;
    return midi ? (midi === true ? {} : midi) : null;
  }

  get enabled() {
    return !!this.options;
  }

  get connected() {
    return !!this.access;
  }

  get bindings(): readonly MidiBinding[] {
    return (
      this.options?.bindings ?? this.uncontrolledBindings ?? TWISTER_LAYOUT
    );
  }

  get learningTarget() {
    return this.learning;
  }

  private get encoding(): MidiEncoding {
    return this.options?.encoding ?? "auto";
  }

  /** how far a detent moves `id`, with the host's override */
  stepOf(id: MidiTargetId) {
    return midiTargetStep(id, this.options?.steps);
  }

  // ---------------------------------------------------------------------------
  // connection
  // ---------------------------------------------------------------------------

  /** on mount: connects without asking when the browser already allows MIDI,
   * so a page without a controller never sees a permission prompt */
  mount = async () => {
    if (!this.enabled) {
      return;
    }
    const navigator = this.app.ownerWindow.navigator;
    try {
      const status = await navigator.permissions?.query({
        name: "midi" as PermissionName,
      });
      if (status?.state === "granted") {
        await this.connect({ quiet: true });
      }
    } catch {
      // permissions without a "midi" entry: wait for an explicit connect
    }
  };

  /** asks for MIDI access (the browser may prompt) and listens to every
   * input, including ones plugged in later */
  connect = (opts: { quiet?: boolean } = {}): Promise<boolean> => {
    if (this.access) {
      return Promise.resolve(true);
    }
    if (this.connecting) {
      return this.connecting;
    }
    const navigator = this.app.ownerWindow.navigator;
    if (!("requestMIDIAccess" in navigator)) {
      if (!opts.quiet) {
        this.toast("MIDI isn't available in this browser");
      }
      return Promise.resolve(false);
    }
    this.connecting = navigator
      .requestMIDIAccess()
      .then((access) => {
        if (this.app.unmounted) {
          return false;
        }
        this.access = access;
        access.onstatechange = () => this.listen();
        const names = this.listen();
        if (!opts.quiet) {
          this.toast(
            names.length
              ? `MIDI: ${names.join(", ")}`
              : "MIDI connected — plug in a controller",
          );
        }
        return true;
      })
      .catch(() => {
        if (!opts.quiet) {
          this.toast("MIDI access was refused");
        }
        return false;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  };

  disconnect = () => {
    this.endTurn();
    for (const [input, listener] of this.listeners) {
      input.removeEventListener("midimessage", listener);
    }
    this.listeners.clear();
    if (this.access) {
      this.access.onstatechange = null;
    }
    this.access = null;
    this.learning = null;
  };

  /** listens to inputs not yet listened to; the names of the connected ones */
  private listen() {
    const names: string[] = [];
    for (const input of this.access?.inputs.values() ?? []) {
      if (input.state === "disconnected") {
        continue;
      }
      names.push(input.name || input.id);
      if (!this.listeners.has(input)) {
        const listener = (event: MIDIMessageEvent) =>
          this.receive(event.data, input.name || input.id);
        input.addEventListener("midimessage", listener);
        this.listeners.set(input, listener);
      }
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // bindings
  // ---------------------------------------------------------------------------

  /** binds the next knob turned to `target`, connecting first if need be */
  learn = async (target: MidiTargetId) => {
    if (!this.access && !(await this.connect())) {
      return;
    }
    this.learning = target;
    this.toast(`Turn a knob to bind ${MIDI_TARGETS[target].label}`, 8000);
  };

  cancelLearn = () => {
    this.learning = null;
  };

  setBindings = (bindings: MidiBinding[]) => {
    if (!this.options?.bindings) {
      this.uncontrolledBindings = bindings;
    }
    this.options?.onBindingsChange?.(bindings);
    this.syncRings();
  };

  resetBindings = () => this.setBindings([...TWISTER_LAYOUT]);

  // ---------------------------------------------------------------------------
  // messages
  // ---------------------------------------------------------------------------

  /** a raw message from a port (or from a test) */
  receive = (data: ArrayLike<number> | null | undefined, from = "") => {
    const change = parseMidiMessage(data);
    if (!change || !this.enabled || this.app.unmounted) {
      return;
    }
    // a device's first word is taken as it is; its rings are brought round
    // to the drawing afterwards, so that first touch can't jump
    if (from && !this.heardFrom.has(from)) {
      this.heardFrom.add(from);
      try {
        this.handle(change);
      } finally {
        this.syncRings();
      }
      return;
    }
    this.handle(change);
  };

  private handle(change: MidiControlChange) {
    if (this.learning) {
      this.bind(change);
      return;
    }
    const command = resolveCommand(
      bindingsToMap(this.bindings),
      change,
      this.options?.switchChannelOffset === undefined
        ? 1
        : this.options.switchChannelOffset,
    );
    if (!command) {
      return;
    }
    if (command.action === "reset") {
      this.reset(command.target);
      return;
    }

    const key = bindingKey(change.channel, change.cc);
    const prev = this.knobs.get(key);
    const { steps, state } = decodeTurn(prev, change.value, this.encoding);
    const now = performance.now();
    this.knobs.set(key, { ...state, at: now });
    if (steps) {
      const since = prev?.at === undefined ? undefined : now - prev.at;
      this.turnTarget(
        command.target,
        this.options?.acceleration === false ? steps : accelerate(steps, since),
      );
    }
  }

  private bind({ channel, cc }: MidiControlChange) {
    const target = this.learning!;
    this.learning = null;
    this.knobs.delete(bindingKey(channel, cc));
    this.setBindings(withBinding(this.bindings, { channel, cc, target }));
    this.toast(`${MIDI_TARGETS[target].label} ← CC ${cc} (channel ${channel})`);
  }

  // ---------------------------------------------------------------------------
  // turning
  // ---------------------------------------------------------------------------

  private selected() {
    return this.app.scene.getSelectedElements(this.app.state);
  }

  private turnTarget(id: MidiTargetId, detents: number) {
    const target = MIDI_TARGETS[id];
    const { state } = this.app;

    if (VIEW_TARGETS.has(id)) {
      this.turnView(id, detents);
      return;
    }
    if (state.viewModeEnabled || !this.app.isInteractionEnabled()) {
      return;
    }
    if (id === "select") {
      this.cycleSelection(detents);
      return;
    }
    if (id === "gridStep") {
      this.setGridStep(this.app.state.gridStep + detents * this.stepOf(id));
      return;
    }
    if (id === "history" || id === "layer" || isChoiceTarget(id)) {
      const { moves, carry } = gatherDetents(
        this.carry.get(id) ?? 0,
        detents,
        this.stepOf(id),
      );
      this.carry.set(id, carry);
      if (moves) {
        this.endTurn();
        this.move(id, moves);
      }
      return;
    }

    const selected = this.selected();
    if (!selected.length) {
      if (STYLE_TARGETS.has(id)) {
        this.turnNextStyle(id, detents);
      }
      return;
    }

    const turn = this.beginTurn(id, selected);
    turn.detents += detents;
    this.applyTurn(turn);
    this.app.scene.triggerUpdate();
    this.scheduleTurnEnd(turn);
    this.sendRing(id);
    this.toast(`${target.label} ${this.describe(id, turn)}`);
  }

  private beginTurn(
    id: MidiTargetId,
    selected: readonly NonDeletedExcalidrawElement[],
  ): Turn {
    const selection = selectionKey(this.app.state);
    if (
      this.turn &&
      (this.turn.target !== id || this.turn.selection !== selection)
    ) {
      this.endTurn();
    }
    if (this.turn) {
      return this.turn;
    }
    const originalElementsMap: ElementsMap = new Map();
    for (const element of this.app.scene.getNonDeletedElements()) {
      originalElementsMap.set(element.id, deepCopyElement(element));
    }
    this.turn = {
      target: id,
      selection,
      originalElementsMap,
      originalElements: selected.map(
        (element) =>
          originalElementsMap.get(element.id) as NonDeletedExcalidrawElement,
      ),
      originalAppState: cloneJSON(this.app.state),
      detents: 0,
      timer: null,
    };
    return this.turn;
  }

  private scheduleTurnEnd(turn: Turn) {
    const window = this.app.ownerWindow;
    if (turn.timer !== null) {
      window.clearTimeout(turn.timer);
    }
    turn.timer = window.setTimeout(() => this.endTurn(), MIDI_TURN_IDLE_MS);
  }

  /** the hand has rested: what the turn changed becomes one undo step */
  endTurn = () => {
    const turn = this.turn;
    if (!turn) {
      return;
    }
    this.turn = null;
    if (turn.timer !== null) {
      this.app.ownerWindow.clearTimeout(turn.timer);
    }
    if (this.app.unmounted) {
      return;
    }
    if (turn.target === "width" || turn.target === "height") {
      const finish =
        turn.originalElements.length === 1
          ? finishSingleDimension
          : finishMultiDimension;
      finish({
        app: this.app,
        setAppState: this.app.setAppState,
        originalElements: turn.originalElements,
        originalAppState: turn.originalAppState,
      });
    }
    this.app.syncActionResult({
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /** the stats panel's drag handlers, for a turn measured in their units */
  private statsDrag(
    turn: Turn,
    property: "x" | "y" | "width" | "height" | "fontSize",
    accumulatedChange: number,
    nextValue?: number,
  ) {
    const { app } = this;
    const common = {
      accumulatedChange,
      instantChange: 0,
      originalElementsMap: turn.originalElementsMap,
      shouldKeepAspectRatio: false,
      shouldChangeByStepSize: false,
      scene: app.scene,
      nextValue,
      originalAppState: turn.originalAppState,
      setInputValue: () => {},
      app,
      setAppState: app.setAppState,
    };
    const single = turn.originalElements.length === 1;

    if (property === "fontSize") {
      const texts = this.textsOf(turn);
      if (texts.length === 1) {
        handleSingleFontSize({
          ...common,
          property,
          originalElements: texts,
        });
      } else if (texts.length) {
        handleMultiFontSize({ ...common, property, originalElements: texts });
      }
    } else if (property === "x" || property === "y") {
      (single ? handleSinglePosition : handleMultiPosition)({
        ...common,
        property,
        originalElements: turn.originalElements,
      });
    } else {
      (single ? handleSingleDimension : handleMultiDimension)({
        ...common,
        property,
        originalElements: turn.originalElements,
      });
    }
  }

  /** the text elements a font size turn reaches, as they were */
  private textsOf(turn: Turn): ExcalidrawTextElement[] {
    const map = turn.originalElementsMap as Parameters<
      typeof getApplicableTextElements
    >[1];
    if (turn.originalElements.length === 1) {
      const [element] = turn.originalElements;
      const text = isTextElement(element)
        ? element
        : hasBoundTextElement(element)
        ? getBoundTextElement(element, map)
        : null;
      return text ? [text] : [];
    }
    return getApplicableTextElements(turn.originalElements, map);
  }

  private applyTurn(turn: Turn) {
    const { app } = this;
    const { state, scene } = app;
    const target = MIDI_TARGETS[turn.target];
    const detents = turn.detents;
    const authoring = getAuthoringScale(state);
    const zoom = state.zoom.value;

    switch (turn.target) {
      case "x":
      case "y":
      case "width":
      case "height":
        this.statsDrag(
          turn,
          turn.target,
          (detents * this.stepOf(target.id)) / zoom,
        );
        return;
      case "fontSize":
        this.statsDrag(
          turn,
          "fontSize",
          detents * this.stepOf(target.id) * authoring,
        );
        return;
      case "scale": {
        const box = getCommonBoundingBox(turn.originalElements);
        const factor = (1 + this.stepOf(target.id)) ** detents;
        if (box.width * factor < 1 || box.height * factor < 1) {
          return;
        }
        resizeMultipleElements(
          this.selected(),
          scene.getNonDeletedElementsMap(),
          "se",
          scene,
          turn.originalElementsMap,
          {
            shouldMaintainAspectRatio: true,
            shouldResizeFromCenter: true,
            nextWidth: box.width * factor,
            nextHeight: box.height * factor,
            originalBoundingBox: box,
          },
        );
        return;
      }
      case "angle": {
        this.rotate(turn, detents * this.stepOf(target.id));
        return;
      }
      case "strokeWidth": {
        const factor = (1 + this.stepOf(target.id)) ** detents;
        this.eachSelected(turn, false, (original) => ({
          strokeWidth: Math.max(
            0.05 * authoring,
            original.strokeWidth * factor,
          ),
        }));
        return;
      }
      case "opacity":
        this.eachSelected(turn, true, (original) => ({
          opacity: Math.round(
            Math.max(
              0,
              Math.min(
                100,
                original.opacity + detents * this.stepOf(target.id),
              ),
            ),
          ),
        }));
        return;
      case "roughness":
        this.eachSelected(turn, false, (original) => ({
          roughness: round(
            Math.max(
              0,
              Math.min(
                4,
                original.roughness + detents * this.stepOf(target.id),
              ),
            ),
          ),
        }));
        return;
      case "strokeHue":
        this.eachSelected(turn, true, (original) => ({
          strokeColor: spinColorHue(
            original.strokeColor,
            detents * this.stepOf(target.id),
          ),
        }));
        return;
      case "backgroundHue":
        this.eachSelected(turn, false, (original) => ({
          backgroundColor: spinColorHue(
            original.backgroundColor,
            detents * this.stepOf(target.id),
          ),
        }));
        return;
      case "strokeSaturation":
      case "strokeLightness":
      case "backgroundSaturation":
      case "backgroundLightness": {
        const { property, component } = COLOUR_COMPONENTS[turn.target]!;
        this.eachSelected(turn, property === "strokeColor", (original) => {
          const color = original[property];
          const current = getColorSaturationLightness(color);
          return current
            ? {
                [property]: setColorSaturationLightness(color, {
                  [component]:
                    current[component] + detents * this.stepOf(target.id),
                }),
              }
            : {};
        });
      }
    }
  }

  /** writes each selected element (and, if asked, its label) from its state
   * when the turn began */
  private eachSelected(
    turn: Turn,
    includeBoundText: boolean,
    update: (original: ExcalidrawElement) => ElementUpdate<ExcalidrawElement>,
  ) {
    const { scene } = this.app;
    const elementsMap = scene.getNonDeletedElementsMap();
    const ids = new Set(turn.originalElements.map((element) => element.id));
    if (includeBoundText) {
      for (const element of turn.originalElements) {
        const text = getBoundTextElement(element, turn.originalElementsMap);
        if (text) {
          ids.add(text.id);
        }
      }
    }
    for (const id of ids) {
      const original = turn.originalElementsMap.get(id);
      const latest = elementsMap.get(id);
      if (original && latest) {
        scene.mutateElement(latest, update(original), {
          informMutation: false,
          isDragging: false,
        });
      }
    }
  }

  /** turns the selection about its centre, as the rotation handle would
   * with the pointer swung `degrees` round from where it began */
  private rotate(turn: Turn, degrees: number) {
    const { scene } = this.app;
    const selected = this.selected();
    const [minX, minY, maxX, maxY] = getCommonBounds(turn.originalElements);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const single = selected.length === 1 ? selected[0] : null;
    if (single && isFrameLikeElement(single)) {
      return;
    }
    // a single element is set to the pointer's angle; a selection turns by it
    const base = single
      ? turn.originalElementsMap.get(single.id)?.angle ?? 0
      : 0;
    const angle = base + degreesToRadians(degrees as any);
    const originals = new Map(
      turn.originalElements.map((element) => [element.id, element]),
    );
    let pointerX = cx + Math.sin(angle) * 100;
    let pointerY = cy - Math.cos(angle) * 100;
    if (single) {
      // a single element turns about its own centre
      const [x1, y1, x2, y2] = getElementAbsoluteCoords(
        single,
        scene.getNonDeletedElementsMap(),
      );
      pointerX = (x1 + x2) / 2 + Math.sin(angle) * 100;
      pointerY = (y1 + y2) / 2 - Math.cos(angle) * 100;
    }
    transformElements(
      originals as any,
      "rotation",
      selected,
      scene,
      false,
      false,
      false,
      pointerX,
      pointerY,
      cx,
      cy,
    );
  }

  /** a stepped target moved by whole steps: undo or redo, a layer up or
   * down, or the next choice along; each move its own undo step */
  private move(id: MidiTargetId, moves: number) {
    const { actionManager } = this.app;
    const target = MIDI_TARGETS[id];
    if (id === "history") {
      const action = actionManager.actions[moves < 0 ? "undo" : "redo"];
      for (let i = 0; i < Math.abs(moves); i++) {
        actionManager.executeAction(action, "api");
      }
      this.toast(moves < 0 ? "Undo" : "Redo");
      return;
    }
    if (id === "layer") {
      if (!this.selected().length) {
        return;
      }
      const action = moves < 0 ? actionSendBackward : actionBringForward;
      for (let i = 0; i < Math.abs(moves); i++) {
        actionManager.executeAction(action, "api");
      }
      this.toast(moves < 0 ? "Sent backward" : "Brought forward");
      return;
    }
    if (isChoiceTarget(id) && target.options) {
      const last = target.options.length - 1;
      const index = Math.max(0, Math.min(last, (this.read(id) ?? 0) + moves));
      this.choose(id, index);
    }
  }

  private choose(id: ChoiceTargetId, index: number) {
    const option = MIDI_TARGETS[id].options![index];
    this.app.actionManager.executeAction(
      CHOICE_ACTIONS[id] as any,
      "api",
      option,
    );
    this.sendRing(id);
    this.toast(`${MIDI_TARGETS[id].label} ${option}`);
  }

  private setGridStep(next: number) {
    const gridStep = getNormalizedGridStep(next);
    this.app.setState({ gridStep }, () => this.sendRing("gridStep"));
    this.toast(`Grid size ${gridStep}`);
  }

  private turnNextStyle(id: MidiTargetId, detents: number) {
    const { state } = this.app;
    const target = MIDI_TARGETS[id];
    let next: Partial<AppState> = {};
    switch (id) {
      case "strokeWidth":
        next = {
          currentItemFreedrawStrokeWidth: Math.max(
            0.05,
            round(
              state.currentItemFreedrawStrokeWidth *
                (1 + this.stepOf(target.id)) ** detents,
              3,
            ),
          ),
        };
        break;
      case "opacity":
        next = {
          currentItemOpacity: Math.max(
            0,
            Math.min(
              100,
              state.currentItemOpacity + detents * this.stepOf(target.id),
            ),
          ),
        };
        break;
      case "roughness":
        next = {
          currentItemRoughness: round(
            Math.max(
              0,
              Math.min(
                4,
                state.currentItemRoughness + detents * this.stepOf(target.id),
              ),
            ),
          ),
        };
        break;
      case "fontSize":
        next = {
          currentItemFontSize: Math.max(
            4,
            Math.round(
              (state.currentItemFontSize || DEFAULT_FONT_SIZE) +
                detents * this.stepOf(target.id),
            ),
          ),
        };
        break;
    }
    this.app.setState(next as AppState, () => this.sendRing(id));
    const value = this.read(id, { ...state, ...next });
    this.toast(
      `Next shape · ${target.label} ${value === null ? "" : round(value)}`,
    );
  }

  private turnView(id: MidiTargetId, detents: number) {
    const { state } = this.app;
    const target = MIDI_TARGETS[id];
    if (!this.app.isNavigationEnabled()) {
      return;
    }
    if (id === "zoom") {
      const nextZoom = getNormalizedZoom(
        state.zoom.value * (1 + this.stepOf(target.id)) ** detents,
      );
      this.app.syncActionResult({
        appState: {
          ...state,
          ...getViewportForZoomWithScrollConstraints(
            {
              viewportX: state.width / 2 + state.offsetLeft,
              viewportY: state.height / 2 + state.offsetTop,
              nextZoom,
            },
            state,
          ),
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
      this.sendRing("zoom");
      this.toast(`Zoom ${Math.round(nextZoom * 100)}%`);
      return;
    }
    const delta = (detents * this.stepOf(target.id)) / state.zoom.value;
    this.app.setState({
      scrollX: id === "panX" ? state.scrollX - delta : state.scrollX,
      scrollY: id === "panY" ? state.scrollY - delta : state.scrollY,
    });
  }

  /** steps the selection through the scene in stacking order, a group at a
   * time, and brings it into view */
  private cycleSelection(detents: number) {
    const { app } = this;
    const { state, scene } = app;
    const elements = scene.getNonDeletedElements();
    const units: NonDeletedExcalidrawElement[][] = [];
    const seen = new Set<string>();
    for (const element of elements) {
      if (isTextElement(element) && element.containerId) {
        continue;
      }
      if (element.locked) {
        continue;
      }
      const group = element.groupIds[element.groupIds.length - 1];
      const key = group ?? element.id;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      units.push(
        group ? elements.filter((e) => e.groupIds.includes(group)) : [element],
      );
    }
    if (!units.length) {
      return;
    }
    const selectedIds = new Set(
      getSelectedElements(elements, state).map((e) => e.id),
    );
    const current = units.findIndex((unit) =>
      unit.some((element) => selectedIds.has(element.id)),
    );
    const step = Math.sign(detents);
    const index =
      current === -1
        ? step > 0
          ? 0
          : units.length - 1
        : (current + step + units.length) % units.length;
    const unit = units[index];
    const selectedElementIds = Object.fromEntries(
      unit.map((element) => [element.id, true as const]),
    );
    const next = {
      ...selectGroupsForSelectedElements(
        { editingGroupId: null, selectedElementIds },
        elements,
        state,
        app,
      ),
    };
    const elementsMap = scene.getNonDeletedElementsMap();
    const inView = unit.some((element) =>
      isElementInViewport(
        element,
        state.width,
        state.height,
        state,
        elementsMap,
      ),
    );
    let scroll: Partial<AppState> = {};
    if (!inView) {
      const [minX, minY, maxX, maxY] = getCommonBounds(unit);
      scroll = {
        scrollX: state.width / 2 / state.zoom.value - (minX + maxX) / 2,
        scrollY: state.height / 2 / state.zoom.value - (minY + maxY) / 2,
      };
    }
    app.syncActionResult({
      appState: { ...state, ...next, ...scroll },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  /** a press of a knob's switch: its target back to its default */
  private reset(id: MidiTargetId) {
    const target = MIDI_TARGETS[id];
    const { app } = this;
    if (VIEW_TARGETS.has(id)) {
      if (id === "zoom") {
        const current = app.state.zoom.value;
        this.turnView(
          "zoom",
          Math.log(1 / current) / Math.log(1 + this.stepOf(target.id)),
        );
      }
      return;
    }
    if (app.state.viewModeEnabled || !app.isInteractionEnabled()) {
      return;
    }
    if (id === "select") {
      app.syncActionResult({
        appState: {
          ...app.state,
          selectedElementIds: {},
          selectedGroupIds: {},
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      return;
    }
    if (id === "gridStep") {
      this.setGridStep(DEFAULT_GRID_STEP);
      return;
    }
    if (isChoiceTarget(id)) {
      this.endTurn();
      this.carry.delete(id);
      this.choose(id, target.reset ?? 0);
      return;
    }
    if (target.reset === undefined) {
      return;
    }
    const selected = this.selected();
    if (!selected.length) {
      if (STYLE_TARGETS.has(id)) {
        const reset: Partial<AppState> =
          id === "opacity"
            ? { currentItemOpacity: 100 }
            : id === "roughness"
            ? { currentItemRoughness: 1 }
            : id === "fontSize"
            ? { currentItemFontSize: DEFAULT_FONT_SIZE }
            : { currentItemStrokeWidthKey: "medium" };
        app.setState(reset as AppState, () => this.sendRing(id));
        this.toast(`Next shape · ${target.label} reset`);
      }
      return;
    }
    this.endTurn();
    const turn = this.beginTurn(id, selected);
    const authoring = getAuthoringScale(app.state);
    switch (id) {
      case "strokeWidth":
        this.eachSelected(turn, false, (original) => ({
          strokeWidth: getStrokeWidthByKey(original.type, "medium") * authoring,
        }));
        break;
      case "opacity":
      case "roughness":
        this.eachSelected(turn, id === "opacity", () => ({
          [id]: target.reset,
        }));
        break;
      case "fontSize":
        this.statsDrag(turn, "fontSize", 0, DEFAULT_FONT_SIZE * authoring);
        break;
      case "angle":
        for (const element of this.selected()) {
          if (!isFrameLikeElement(element)) {
            app.scene.mutateElement(element, { angle: 0 as Radians });
            const text = getBoundTextElement(
              element,
              app.scene.getNonDeletedElementsMap(),
            );
            if (text) {
              app.scene.mutateElement(text, { angle: 0 as Radians });
            }
          }
        }
        break;
    }
    app.scene.triggerUpdate();
    this.endTurn();
    this.sendRing(id);
    this.toast(`${target.label} reset`);
  }

  // ---------------------------------------------------------------------------
  // rings and feedback
  // ---------------------------------------------------------------------------

  /** the value a target's ring shows: the first selected element's, or the
   * next shape's with nothing selected; null where there's no gauge */
  read(id: MidiTargetId, state: AppState = this.app.state): number | null {
    const authoring = getAuthoringScale(state);
    if (id === "zoom") {
      return state.zoom.value;
    }
    if (id === "gridStep") {
      return state.gridStep;
    }
    const [element] = this.app.scene.getSelectedElements(state);
    const options = MIDI_TARGETS[id].options;
    if (options) {
      const value = this.readChoice(id, element, state);
      const index = value === null ? -1 : options.indexOf(value);
      return index === -1 ? null : index;
    }
    const colour = COLOUR_COMPONENTS[id];
    if (colour) {
      return element
        ? getColorSaturationLightness(element[colour.property])?.[
            colour.component
          ] ?? null
        : null;
    }
    if (!element) {
      switch (id) {
        case "opacity":
          return state.currentItemOpacity;
        case "roughness":
          return state.currentItemRoughness;
        case "fontSize":
          return state.currentItemFontSize || DEFAULT_FONT_SIZE;
        case "strokeWidth":
          return getStrokeWidthByKey(
            "rectangle",
            state.currentItemStrokeWidthKey,
          );
      }
      return null;
    }
    switch (id) {
      case "opacity":
        return element.opacity;
      case "roughness":
        return element.roughness;
      case "strokeWidth":
        return element.strokeWidth / authoring;
      case "angle":
        return (radiansToDegrees(element.angle) + 360) % 360;
      case "fontSize": {
        const elementsMap = this.app.scene.getNonDeletedElementsMap();
        const text = isTextElement(element)
          ? element
          : getBoundTextElement(element, elementsMap);
        return text ? getBaseFontSize(text, elementsMap) / authoring : null;
      }
    }
    return null;
  }

  /** the option a choice is on: the first selected element's, or the next
   * shape's */
  private readChoice(
    id: MidiTargetId,
    element: NonDeletedExcalidrawElement | undefined,
    state: AppState,
  ): string | null {
    const elementsMap = this.app.scene.getNonDeletedElementsMap();
    switch (id) {
      case "strokeStyle":
        return element?.strokeStyle ?? state.currentItemStrokeStyle;
      case "fillStyle":
        return element?.fillStyle ?? state.currentItemFillStyle;
      case "roundness":
        return element
          ? element.roundness
            ? "round"
            : "sharp"
          : state.currentItemRoundness;
      case "textAlign": {
        const text =
          element &&
          (isTextElement(element)
            ? element
            : getBoundTextElement(element, elementsMap));
        return text ? text.textAlign : state.currentItemTextAlign;
      }
    }
    return null;
  }

  private describe(id: MidiTargetId, turn: Turn) {
    const value = this.read(id);
    if (value !== null) {
      return id === "opacity" ? `${Math.round(value)}%` : `${round(value)}`;
    }
    const target = MIDI_TARGETS[id];
    switch (id) {
      case "scale":
        return `×${round((1 + this.stepOf(target.id)) ** turn.detents)}`;
      case "strokeHue":
      case "backgroundHue":
        return `${Math.round(turn.detents * this.stepOf(target.id))}°`;
      default: {
        const amount = Math.round(
          (turn.detents * this.stepOf(target.id)) / this.app.state.zoom.value,
        );
        return amount >= 0 ? `+${amount}` : `${amount}`;
      }
    }
  }

  /** the outputs of the ports that have spoken, which are the ones whose
   * rings are listening */
  private outputs() {
    if (!this.access || this.options?.feedback === false) {
      return [];
    }
    return [...this.access.outputs.values()].filter(
      (output) =>
        output.state !== "disconnected" &&
        this.heardFrom.has(output.name || output.id),
    );
  }

  /** tells every knob bound to `id` where its value sits: a gauge shows the
   * value, a jog wheel goes back to the middle */
  sendRing(id: MidiTargetId) {
    const outputs = this.outputs();
    if (!outputs.length) {
      return;
    }
    const target: MidiTarget = MIDI_TARGETS[id];
    const value = target.ring ? this.read(id) : null;
    const position = value === null ? 64 : ringPosition(target, value);
    for (const binding of this.bindings) {
      if (binding.target !== id) {
        continue;
      }
      const key = bindingKey(binding.channel, binding.cc);
      this.knobs.set(key, { ...this.knobs.get(key), last: position });
      for (const output of outputs) {
        try {
          output.send(
            controlChangeBytes(binding.channel, binding.cc, position),
          );
        } catch {
          // a port that went away mid-send
        }
      }
    }
  }

  syncRings() {
    for (const id of new Set(this.bindings.map((b) => b.target))) {
      this.sendRing(id);
    }
  }

  /** from componentDidUpdate: a new selection ends the turn and brings the
   * rings round to it */
  handleStateChange(prevState: AppState) {
    if (!this.access) {
      return;
    }
    if (prevState.selectedElementIds !== this.app.state.selectedElementIds) {
      const selection = selectionKey(this.app.state);
      if (selection !== this.lastSelection) {
        this.lastSelection = selection;
        if (this.turn && this.turn.selection !== selection) {
          this.endTurn();
        }
        this.syncRings();
      }
    }
  }

  private toast(message: string, duration = TOAST_MS) {
    if (this.options?.toasts === false) {
      return;
    }
    this.app.setToast({ message, duration, closable: false });
  }
}
