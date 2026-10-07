import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { isElementIntersectingFrame } from "../src/frame";
import { mutateElement } from "../src/mutateElement";

import type { ExcalidrawFrameLikeElement } from "../src/types";

describe("isElementIntersectingFrame", () => {
  const setup = () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    }) as ExcalidrawFrameLikeElement;
    const element = API.createElement({
      type: "rectangle",
      x: 150,
      y: 50,
      width: 100,
      height: 50,
      frameId: frame.id,
    });
    return { frame, element, elementsMap: new Map() };
  };

  it("follows the element as it moves off the frame's edge", () => {
    const { frame, element, elementsMap } = setup();
    expect(isElementIntersectingFrame(element, frame, elementsMap)).toBe(true);
    mutateElement(element, elementsMap, { x: 20 });
    expect(isElementIntersectingFrame(element, frame, elementsMap)).toBe(false);
  });

  it("follows a frame a collaborator replaced at the same version", () => {
    const { frame, element, elementsMap } = setup();
    mutateElement(element, elementsMap, { x: 20 });
    expect(isElementIntersectingFrame(element, frame, elementsMap)).toBe(false);
    const remoteFrame = {
      ...frame,
      width: 60,
      versionNonce: frame.versionNonce + 1,
    };
    expect(isElementIntersectingFrame(element, remoteFrame, elementsMap)).toBe(
      true,
    );
  });

  it("follows the frame as its edge moves", () => {
    const { frame, element, elementsMap } = setup();
    mutateElement(element, elementsMap, { x: 20 });
    expect(isElementIntersectingFrame(element, frame, elementsMap)).toBe(false);
    mutateElement(frame, elementsMap, { width: 60 });
    expect(isElementIntersectingFrame(element, frame, elementsMap)).toBe(true);
  });
});
