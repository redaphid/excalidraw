import type {
  ExcalidrawFreeDrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, fireEvent, GlobalTestState, render, screen } from "./test-utils";

const { h } = window;

describe("freedraw mode action", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    // https://github.com/floating-ui/floating-ui/issues/1908#issuecomment-1301553793
    await act(async () => {});
  });

  it("applies currentItemStrokeVariability to newly drawn freedraw elements", () => {
    // default app state draws constant-width strokes
    expect(h.state.currentItemStrokeVariability).toBe("constant");

    UI.createElement("freedraw", { x: 0, y: 0 });

    expect(
      (h.elements[0] as ExcalidrawFreeDrawElement).strokeOptions?.variability,
    ).toBe("constant");
    expect(
      (h.elements[0] as ExcalidrawFreeDrawElement).strokeOptions?.streamline,
    ).toBe(0.5);
  });

  it("toggling the radio updates both the selected element and the default", () => {
    const element = UI.createElement("freedraw", { x: 0, y: 0 });
    API.setSelectedElements([element.get()] as NonDeletedExcalidrawElement[]);

    fireEvent.click(screen.getByTitle("Variable"));
    expect(
      (h.elements[0] as ExcalidrawFreeDrawElement).strokeOptions?.variability,
    ).toBe("variable");
    expect(
      (h.elements[0] as ExcalidrawFreeDrawElement).strokeOptions?.streamline,
    ).toBe(0.5);
    expect(h.state.currentItemStrokeVariability).toBe("variable");

    fireEvent.click(screen.getByTitle("Constant"));
    expect(
      (h.elements[0] as ExcalidrawFreeDrawElement).strokeOptions?.variability,
    ).toBe("constant");
    expect(
      (h.elements[0] as ExcalidrawFreeDrawElement).strokeOptions?.streamline,
    ).toBe(0.5);
    expect(h.state.currentItemStrokeVariability).toBe("constant");
  });
});

describe("freedraw pressure", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  afterEach(async () => {
    await act(async () => {});
  });

  const draw = (pointerType: string, pressure: number) => {
    UI.clickTool("freedraw");
    const canvas = GlobalTestState.interactiveCanvas;
    const at = (clientX: number) => ({
      clientX,
      clientY: 40,
      pointerType,
      pointerId: 7,
      pressure,
      isPrimary: true,
      button: 0,
      buttons: 1,
    });
    fireEvent.pointerDown(canvas, at(20));
    fireEvent.pointerMove(canvas, at(40));
    fireEvent.pointerMove(canvas, at(60));
    fireEvent.pointerUp(canvas, at(80));
    return h.elements[0] as ExcalidrawFreeDrawElement;
  };

  it("trusts a pen that presses at exactly half pressure", () => {
    const element = draw("pen", 0.5);
    expect(element.simulatePressure).toBe(false);
    expect(element.pressures).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("simulates a mouse's pressure, which is always half", () => {
    const element = draw("mouse", 0.5);
    expect(element.simulatePressure).toBe(true);
    expect(element.pressures).toEqual([]);
  });
});
