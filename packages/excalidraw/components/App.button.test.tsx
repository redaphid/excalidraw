import React from "react";
import { vi } from "vitest";

import { arrayToMap, CURSOR_TYPE, KEYS, ROUNDNESS } from "@excalidraw/common";
import {
  getButtonIcon,
  duplicateElements,
  getBoundTextMaxWidth,
  getBoundTextPadding,
  getButtonLabelLeft,
  redrawTextBoundingBox,
  computeBoundTextPosition,
  isButtonElement,
} from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type {
  ExcalidrawButtonElement,
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  NonDeleted,
} from "@excalidraw/element/types";

import { convertToExcalidrawElements, Excalidraw, exportToSvg } from "../index";
import { restoreElements } from "../data/restore";
import { API } from "../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../tests/helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "../tests/test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const newButton = (opts: Partial<ExcalidrawElement> = {}) =>
  ({
    ...API.createElement({
      type: "rectangle",
      id: "button-thunderwrench",
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      backgroundColor: "#a5d8ff",
    }),
    ...opts,
    customData: { isButton: true },
  } as ExcalidrawButtonElement);

const newLiveButton = () => newButton() as NonDeleted<ExcalidrawButtonElement>;

const newBystander = () =>
  API.createElement({
    type: "rectangle",
    id: "bystander-rusty-conquistador",
    x: 500,
    y: 500,
    width: 100,
    height: 100,
    backgroundColor: "#b2f2bb",
  });

const cursor = () => GlobalTestState.interactiveCanvas.style.cursor;

const snapshotScene = () =>
  h.elements.map(({ id, version, versionNonce, x, y }) => ({
    id,
    version,
    versionNonce,
    x,
    y,
  }));

describe("button element", () => {
  const onButtonClick = vi.fn();

  beforeEach(async () => {
    unmountComponent();
    onButtonClick.mockReset();
    mouse.reset();
    await render(
      <Excalidraw
        onButtonClick={onButtonClick}
        handleKeyboardGlobally={true}
      />,
    );
    API.setElements([newButton(), newBystander()]);
    act(() => {
      h.setState({ width: 1000, height: 1000 });
    });
  });

  describe("when clicked", () => {
    it("fires once, with the element id alone", () => {
      mouse.clickAt(200, 140);
      expect(onButtonClick.mock.calls).toEqual([["button-thunderwrench"]]);
    });

    it("fires for each of two quick clicks", () => {
      mouse.clickAt(200, 140);
      mouse.clickAt(200, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(2);
    });

    it("fires when the fill is transparent", () => {
      API.setElements([newButton({ backgroundColor: "transparent" })]);
      mouse.clickAt(200, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    it("tolerates a hand's jitter", () => {
      mouse.downAt(200, 140);
      mouse.moveTo(205, 143);
      mouse.upAt(205, 143);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    it("does not select the button", () => {
      mouse.clickAt(200, 140);
      expect(h.state.selectedElementIds).toEqual({});
    });

    it("keeps what else was selected", () => {
      API.setSelectedElements([newBystander()]);
      mouse.clickAt(200, 140);
      expect(Object.keys(h.state.selectedElementIds)).toEqual([
        "bystander-rusty-conquistador",
      ]);
    });

    it("changes no element", () => {
      const before = snapshotScene();
      mouse.clickAt(200, 140);
      expect(snapshotScene()).toEqual(before);
    });

    it("creates no undo entry", () => {
      const before = API.getUndoStack().length;
      API.setSelectedElements([newBystander()]);
      mouse.clickAt(200, 140);
      expect(API.getUndoStack().length).toBe(before);
    });

    it("does not edit the label on a double click", () => {
      mouse.clickAt(200, 140);
      mouse.clickAt(200, 140);
      mouse.doubleClickAt(200, 140);
      expect(h.state.editingTextElement).toBeNull();
    });

    it("still fires when the button is locked", () => {
      API.setElements([newButton({ locked: true })]);
      mouse.clickAt(200, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    it("sends no durable increment", async () => {
      unmountComponent();
      const onIncrement = vi.fn();
      await render(
        <Excalidraw
          onButtonClick={onButtonClick}
          onIncrement={(increment) => {
            if (increment.type === "durable") {
              onIncrement(increment);
            }
          }}
        />,
      );
      API.setElements([newButton()]);
      mouse.clickAt(200, 140);
      expect(onIncrement).not.toHaveBeenCalled();
    });
  });

  describe("when dragged", () => {
    beforeEach(() => {
      mouse.downAt(200, 140);
      mouse.moveTo(260, 160);
      mouse.moveTo(280, 170);
      mouse.upAt(280, 170);
    });

    it("does not fire", () => {
      expect(onButtonClick).not.toHaveBeenCalled();
    });

    it("moves the button", () => {
      expect(h.elements[0].x).not.toBe(100);
    });

    it("selects the button, as moving anything does", () => {
      expect(h.state.selectedElementIds["button-thunderwrench"]).toBe(true);
    });
  });

  it("does not fire when the drag comes back to where it started", () => {
    mouse.downAt(200, 140);
    mouse.moveTo(260, 160);
    mouse.moveTo(200, 140);
    mouse.upAt(200, 140);
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it("does not fire when released far away with no move between", () => {
    mouse.downAt(200, 140);
    mouse.upAt(290, 170);
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it("does not fire when released on something else", () => {
    API.setElements([newButton({ width: 5, height: 5 })]);
    mouse.downAt(102, 102);
    mouse.upAt(109, 102);
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it("does not fire when the browser takes the pointer over", () => {
    mouse.downAt(200, 140);
    fireEvent.pointerCancel(GlobalTestState.interactiveCanvas, {
      pointerId: 1,
    });
    mouse.upAt(200, 140);
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it("leaves empty canvas box selection as it was", () => {
    mouse.downAt(50, 50);
    mouse.moveTo(400, 400);
    expect(h.state.selectionElement).not.toBeNull();
  });

  it("leaves selecting other elements as it was", () => {
    mouse.clickAt(550, 550);
    expect(Object.keys(h.state.selectedElementIds)).toEqual([
      "bystander-rusty-conquistador",
    ]);
  });

  it("leaves other tools to draw over it", () => {
    UI.clickTool("rectangle");
    mouse.downAt(200, 140);
    mouse.moveTo(260, 170);
    mouse.upAt(260, 170);
    expect(onButtonClick).not.toHaveBeenCalled();
    expect(h.elements.length).toBe(3);
  });

  it("leaves a secondary button press alone", () => {
    fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
      clientX: 200,
      clientY: 140,
      button: 2,
      pointerId: 1,
    });
    expect(h.app.button.highlight).toBeNull();
  });

  describe("cursor", () => {
    it("is a pointer over the label area", () => {
      mouse.moveTo(250, 140);
      expect(cursor()).toBe(CURSOR_TYPE.POINTER);
    });

    it("is a pointer over the icon", () => {
      const [[x, y]] = getButtonIcon(newButton()).corners;
      mouse.moveTo(100 + x + 2, 100 + y + 2);
      expect(cursor()).toBe(CURSOR_TYPE.POINTER);
    });

    it("is a pointer in view mode", () => {
      API.setAppState({ viewModeEnabled: true });
      mouse.moveTo(200, 140);
      expect(cursor()).toBe(CURSOR_TYPE.POINTER);
    });

    it("goes back when the pointer leaves", () => {
      mouse.moveTo(200, 140);
      mouse.moveTo(50, 50);
      expect(cursor()).not.toBe(CURSOR_TYPE.POINTER);
    });

    it("goes back to grab with the hand tool", () => {
      UI.clickTool("hand");
      mouse.moveTo(50, 50);
      const atRest = cursor();
      mouse.moveTo(200, 140);
      mouse.moveTo(50, 50);
      expect(cursor()).toBe(atRest);
    });

    it("rests on grab with the hand tool", () => {
      UI.clickTool("hand");
      mouse.moveTo(200, 140);
      mouse.moveTo(50, 50);
      expect(cursor()).toBe(CURSOR_TYPE.GRAB);
    });

    it("goes back to grab in view mode", () => {
      API.setAppState({ viewModeEnabled: true });
      mouse.moveTo(200, 140);
      mouse.moveTo(50, 50);
      expect(cursor()).toBe(CURSOR_TYPE.GRAB);
    });

    it("rests on grab in view mode after a camera change", () => {
      API.setAppState({ viewModeEnabled: true });
      mouse.moveTo(200, 140);
      act(() => {
        h.setState({ scrollX: 40 });
      });
      expect(cursor()).toBe(CURSOR_TYPE.GRAB);
    });

    it("stays grab when space is held and the mouse moves off a hover", () => {
      mouse.moveTo(200, 140);
      Keyboard.keyDown(KEYS.SPACE);
      mouse.moveTo(205, 140);
      expect(cursor()).toBe(CURSOR_TYPE.GRAB);
      Keyboard.keyUp(KEYS.SPACE);
    });

    it("goes back with the hand tool when released off a tiny button", () => {
      API.setElements([newButton({ width: 5, height: 5 })]);
      UI.clickTool("hand");
      mouse.downAt(102, 102);
      mouse.upAt(109, 102);
      expect(cursor()).toBe(CURSOR_TYPE.GRAB);
    });

    it("is not a pointer for another tool", () => {
      UI.clickTool("rectangle");
      mouse.moveTo(200, 140);
      expect(cursor()).not.toBe(CURSOR_TYPE.POINTER);
    });
  });

  describe("highlight", () => {
    it("is hovered over the button", () => {
      mouse.moveTo(200, 140);
      expect(h.app.button.highlight).toEqual({
        id: "button-thunderwrench",
        pressed: false,
      });
    });

    it("is pressed on pointer down, before any release", () => {
      mouse.downAt(200, 140);
      expect(h.app.button.highlight).toEqual({
        id: "button-thunderwrench",
        pressed: true,
      });
    });

    it("drops the press once it is a drag", () => {
      mouse.downAt(200, 140);
      mouse.moveTo(260, 160);
      expect(h.app.button.highlight).toBeNull();
    });

    it("goes back to hovered on release", () => {
      mouse.clickAt(200, 140);
      expect(h.app.button.highlight).toEqual({
        id: "button-thunderwrench",
        pressed: false,
      });
    });

    it("goes when the pointer leaves the canvas", () => {
      mouse.moveTo(200, 140);
      fireEvent.pointerLeave(GlobalTestState.interactiveCanvas);
      expect(h.app.button.highlight).toBeNull();
    });
  });

  describe("a host listening for the highlight", () => {
    const onButtonHighlight = vi.fn();

    beforeEach(async () => {
      unmountComponent();
      onButtonHighlight.mockReset();
      await render(
        <Excalidraw
          onButtonClick={onButtonClick}
          onButtonHighlight={onButtonHighlight}
        />,
      );
      API.setElements([newButton()]);
    });

    it("hears the press during the pointer down", () => {
      mouse.downAt(200, 140);
      expect(onButtonHighlight).toHaveBeenLastCalledWith({
        id: "button-thunderwrench",
        pressed: true,
      });
    });

    it("hears the hover", () => {
      mouse.moveTo(200, 140);
      expect(onButtonHighlight).toHaveBeenLastCalledWith({
        id: "button-thunderwrench",
        pressed: false,
      });
    });

    it("hears the end", () => {
      mouse.moveTo(200, 140);
      mouse.moveTo(50, 50);
      expect(onButtonHighlight).toHaveBeenLastCalledWith(null);
    });

    it("hears nothing new while the state stays the same", () => {
      mouse.moveTo(200, 140);
      mouse.moveTo(210, 140);
      expect(onButtonHighlight).toHaveBeenCalledTimes(1);
    });
  });

  describe("in view mode", () => {
    beforeEach(() => {
      API.setAppState({ viewModeEnabled: true });
    });

    it("fires on a click", () => {
      mouse.clickAt(200, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    describe("and dragged", () => {
      const scrollBefore = 0;

      beforeEach(() => {
        API.setAppState({ scrollX: scrollBefore });
        mouse.downAt(200, 140);
        mouse.moveTo(260, 140);
        mouse.moveTo(280, 140);
        mouse.upAt(280, 140);
      });

      it("pans instead of firing", () => {
        expect(onButtonClick).not.toHaveBeenCalled();
      });

      it("pans the canvas", async () => {
        await waitFor(() => {
          expect(h.state.scrollX).not.toBe(scrollBefore);
        });
      });
    });
  });

  describe("with the hand tool", () => {
    beforeEach(() => {
      UI.clickTool("hand");
    });

    it("fires on a click", () => {
      mouse.clickAt(200, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    it("pans on a drag", async () => {
      mouse.downAt(200, 140);
      mouse.moveTo(260, 140);
      mouse.moveTo(280, 140);
      mouse.upAt(280, 140);
      expect(onButtonClick).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(h.state.scrollX).not.toBe(0);
      });
    });
  });

  describe("two fingers", () => {
    const fingerOne = new Pointer("touch", 11);
    const fingerTwo = new Pointer("touch", 12);

    it("is a gesture, not a click", () => {
      fingerOne.downAt(200, 140);
      fingerTwo.downAt(600, 400);
      fingerTwo.upAt(600, 400);
      fingerOne.upAt(200, 140);
      expect(onButtonClick).not.toHaveBeenCalled();
    });
  });

  describe("editing", () => {
    it("selects on shift click", () => {
      Keyboard.withModifierKeys({ shift: true }, () => {
        mouse.clickAt(200, 140);
      });
      expect(onButtonClick).not.toHaveBeenCalled();
      expect(h.state.selectedElementIds["button-thunderwrench"]).toBe(true);
    });

    it("leaves alt to its own meaning", () => {
      Keyboard.withModifierKeys({ alt: true }, () => {
        mouse.clickAt(200, 140);
      });
      expect(onButtonClick).not.toHaveBeenCalled();
    });

    describe("once selected", () => {
      beforeEach(() => {
        API.setSelectedElements([newLiveButton()]);
      });

      it("still fires on a click", () => {
        mouse.clickAt(200, 140);
        expect(onButtonClick).toHaveBeenCalledTimes(1);
      });

      it("opens no editor on a double click", () => {
        mouse.doubleClickAt(200, 140);
        expect(h.state.editingTextElement).toBeNull();
      });

      it("moves on a drag", () => {
        mouse.downAt(200, 140);
        mouse.moveTo(260, 170);
        mouse.moveTo(280, 180);
        mouse.upAt(280, 180);
        expect(h.elements[0].x).toBe(180);
      });

      it("deletes", () => {
        Keyboard.keyPress(KEYS.DELETE);
        expect(h.elements[0].isDeleted).toBe(true);
      });
    });
  });

  it("does not fire while text is being edited", () => {
    mouse.doubleClickAt(700, 300);
    expect(h.state.editingTextElement).not.toBeNull();
    mouse.clickAt(200, 140);
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  it("does not fire with the lasso tool", () => {
    act(() => {
      h.app.setActiveTool({ type: "lasso" });
    });
    mouse.clickAt(200, 140);
    expect(onButtonClick).not.toHaveBeenCalled();
  });

  describe("after a change of view under a still pointer", () => {
    it("drops the hover", () => {
      mouse.moveTo(200, 140);
      act(() => {
        h.setState({ scrollX: 40 });
      });
      expect(h.app.button.highlight).toBeNull();
    });
  });

  describe("a copy", () => {
    const copyOf = (elements: readonly ExcalidrawElement[]) =>
      duplicateElements({ type: "everything", elements });

    const labelledButton = () =>
      convertToExcalidrawElements(
        [
          {
            type: "rectangle",
            x: 0,
            y: 0,
            width: 300,
            height: 80,
            customData: { isButton: true, keptBy: "the-lair" },
            label: { text: "Run" },
          },
        ],
        { regenerateIds: false },
      ) as [ExcalidrawButtonElement, ExcalidrawTextElementWithContainer];

    it("is no longer a button", () => {
      const { duplicatedElements } = copyOf(labelledButton());
      expect(isButtonElement(duplicatedElements[0])).toBe(false);
    });

    it("keeps the host's other custom data", () => {
      const { duplicatedElements } = copyOf(labelledButton());
      expect(duplicatedElements[0].customData).toEqual({
        keptBy: "the-lair",
      });
    });

    it("leaves the original a button", () => {
      const original = labelledButton();
      copyOf(original);
      expect(isButtonElement(original[0])).toBe(true);
    });

    it("centers the label again", () => {
      const { duplicatedElements } = copyOf(labelledButton());
      const [, label] =
        duplicatedElements as ExcalidrawTextElementWithContainer[];
      expect(label.x + label.width / 2).toBeCloseTo(150);
    });

    it("is what ctrl+d makes", () => {
      API.setSelectedElements([newLiveButton()]);
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress("d");
      });
      expect(h.elements.filter(isButtonElement).length).toBe(1);
    });
  });

  describe("without a host callback", () => {
    beforeEach(async () => {
      unmountComponent();
      await render(<Excalidraw />);
      API.setElements([newButton()]);
    });

    it("selects as a plain rectangle", () => {
      mouse.clickAt(200, 140);
      expect(h.state.selectedElementIds["button-thunderwrench"]).toBe(true);
    });
  });

  describe("when the host turns interaction off", () => {
    beforeEach(async () => {
      unmountComponent();
      await render(
        <Excalidraw onButtonClick={onButtonClick} interaction={false} />,
      );
      API.setElements([newButton()]);
    });

    it("does not fire", () => {
      mouse.clickAt(200, 140);
      expect(onButtonClick).not.toHaveBeenCalled();
    });
  });

  describe("at extreme zoom", () => {
    const ZOOM = 1_000_000;
    // a button a millionth of the scene's size, deep inside it
    const deepButton = () =>
      newButton({ x: 1234.5, y: 987.25, width: 200 / ZOOM, height: 80 / ZOOM });

    beforeEach(() => {
      API.setElements([deepButton()]);
      act(() => {
        h.setState({
          zoom: { value: ZOOM as never },
          scrollX: -1234.5 + 100 / ZOOM,
          scrollY: -987.25 + 100 / ZOOM,
          offsetLeft: 0,
          offsetTop: 0,
        });
      });
    });

    it("fires at the center", () => {
      mouse.clickAt(200, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    it("misses just outside", () => {
      mouse.clickAt(60, 140);
      expect(onButtonClick).not.toHaveBeenCalled();
    });

    it("is a pointer just inside the corner of its box", () => {
      mouse.moveTo(290, 170);
      expect(cursor()).toBe(CURSOR_TYPE.POINTER);
    });
  });

  describe("zoomed far out", () => {
    it("still fires", () => {
      const ZOOM = 0.1;
      act(() => {
        h.setState({ zoom: { value: ZOOM as never }, scrollX: 0, scrollY: 0 });
      });
      mouse.clickAt(200 * ZOOM, 140 * ZOOM);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("inside a frame", () => {
    beforeEach(() => {
      const frame = API.createElement({
        type: "frame",
        id: "frame-valley-of-the-sun",
        x: 100,
        y: 100,
        width: 100,
        height: 80,
      });
      API.setElements([frame, newButton({ frameId: frame.id })]);
    });

    it("fires inside the frame", () => {
      mouse.clickAt(150, 140);
      expect(onButtonClick).toHaveBeenCalledTimes(1);
    });

    it("misses where the frame clips it", () => {
      mouse.clickAt(260, 140);
      expect(onButtonClick).not.toHaveBeenCalled();
    });
  });

  describe("under another element", () => {
    it("does not fire when covered", () => {
      API.setElements([
        newButton(),
        API.createElement({
          type: "rectangle",
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          backgroundColor: "#ffc9c9",
        }),
      ]);
      mouse.clickAt(200, 140);
      expect(onButtonClick).not.toHaveBeenCalled();
    });
  });

  describe("label", () => {
    const newLabelledButton = () =>
      convertToExcalidrawElements([
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 300,
          height: 80,
          customData: { isButton: true },
          label: { text: "Run" },
        },
      ]) as [ExcalidrawButtonElement, ExcalidrawTextElementWithContainer];

    it("is what a host gets from the skeleton API", () => {
      const [button] = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          customData: { isButton: true },
          label: { text: "Launch the Conquistador" },
        },
      ]);
      expect(isButtonElement(button)).toBe(true);
    });

    it("sits to the right of the icon", () => {
      const [button, label] = newLabelledButton();
      expect(getButtonIcon(button).corners[1][0]).toBeLessThan(label.x);
    });

    it("stays inside the button", () => {
      const [button, label] = newLabelledButton();
      expect(label.x + label.width).toBeLessThan(button.width);
    });

    describe("when a vertical resize makes the button taller", () => {
      it("keeps the label inside and clear of the icon", () => {
        const [button, label] = convertToExcalidrawElements(
          [
            {
              type: "rectangle",
              x: 0,
              y: 0,
              width: 400,
              height: 80,
              customData: { isButton: true },
              label: { text: "Launch the entire fleet at once" },
            },
          ],
          { regenerateIds: false },
        ) as [ExcalidrawButtonElement, ExcalidrawTextElementWithContainer];
        API.setElements([button, label]);
        UI.resize(h.elements[0] as never, "s", [0, 320]);
        const [nextButton, nextLabel] = h.elements as [
          ExcalidrawButtonElement,
          ExcalidrawTextElementWithContainer,
        ];
        expect(nextButton.height).toBe(400);
        expect(nextLabel.x + nextLabel.width).toBeLessThanOrEqual(400);
        expect(nextLabel.x).toBeGreaterThanOrEqual(
          getButtonIcon(nextButton).corners[1][0],
        );
      });
    });

    describe("when the label wraps taller than the button", () => {
      const grownButton = () => {
        const [button, label] = convertToExcalidrawElements(
          [
            {
              type: "rectangle",
              x: 0,
              y: 0,
              width: 100,
              height: 40,
              customData: { isButton: true },
              label: { text: "Launch the rocket now" },
            },
          ],
          { regenerateIds: false },
        ) as [ExcalidrawButtonElement, ExcalidrawTextElementWithContainer];
        API.setElements([button, label]);
        return () => {
          const [nextButton, nextLabel] = h.elements as [
            ExcalidrawButtonElement,
            ExcalidrawTextElementWithContainer,
          ];
          return { button: nextButton, label: nextLabel };
        };
      };

      it("keeps the label inside the button", () => {
        const { button, label } = grownButton()();
        expect(label.x + label.width).toBeLessThanOrEqual(button.width);
      });

      it("keeps the label clear of the icon", () => {
        const { button, label } = grownButton()();
        expect(label.x).toBeGreaterThanOrEqual(
          getButtonIcon(button).corners[1][0],
        );
      });

      it("settles in one pass", () => {
        const current = grownButton();
        const before = current();
        act(() => {
          redrawTextBoundingBox(before.label, before.button, h.app.scene);
        });
        const after = current();
        expect({
          text: after.label.text,
          width: after.button.width,
          height: after.button.height,
        }).toEqual({
          text: before.label.text,
          width: before.button.width,
          height: before.button.height,
        });
      });
    });

    it("is centered in the room the icon leaves", () => {
      const [button, label] = newLabelledButton();
      const left = getButtonLabelLeft(button);
      expect(label.x + label.width / 2).toBeCloseTo(
        (left + button.width - getBoundTextPadding(button)) / 2,
      );
    });

    it("keeps its offset when the button is rotated", () => {
      const angle = (Math.PI / 2) as Radians;
      const [button, label] = newLabelledButton();
      const elementsMap = arrayToMap<ExcalidrawElement>([button, label]);
      const upright = computeBoundTextPosition(button, label, elementsMap);
      const rotated = computeBoundTextPosition(
        { ...button, angle },
        label,
        elementsMap,
      );
      const center = pointFrom<GlobalPoint>(150, 40);
      const [x] = pointRotateRads(
        pointFrom<GlobalPoint>(
          upright.x + label.width / 2,
          upright.y + label.height / 2,
        ),
        center,
        angle,
      );
      expect(rotated.x + label.width / 2).toBeCloseTo(x);
    });

    it("gets less width for the icon", () => {
      const [, label] = newLabelledButton();
      expect(getBoundTextMaxWidth(newButton(), label)).toBeLessThan(
        getBoundTextMaxWidth(
          API.createElement({ type: "rectangle", width: 200, height: 80 }),
          label,
        ),
      );
    });
  });

  describe("export", () => {
    const newLabelledButtonForExport = () =>
      convertToExcalidrawElements([
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 300,
          height: 80,
          customData: { isButton: true },
          label: { text: "Run" },
        },
      ]) as NonDeleted<ExcalidrawElement>[];

    it("draws the icon into an SVG", async () => {
      const svg = await exportToSvg({
        elements: [newLiveButton()],
        appState: {},
        files: null,
      });
      expect(svg.querySelector("polygon")).not.toBeNull();
    });

    it("draws the icon in the same place without the label", async () => {
      const elements = newLabelledButtonForExport();
      const [withLabel, withoutLabel] = await Promise.all(
        [elements, [elements[0]]].map((set) =>
          exportToSvg({ elements: set, appState: {}, files: null }),
        ),
      );
      expect(
        withoutLabel.querySelector("polygon")?.getAttribute("points"),
      ).toBe(withLabel.querySelector("polygon")?.getAttribute("points"));
    });

    it("centers the icon of a button with no label", () => {
      const button = newButton();
      const { corners, cornerWidth } = getButtonIcon(button);
      expect(
        (corners[0][0] - cornerWidth + corners[1][0] + cornerWidth) / 2,
      ).toBeCloseTo(button.width / 2);
    });

    it("draws no icon on a plain rectangle", async () => {
      const svg = await exportToSvg({
        elements: [newBystander()],
        appState: {},
        files: null,
      });
      expect(svg.querySelector("polygon")).toBeNull();
    });
  });

  describe("a client that doesn't know buttons", () => {
    it("keeps the marker through a restore", () => {
      const [button] = restoreElements([newLiveButton()], null);
      expect(button.customData).toEqual({ isButton: true });
    });

    it("sees a rectangle", () => {
      const [button] = restoreElements([newLiveButton()], null);
      expect(button.type).toBe("rectangle");
    });
  });
});
