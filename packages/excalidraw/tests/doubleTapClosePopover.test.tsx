import { Excalidraw } from "../index";

import { fireEvent, render, waitFor } from "./test-utils";

import { API } from "./helpers/api";

const tap = (el: Element, pointerType: "touch" | "mouse") => {
  fireEvent.pointerDown(el, { pointerType });
  fireEvent.pointerUp(el, { pointerType });
  fireEvent.click(el);
};

// radix popper measures its content
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("double-tap closes the color popup", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    API.setAppState({ openPopup: "elementBackground" });
    await waitFor(() =>
      expect(window.h.state.openPopup).toBe("elementBackground"),
    );
  });

  it("closes after two quick touch taps on a swatch", async () => {
    const swatch = document.querySelector(
      "[data-testid='color-red']",
    ) as HTMLElement;
    tap(swatch, "touch");
    expect(window.h.state.openPopup).toBe("elementBackground");
    await new Promise((r) => setTimeout(r, 80));
    tap(swatch, "touch");
    await waitFor(() => expect(window.h.state.openPopup).toBe(null));
  });

  it("stays open after a single touch tap", () => {
    const swatch = document.querySelector(
      "[data-testid='color-red']",
    ) as HTMLElement;
    tap(swatch, "touch");
    expect(window.h.state.openPopup).toBe("elementBackground");
  });

  it("ignores double clicks with a mouse", async () => {
    const swatch = document.querySelector(
      "[data-testid='color-red']",
    ) as HTMLElement;
    tap(swatch, "mouse");
    await new Promise((r) => setTimeout(r, 80));
    tap(swatch, "mouse");
    expect(window.h.state.openPopup).toBe("elementBackground");
  });

  it("ignores taps on two different swatches", async () => {
    const a = document.querySelector(
      "[data-testid='color-red']",
    ) as HTMLElement;
    const b = document.querySelector(
      "[data-testid='color-blue']",
    ) as HTMLElement;
    tap(a, "touch");
    await new Promise((r) => setTimeout(r, 80));
    tap(b, "touch");
    expect(window.h.state.openPopup).toBe("elementBackground");
  });
});
