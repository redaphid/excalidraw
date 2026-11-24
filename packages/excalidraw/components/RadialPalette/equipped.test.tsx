import { fireEvent, queryByTestId } from "@testing-library/react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { Keyboard } from "../../tests/helpers/ui";
import { act, render, unmountComponent } from "../../tests/test-utils";

import { CHIP_RADIUS, chipSpot, isEquipped } from "./equipped";

const { h } = window;

const chip = () => queryByTestId(document.body, "radial-palette-equipped");

describe("what is equipped", () => {
  it("is every tool but the ones a hand rests on", () => {
    expect(isEquipped("rectangle")).toBe(true);
    expect(isEquipped("freedraw")).toBe(true);
    expect(isEquipped("eraser")).toBe(true);
    expect(isEquipped("hand")).toBe(false);
    expect(isEquipped("selection")).toBe(false);
    expect(isEquipped("lasso")).toBe(false);
  });
});

describe("the equipped chip's spot", () => {
  const screen = { width: 400, height: 800 };

  it("is the palette's outer right edge when there is room", () => {
    const spot = chipSpot({ x: 200, y: 400 }, 22, screen);
    expect(spot.y).toBe(400);
    expect(spot.x).toBeGreaterThan(200 + 22);
  });

  it("steps round the rim when the right edge is off-screen", () => {
    // the puck's resting place, against the screen's right side
    const spot = chipSpot({ x: 400 - 38, y: 600 }, 22, screen);
    expect(spot.x + CHIP_RADIUS).toBeLessThanOrEqual(screen.width);
    expect(spot.y).toBeLessThan(600);
  });

  it("stays clear of the host's bars", () => {
    // the puck against the right side, just under a 64px top bar
    const center = { x: 400 - 38, y: 105 };
    const insets = { top: 64, bottom: 0 };
    const spot = chipSpot(center, 22, screen, insets);
    expect(spot.y - CHIP_RADIUS).toBeGreaterThanOrEqual(insets.top);
    expect(spot.x + CHIP_RADIUS).toBeLessThanOrEqual(screen.width);
    // where the bar is not there, it would have gone above the puck
    expect(chipSpot(center, 22, screen).y).toBeLessThan(center.y);
  });
});

describe("putting the equipped tool down", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw radialPalette handleKeyboardGlobally={true} />);
    API.setAppState({ width: 400, height: 800, offsetLeft: 0, offsetTop: 0 });
  });

  afterEach(() => {
    unmountComponent();
  });

  it("shows the equipped tool on the palette's edge", () => {
    expect(chip()).toBeNull();
    act(() => h.app.setActiveTool({ type: "rectangle" }));
    expect(chip()?.dataset.tool).toBe("rectangle");
  });

  it("x puts it down and picks up the hand", () => {
    act(() => h.app.setActiveTool({ type: "rectangle" }));
    Keyboard.keyPress(KEYS.X);
    expect(h.state.activeTool.type).toBe("hand");
    expect(chip()).toBeNull();
  });

  it("x puts the pen down too, so x toggles pen and hand", () => {
    Keyboard.keyPress(KEYS.X);
    expect(h.state.activeTool.type).toBe("freedraw");
    Keyboard.keyPress(KEYS.X);
    expect(h.state.activeTool.type).toBe("hand");
    Keyboard.keyPress(KEYS.X);
    expect(h.state.activeTool.type).toBe("freedraw");
  });

  it("x puts the laser down in view mode", () => {
    API.setAppState({ viewModeEnabled: true });
    act(() => h.app.setActiveTool({ type: "laser" }));
    Keyboard.keyPress(KEYS.X);
    expect(h.state.activeTool.type).toBe("hand");
  });

  it("shift+x still picks the autoshape tool", () => {
    act(() => h.app.setActiveTool({ type: "rectangle" }));
    Keyboard.withModifierKeys({ shift: true }, () => {
      Keyboard.keyPress(KEYS.X);
    });
    expect(h.state.activeTool.type).toBe("autoshape");
  });

  it("a tap on the chip puts it down and picks up the hand", () => {
    act(() => h.app.setActiveTool({ type: "ellipse" }));
    fireEvent.click(chip()!);
    expect(h.state.activeTool.type).toBe("hand");
    expect(chip()).toBeNull();
  });
});
