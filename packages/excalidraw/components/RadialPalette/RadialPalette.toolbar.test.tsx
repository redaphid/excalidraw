import { queryByTestId, waitFor, fireEvent } from "@testing-library/react";

import { Excalidraw } from "../../index";
import { render } from "../../tests/test-utils";

import type { RadialPaletteOptions } from "../../types";

const { h } = window;

/** the phone toolbar's buttons whose tools the ring offers */
const ON_THE_RING = ["freedraw", "eraser", "rectangle", "arrow"];

/** the phone toolbar's buttons the ring has no tool for */
const OFF_THE_RING = ["hand", "selection"];

const shows = (type: string) =>
  !!queryByTestId(document.body, `toolbar-${type}`);

const mount = async (
  radialPalette: boolean | RadialPaletteOptions,
  formFactor: "phone" | "desktop",
) => {
  await render(
    <Excalidraw
      radialPalette={radialPalette}
      UIOptions={{ getFormFactor: () => formFactor }}
    />,
  );
  fireEvent.resize(window);
  await waitFor(() =>
    expect(h.app.editorInterface.formFactor).toBe(formFactor),
  );
};

describe("the radial palette in place of the toolbar", () => {
  describe("when a phone's host asks for it", () => {
    beforeEach(async () => {
      await mount({ replaceToolbar: true }, "phone");
    });

    it.each(ON_THE_RING)("leaves %s to the ring", (type) => {
      expect(shows(type)).toBe(false);
    });

    it.each(OFF_THE_RING)("keeps %s, which the ring lacks", (type) => {
      expect(shows(type)).toBe(true);
    });

    it("keeps the puck", () => {
      expect(
        queryByTestId(document.body, "radial-palette-puck"),
      ).not.toBeNull();
    });
  });

  describe("when a phone's host only turns the palette on", () => {
    beforeEach(async () => {
      await mount(true, "phone");
    });

    it.each(ON_THE_RING)("keeps %s in the toolbar", (type) => {
      expect(shows(type)).toBe(true);
    });
  });

  describe("when the host asks for it on a desktop", () => {
    beforeEach(async () => {
      await mount({ replaceToolbar: true }, "desktop");
    });

    it.each(["freedraw", "eraser", "rectangle", "arrow"])(
      "keeps %s in the toolbar",
      (type) => {
        expect(shows(type)).toBe(true);
      },
    );
  });
});
