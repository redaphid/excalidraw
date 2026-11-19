import { vi } from "vitest";

import { t } from "../i18n";

import { Excalidraw, TTDDialog } from "../index";

import { fireEvent, render, waitFor } from "./test-utils";

vi.mock("@excalidraw/mermaid-to-excalidraw", () => {
  throw new Error("load-error-sleepy-otter");
});

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

describe("when text to diagram cannot load Mermaid", () => {
  let error: Element;

  beforeEach(async () => {
    await generateDiagram("flowchart TD\n  sleepy-otter --> wandering-heron");
    error = await assistantError();
  });

  it("offers a retry", () => {
    expect(
      document.querySelector(
        `.chat-message__action[title="${t("chat.retry")}"]`,
      ),
    ).not.toBeNull();
  });

  it("does not offer to repair a definition it never parsed", () => {
    expect(error.querySelector(".chat-message__error-actions")).toBeNull();
  });
});
