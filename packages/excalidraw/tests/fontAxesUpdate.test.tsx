import { FONT_FAMILY } from "@excalidraw/common";
import { newElementWith, newTextElement } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render, waitFor } from "./test-utils";

const { h } = window;

describe("a text whose font instance arrives through updateScene", () => {
  const loaded = [{ family: "face-id-loaded-lantern" } as FontFace];
  let text: ExcalidrawTextElement;
  let onLoaded: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await render(<Excalidraw />);
    text = newTextElement({
      text: "merged",
      x: 0,
      y: 0,
      fontFamily: FONT_FAMILY["Shantell Sans"],
      fontAxes: { wght: 300 },
    });
    API.setElements([text]);
    // whatever that load started settles before anything is watched
    await new Promise((resolve) => setTimeout(resolve, 0));
    onLoaded = vi.spyOn(h.app.fonts, "onLoaded");
    vi.mocked(document.fonts.load).mockResolvedValue(loaded);
    // as a browser answers for faces it has not loaded yet
    vi.mocked(document.fonts.check).mockReturnValue(false);
    vi.mocked(document.fonts.add).mockClear();
  });

  afterEach(() => {
    vi.mocked(document.fonts.load).mockResolvedValue([]);
    vi.mocked(document.fonts.check).mockResolvedValue(true);
  });

  describe("when the scene changes its wght", () => {
    beforeEach(async () => {
      act(() =>
        h.app.updateScene({
          elements: [newElementWith(text, { fontAxes: { wght: 800 } })],
        }),
      );
      await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    });

    it("adds the faces of the new instance to the document", () => {
      expect(
        vi.mocked(document.fonts.add).mock.calls.map(([face]) => face.family),
      ).toContain("Shantell Sans wght800");
    });

    it("redraws text with the faces that loaded, since WebKit fires no loadingdone", () => {
      expect(onLoaded).toHaveBeenCalledWith(expect.arrayContaining(loaded));
    });
  });

  describe("when the scene hands it back unchanged", () => {
    beforeEach(async () => {
      act(() => h.app.updateScene({ elements: [text] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it("loads nothing", () => {
      expect(onLoaded).not.toHaveBeenCalled();
    });
  });
});
