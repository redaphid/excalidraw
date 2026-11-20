import { vi } from "vitest";

import { KEYS } from "@excalidraw/common";

import { createPasteEvent } from "../clipboard";
import { Excalidraw } from "../index";

import { Keyboard } from "./helpers/ui";
import { GlobalTestState, render, waitFor } from "./test-utils";

const { h } = window;

vi.mock("@excalidraw/mermaid-to-excalidraw", () => {
  throw new Error("load-error-sleepy-otter");
});

describe("when a pasted Mermaid definition cannot load Mermaid", () => {
  beforeEach(async () => {
    await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
    Object.assign(document, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.V);
      document.dispatchEvent(
        createPasteEvent({ types: { "text/plain": "flowchart TD\nA" } }),
      );
    });
  });

  it("pastes it as text", async () => {
    await waitFor(() =>
      expect(h.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text", text: "flowchart TD" }),
          expect.objectContaining({ type: "text", text: "A" }),
        ]),
      ),
    );
  });
});
