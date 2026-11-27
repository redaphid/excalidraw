import { vi } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { showHyperlinkTooltip } from "../components/hyperlink/Hyperlink";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, fireEvent, render, waitFor } from "./test-utils";

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

    it("should move the card, not open its link, from a drag that starts 10 CSS px inside its top-right corner", async () => {
      const opened = await renderWithLinkSpy();
      const card = linkedCard();
      atZoom(zoom);
      const corner = onScreen(CARD.x + CARD.width, CARD.y);
      const from = { x: corner.x - 10, y: corner.y + 10 };

      mouse.reset();
      mouse.downAt(from.x, from.y);
      mouse.moveTo(from.x - 100, from.y + 100);
      mouse.upAt(from.x - 100, from.y + 100);

      expect(opened).not.toHaveBeenCalled();
      expect(h.elements.find((e) => e.id === card.id)!.x).toBeCloseTo(
        CARD.x - 100 / zoom,
        0,
      );
    });

    it("should select the card, not open its link, from a tap 10 CSS px inside its top-right corner", async () => {
      const opened = await renderWithLinkSpy();
      const card = linkedCard();
      atZoom(zoom);
      const corner = onScreen(CARD.x + CARD.width, CARD.y);

      tapAt(corner.x - 10, corner.y + 10);

      expect(opened).not.toHaveBeenCalled();
      expect(h.state.selectedElementIds[card.id]).toBe(true);
    });

    it("should aim the link tooltip at the badge", async () => {
      await renderWithLinkSpy();
      const card = linkedCard();
      atZoom(zoom);
      vi.useFakeTimers();

      showHyperlinkTooltip(
        h.app.scene.getNonDeletedElements().find((e) => e.id === card.id)!,
        h.state,
        h.app.scene.getNonDeletedElementsMap(),
      );
      vi.runAllTimers();
      vi.useRealTimers();

      // jsdom gives the tooltip no width, so its left edge is where it aims
      const tooltip = document.querySelector<HTMLDivElement>(
        ".excalidraw-tooltip",
      )!;
      expect(parseFloat(tooltip.style.left)).toBeCloseTo(badgeCentre().x, 0);
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

  it("should open the nearer of two overlapping badges, not the one drawn on top", async () => {
    const opened = await renderWithLinkSpy();
    const make = (box: typeof CARD) =>
      API.createElement({
        type: "rectangle",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        ...box,
      });
    // the tap lands on the canvas, 8 px clear of both cards
    const lowerBox = { x: 230, y: 60, width: 100, height: 30 };
    const lower = make(lowerBox);
    const upper = make(CARD);
    API.setElements([lower, upper]);
    API.updateElement(lower, { link: "https://example.com/lower" });
    API.updateElement(upper, { link: "https://example.com/upper" });
    atZoom(1);
    const near = badgeCentre(lowerBox);
    const far = badgeCentre();
    const apart = Math.hypot(far.x - near.x, far.y - near.y);
    const toward = (d: number) => ({
      x: near.x + ((far.x - near.x) / apart) * d,
      y: near.y + ((far.y - near.y) / apart) * d,
    });

    const tap = toward(18);
    tapAt(tap.x, tap.y);

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(lower.id);
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

  it("should not open a badge that an element drawn over it covers", async () => {
    const opened = await renderWithLinkSpy();
    const lower = API.createElement({
      type: "rectangle",
      backgroundColor: "#e7f5ff",
      fillStyle: "solid",
      ...CARD,
    });
    const cover = API.createElement({
      type: "rectangle",
      backgroundColor: "#e7f5ff",
      fillStyle: "solid",
      x: 300,
      y: 50,
      width: 200,
      height: 200,
    });
    API.setElements([lower, cover]);
    API.updateElement(lower, { link: "https://example.com/lower" });
    atZoom(1);
    const centre = badgeCentre();

    tapAt(centre.x, centre.y);

    expect(opened).not.toHaveBeenCalled();
    expect(h.state.selectedElementIds[cover.id]).toBe(true);
  });

  describe("on a card just above a linked card, near its badge", () => {
    const neighbours = async () => {
      const opened = await renderWithLinkSpy();
      const above = API.createElement({
        type: "rectangle",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        ...CARD,
        y: CARD.y - 160,
      });
      const linked = API.createElement({
        type: "rectangle",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        ...CARD,
      });
      API.setElements([above, linked]);
      API.updateElement(linked, { link: "https://example.com" });
      atZoom(1);
      // 8 px inside the card above's bottom-right corner, 17 px from the badge
      const press = onScreen(CARD.x + CARD.width - 8, CARD.y - 10 - 8);
      return { opened, above, press };
    };

    it("should move that card from a drag", async () => {
      const { opened, above, press } = await neighbours();

      mouse.reset();
      mouse.downAt(press.x, press.y);
      mouse.moveTo(press.x - 100, press.y + 100);
      mouse.upAt(press.x - 100, press.y + 100);

      expect(opened).not.toHaveBeenCalled();
      expect(h.elements.find((e) => e.id === above.id)!.x).toBe(CARD.x - 100);
    });

    it("should select that card from a tap", async () => {
      const { opened, above, press } = await neighbours();

      tapAt(press.x, press.y);

      expect(opened).not.toHaveBeenCalled();
      expect(h.state.selectedElementIds[above.id]).toBe(true);
    });
  });

  it("should open an ellipse's link from a tap 16 CSS px from its badge, on the canvas beside the ellipse", async () => {
    const opened = await renderWithLinkSpy();
    const ellipse = API.createElement({
      type: "ellipse",
      backgroundColor: "#e7f5ff",
      fillStyle: "solid",
      ...CARD,
    });
    API.setElements([ellipse]);
    API.updateElement(ellipse, { link: "https://example.com" });
    atZoom(1);
    const corner = onScreen(CARD.x + CARD.width, CARD.y);

    tapAt(corner.x - 8, corner.y + 8);

    expect(opened).toHaveBeenCalledWith(ellipse.id);
  });

  it("should open the link from a tap on the card 20 CSS px from the badge, in view mode on a phone", async () => {
    const opened = vi.fn();
    await render(
      <Excalidraw
        UIOptions={{ getFormFactor: () => "phone" }}
        onLinkOpen={(element, event) => {
          opened(element.id);
          event.preventDefault();
        }}
      />,
    );
    fireEvent.resize(window);
    await waitFor(() => expect(h.app.editorInterface.formFactor).toBe("phone"));
    const card = linkedCard();
    API.setAppState({ viewModeEnabled: true });
    atZoom(1);
    const corner = onScreen(CARD.x + CARD.width, CARD.y);

    tapAt(corner.x - 10, corner.y + 10);

    expect(opened).toHaveBeenCalledWith(card.id);
  });

  describe("on a card turned an eighth of a turn", () => {
    const eighth = (Math.PI / 4) as Radians;
    const centre = pointFrom<GlobalPoint>(
      CARD.x + CARD.width / 2,
      CARD.y + CARD.height / 2,
    );
    /** A point given in the card's own unturned frame, on screen. */
    const turnedOnScreen = (x: number, y: number) => {
      const [sx, sy] = pointRotateRads(
        pointFrom<GlobalPoint>(x, y),
        centre,
        eighth,
      );
      return onScreen(sx, sy);
    };
    const turned = async () => {
      const opened = await renderWithLinkSpy();
      const card = API.createElement({
        type: "rectangle",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        angle: eighth,
        ...CARD,
      });
      API.setElements([card]);
      API.updateElement(card, { link: "https://example.com" });
      atZoom(1);
      return { opened, card };
    };

    it("should select the card from a tap 11 CSS px inside its turned corner", async () => {
      const { opened, card } = await turned();
      const inside = turnedOnScreen(CARD.x + CARD.width - 11, CARD.y + 11);

      tapAt(inside.x, inside.y);

      expect(opened).not.toHaveBeenCalled();
      expect(h.state.selectedElementIds[card.id]).toBe(true);
    });

    it("should open the link from a tap 20 CSS px out from its turned badge", async () => {
      const { opened, card } = await turned();
      const outside = turnedOnScreen(CARD.x + CARD.width + 4 + 20, CARD.y - 4);

      tapAt(outside.x, outside.y);

      expect(opened).toHaveBeenCalledWith(card.id);
    });
  });

  describe("on a card turned a quarter turn", () => {
    const quarter = (Math.PI / 2) as Radians;
    const turned = async () => {
      const opened = await renderWithLinkSpy();
      const card = API.createElement({
        type: "rectangle",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        angle: quarter,
        ...CARD,
      });
      API.setElements([card]);
      API.updateElement(card, { link: "https://example.com" });
      atZoom(1);
      return { opened, card };
    };

    it("should open the link from a tap on the badge, which turns with the card", async () => {
      const { opened, card } = await turned();
      const [x, y] = pointRotateRads(
        pointFrom<GlobalPoint>(CARD.x + CARD.width + 4, CARD.y - 4),
        pointFrom<GlobalPoint>(
          CARD.x + CARD.width / 2,
          CARD.y + CARD.height / 2,
        ),
        quarter,
      );
      const badge = onScreen(x, y);

      tapAt(badge.x, badge.y);

      expect(opened).toHaveBeenCalledWith(card.id);
    });

    it("should not open the link from a tap where the badge would be if the card were not turned", async () => {
      const { opened } = await turned();
      const unturned = badgeCentre();

      tapAt(unturned.x, unturned.y);

      expect(opened).not.toHaveBeenCalled();
    });
  });

  it("should open a badge that sits on its frame's border", async () => {
    const opened = await renderWithLinkSpy();
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    const box = { x: 100, y: 2, width: 240, height: 150 };
    const card = API.createElement({
      type: "rectangle",
      backgroundColor: "#e7f5ff",
      fillStyle: "solid",
      frameId: frame.id,
      ...box,
    });
    API.setElements([card, frame]);
    API.updateElement(card, { link: "https://example.com" });
    atZoom(1);
    const centre = badgeCentre(box);

    tapAt(centre.x, centre.y);

    expect(opened).toHaveBeenCalledWith(card.id);
  });
});
