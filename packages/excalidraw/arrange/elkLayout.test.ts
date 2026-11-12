import { existsSync } from "fs";
import { fileURLToPath } from "url";

import { elkLayout } from "./elkLayout";

const spawned: URL[] = [];

/** records where it was spawned from, then fails to load, as a 404 would */
class FakeWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: URL | string) {
    super();
    spawned.push(new URL(url));
  }

  postMessage() {
    setTimeout(() =>
      this.dispatchEvent(
        Object.assign(new Event("error"), { message: "not found" }),
      ),
    );
  }

  terminate() {}
}

describe("elkLayout", () => {
  beforeAll(() => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("should spawn the worker from the module that runs ELK, then lay out without it when it fails", async () => {
    const positions = await elkLayout(
      {
        nodes: [
          { id: "a", width: 100, height: 60 },
          { id: "b", width: 100, height: 60 },
        ],
        edges: [{ id: "a-b", source: "a", target: "b" }],
      },
      {
        algorithm: "layered",
        direction: "down",
        spacing: { node: 40, rank: 60 },
      },
    );

    expect(spawned).toHaveLength(1);
    expect(existsSync(fileURLToPath(spawned[0]))).toBe(true);
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("b")).toEqual({ x: 0, y: 120 });
  });
});
