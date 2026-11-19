import { vi } from "vitest";

import { Excalidraw, TTDDialog } from "../index";

import { fireEvent, render, waitFor } from "./test-utils";

const mermaid = vi.hoisted(() => ({
  loaded: false,
  parse: vi.fn(async (_definition: string) => {
    throw new Error("parse-error-bewildered-flamingo");
  }),
}));

vi.mock("@excalidraw/mermaid-to-excalidraw", () => {
  mermaid.loaded = true;
  return { parseMermaidToExcalidraw: mermaid.parse };
});

describe("when the editor mounts", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("does not load mermaid-to-excalidraw", () => {
    expect(mermaid.loaded).toBe(false);
  });
});

describe("when text to diagram generates a definition", () => {
  const generated = "flowchart TD\n  bewildered-flamingo --> wandering-heron";

  beforeEach(async () => {
    // jsdom has no scrollIntoView, which the chat calls on every message
    Element.prototype.scrollIntoView = vi.fn();
    await render(
      <Excalidraw
        initialData={{
          appState: { openDialog: { name: "ttd", tab: "text-to-diagram" } },
        }}
      >
        <TTDDialog
          onTextSubmit={async () => ({
            generatedResponse: generated,
            error: null,
          })}
          persistenceAdapter={{
            loadChats: async () => [],
            saveChats: async () => {},
          }}
        />
      </Excalidraw>,
    );
    const input = await waitFor(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        ".chat-interface textarea",
      );
      expect(textarea).not.toBeNull();
      return textarea!;
    });
    fireEvent.change(input, { target: { value: "draw a flamingo flow" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mermaid.parse).toHaveBeenCalled());
  });

  it("validates it with the lazily loaded parser", () => {
    expect(mermaid.parse).toHaveBeenCalledWith(generated);
  });
});
