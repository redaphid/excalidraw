import { vi } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { NormalizedZoomValue } from "../types";
import type { ExcalidrawProps } from "../types";

const h = window.h;
const mouse = new Pointer("mouse");

const CARD = { x: 100, y: 100, width: 240, height: 150 };

const renderWithLinkSpy = async () => {
  const opened = vi.fn();
  const onLinkOpen: NonNullable<ExcalidrawProps["onLinkOpen"]> = (
    element,
    event,
  ) => {
    opened(element.id);
    event.preventDefault();
  };
  await render(<Excalidraw onLinkOpen={onLinkOpen} />);
  return opened;
};

const linkedCard = (box = CARD) => {
  const card = API.createElement({
    type: "rectangle",
    backgroundColor: "#e7f5ff",
    fillStyle: "solid",
    ...box,
  });
  API.setElements([card]);
  API.updateElement(card, { link: "https://example.com" });
  return card;
};

const atZoom = (zoom: number) =>
  act(() => {
    h.setState({
      zoom: { value: zoom as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    });
  });

/** Where a scene point is on screen, in CSS px. */
const onScreen = (sceneX: number, sceneY: number) =>
  sceneCoordsToViewportCoords({ sceneX, sceneY }, h.state);

/** The badge's centre on screen: 4 CSS px out from the element's top-right corner. */
const badgeCentre = (box = CARD) => {
  const corner = onScreen(box.x + box.width, box.y);
  return { x: corner.x + 4, y: corner.y - 4 };
};

const tapAt = (x: number, y: number) => {
  mouse.moveTo(x, y);
  mouse.clickAt(x, y);
};

describe("the link badge", () => {
  describe.each([0.43, 1, 2])("at %s zoom", (zoom) => {
    it.each([
      ["right", 20, 0],
      ["up", 0, -20],
      ["up and right", 14, -14],
    ])(
      "should open the link from a tap 20 CSS px %s of the badge",
      async (_, dx, dy) => {
        const opened = await renderWithLinkSpy();
        const card = linkedCard();
        atZoom(zoom);
        const centre = badgeCentre();

        tapAt(centre.x + dx, centre.y + dy);

        expect(opened).toHaveBeenCalledWith(card.id);
      },
    );

    it("should not open the link from a tap 30 CSS px right of the badge", async () => {
      const opened = await renderWithLinkSpy();
      linkedCard();
      atZoom(zoom);
      const centre = badgeCentre();

      tapAt(centre.x + 30, centre.y);

      expect(opened).not.toHaveBeenCalled();
    });

    it("should select the card, not open its link, from a tap on its body", async () => {
      const opened = await renderWithLinkSpy();
      const card = linkedCard();
      atZoom(zoom);
      const body = onScreen(CARD.x + CARD.width / 2, CARD.y + CARD.height / 2);

      tapAt(body.x, body.y);

      expect(opened).not.toHaveBeenCalled();
      expect(h.state.selectedElementIds[card.id]).toBe(true);
    });
  });

  it("should leave a card smaller than 64 CSS px its own taps", async () => {
    const opened = await renderWithLinkSpy();
    const small = { x: 100, y: 100, width: 40, height: 30 };
    const card = linkedCard(small);
    atZoom(1);
    const centre = badgeCentre(small);

    tapAt(centre.x - 12, centre.y + 12);

    expect(opened).not.toHaveBeenCalled();
    expect(h.state.selectedElementIds[card.id]).toBe(true);
  });
});
