// Arranges a board from disk again and again and reports how many elements
// each pass moved, by id count only. Skipped unless ARRANGE_BOARD names an
// .excalidraw file, so no board's content lives in the repo:
//   ARRANGE_BOARD=/path/to/board.excalidraw yarn vitest run arrangeBoard
import { readFileSync } from "fs";

import React from "react";

import { CaptureUpdateAction, isFrameLikeElement } from "@excalidraw/element";

import type { ArrangeOutcome } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

const { h } = window;

const BOARD = process.env.ARRANGE_BOARD;
const PASSES = Number(process.env.ARRANGE_PASSES ?? 3);

/** pairs of frames that overlap without one holding the other */
const partlyOverlappingFrames = () => {
  const frames = h.elements.filter(
    (element) => !element.isDeleted && isFrameLikeElement(element),
  );
  const holds = (a: ExcalidrawElement, b: ExcalidrawElement) =>
    b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.width <= a.x + a.width &&
    b.y + b.height <= a.y + a.height;
  return frames.flatMap((a, i) =>
    frames
      .slice(i + 1)
      .filter(
        (b) =>
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height &&
          !holds(a, b) &&
          !holds(b, a),
      ),
  ).length;
};

const geometry = () =>
  new Map(
    h.elements.map(({ id, x, y, width, height }) => [
      id,
      `${x},${y},${width},${height}`,
    ]),
  );

(BOARD ? describe : describe.skip)(
  "arranging a board from ARRANGE_BOARD",
  () => {
    it("should move nothing after the first arrange", async () => {
      await render(<Excalidraw />);
      const { elements } = JSON.parse(readFileSync(BOARD!, "utf8"));
      API.updateScene({
        elements: restoreElements(elements, null, { repairBindings: true }),
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      console.info(
        `before: ${partlyOverlappingFrames()} partly overlapping frame pairs`,
      );
      const moved: number[] = [];
      for (let pass = 1; pass <= PASSES; pass++) {
        const before = geometry();
        const started = performance.now();
        let outcome: ArrangeOutcome | undefined;
        await act(async () => {
          outcome = await h.app.api.arrange();
        });
        const changed = [...geometry()].filter(
          ([id, now]) => before.get(id) !== now,
        ).length;
        const movedIds =
          outcome?.status === "arranged" ? outcome.movedIds.length : 0;
        moved.push(changed);
        console.info(
          `pass ${pass}: ${
            outcome?.status
          }, moved ${movedIds}, changed ${changed}, ${Math.round(
            performance.now() - started,
          )} ms, ${partlyOverlappingFrames()} partly overlapping frame pairs`,
        );
      }

      expect(moved.slice(1)).toEqual(moved.slice(1).map(() => 0));
    }, 900_000);
  },
);
