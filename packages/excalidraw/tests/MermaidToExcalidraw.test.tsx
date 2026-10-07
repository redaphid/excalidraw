import { expect, vi } from "vitest";

import { EDITOR_LS_KEYS } from "@excalidraw/common";

import { EditorLocalStorage } from "../data/EditorLocalStorage";
import { Excalidraw } from "../index";

import { mockMermaidToExcalidraw } from "./helpers/mocks";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { render, waitFor } from "./test-utils";

// Mock CodeMirror deps so the dynamic import of CodeMirrorEditor fails,
// causing TTDDialogInput to fall back to <textarea> in tests.
vi.mock("@codemirror/view", () => ({}));
vi.mock("@codemirror/state", () => ({}));
vi.mock("@codemirror/language", () => ({}));
vi.mock("@lezer/highlight", () => ({}));

mockMermaidToExcalidraw({
  mockRef: true,
  parseMermaidToExcalidraw: async (definition) => {
    const firstLine = definition.split("\n")[0];
    return new Promise((resolve, reject) => {
      if (firstLine === "flowchart TD") {
        resolve({
          elements: [
            {
              id: "Start",
              type: "rectangle",
              groupIds: [],
              x: 0,
              y: 0,
              width: 69.703125,
              height: 44,
              strokeWidth: 2,
              label: {
                groupIds: [],
                text: "Start",
                fontSize: 20,
              },
              link: null,
            },
            {
              id: "Stop",
              type: "rectangle",
              groupIds: [],
              x: 2.7109375,
              y: 94,
              width: 64.28125,
              height: 44,
              strokeWidth: 2,
              label: {
                groupIds: [],
                text: "Stop",
                fontSize: 20,
              },
              link: null,
            },
            {
              id: "Start_Stop",
              type: "arrow",
              groupIds: [],
              x: 34.852,
              y: 44,
              strokeWidth: 2,
              points: [
                [0, 0],
                [0, 50],
              ],
              roundness: {
                type: 2,
              },
              start: {
                id: "Start",
              },
              end: {
                id: "Stop",
              },
            },
          ],
        });
      } else {
        reject(new Error("ERROR"));
      }
    });
  },
});

const normalizeDialogSnapshot = (dialog: Element) => {
  const dialogClone = dialog.cloneNode(true) as HTMLElement;

  dialogClone
    .querySelectorAll<HTMLElement>(".ttd-dialog-content")
    .forEach((element) => {
      // Radix Tabs injects this during initial mount animation prevention.
      // Its presence depends on render timing and is unrelated to this test.
      if (element.style.animationDuration === "0s") {
        element.style.removeProperty("animation-duration");
      }

      if (!element.getAttribute("style")) {
        element.removeAttribute("style");
      }
    });

  return dialogClone.outerHTML;
};

const OUTPUT_ERROR = '[data-testid="ttd-dialog-output-error"]';

// The dialog saves its definition and reopens on it, so one test's
// definition would otherwise become the next test's starting text.
beforeEach(() => {
  EditorLocalStorage.delete(EDITOR_LS_KEYS.MERMAID_TO_EXCALIDRAW);
});

describe("Opening the mermaid dialog", () => {
  it("shows no error for a valid definition while the library loads", async () => {
    const errorsShown: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const { addedNodes } of records) {
        addedNodes.forEach((node) => {
          const error =
            node instanceof Element &&
            (node.matches(OUTPUT_ERROR)
              ? node
              : node.querySelector(OUTPUT_ERROR));
          if (error) {
            errorsShown.push(error.textContent ?? "");
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    await render(
      <Excalidraw
        initialData={{
          appState: {
            openDialog: { name: "ttd", tab: "mermaid" },
          },
        }}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".ttd-dialog canvas")).not.toBeNull(),
    );
    observer.disconnect();

    expect(errorsShown).toEqual([]);
  });
});

describe("Test <MermaidToExcalidraw/>", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        initialData={{
          appState: {
            openDialog: { name: "ttd", tab: "mermaid" },
          },
        }}
      />,
    );
  });

  it("should open mermaid popup when active tool is mermaid", async () => {
    const dialog = document.querySelector(".ttd-dialog")!;
    await waitFor(() => {
      expect(dialog.querySelector("canvas")).not.toBeNull();
      expect(dialog.querySelector("textarea")).not.toBeNull();
    });
    expect(normalizeDialogSnapshot(dialog)).toMatchSnapshot();
  });

  it("should show error in preview when mermaid library throws error", async () => {
    const dialog = document.querySelector(".ttd-dialog")!;

    expect(dialog).not.toBeNull();

    const selector = ".ttd-dialog-input";
    let editor = await getTextEditor({ selector, waitForEditor: true });

    expect(dialog.querySelector('[data-testid="mermaid-error"]')).toBeNull();

    expect(editor.textContent).toMatchSnapshot();

    updateTextEditor(editor, "flowchart TD1");
    editor = await getTextEditor({ selector, waitForEditor: false });

    expect(editor.textContent).toBe("flowchart TD1");
    expect(
      dialog.querySelector('[data-testid="mermaid-error"]'),
    ).toMatchInlineSnapshot("null");
  });
});
