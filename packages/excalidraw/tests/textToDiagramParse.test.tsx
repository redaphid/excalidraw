import { vi } from "vitest";

import { Excalidraw, TTDDialog } from "../index";

import { fireEvent, render, waitFor } from "./test-utils";

const parse = vi.hoisted(() =>
  vi.fn(async (_definition: string) => {
    throw new Error("parse-error-bewildered-flamingo");
  }),
);

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: parse,
}));

/** Opens text to diagram, whose model answers `generated`, and sends a prompt. */
const generateDiagram = async (generated: string) => {
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
};

/** The error the last assistant message shows, once it shows one. */
const assistantError = () =>
  waitFor(() => {
    const error = document.querySelector(".chat-message__error_message");
    expect(error).not.toBeNull();
    return error!;
  });

describe("when text to diagram generates a definition Mermaid cannot parse", () => {
  const generated = "flowchart TD\n  bewildered-flamingo --> wandering-heron";
  let error: Element;

  beforeEach(async () => {
    await generateDiagram(generated);
    error = await assistantError();
  });

  it("validates it with the lazily loaded parser", () => {
    expect(parse).toHaveBeenCalledWith(generated);
  });

  it("offers to repair the diagram", () => {
    expect(error.querySelector(".chat-message__error-actions")).not.toBeNull();
  });
});
