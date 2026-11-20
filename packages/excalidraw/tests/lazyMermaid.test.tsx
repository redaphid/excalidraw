import { vi } from "vitest";

import { Excalidraw } from "../index";

import { render } from "./test-utils";

const mermaid = vi.hoisted(() => ({ loaded: false }));

vi.mock("@excalidraw/mermaid-to-excalidraw", () => {
  mermaid.loaded = true;
  return { parseMermaidToExcalidraw: vi.fn() };
});

describe("when the editor mounts", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("does not load mermaid-to-excalidraw", () => {
    expect(mermaid.loaded).toBe(false);
  });
});
