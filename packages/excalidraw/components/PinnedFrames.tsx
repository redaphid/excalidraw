import React, { useEffect, useRef } from "react";

import { THEME } from "@excalidraw/common";
import { getFrameChildren, isFrameLikeElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { exportToSvg } from "../scene/export";

import {
  cameraToDropPin,
  movePin,
  pinnedBox,
  withoutPin,
} from "../pinnedFrames";

import { useExcalidrawSetAppState } from "./App";

import "./PinnedFrames.scss";

import type { FramePin, FramePins } from "../pinnedFrames";
import type { AppState, BinaryFiles, NormalizedZoomValue } from "../types";

/** two taps this close in time and place put the frame back on the board */
const TWO_TAPS_MS = 350;
const TWO_TAPS_PX = 24;
/** a press that moves this far drags the pin instead of tapping it */
const DRAG_PX = 6;

type Props = {
  pins: FramePins;
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  editor: { width: number; height: number };
  viewBackgroundColor: string;
  theme: AppState["theme"];
};

/** the frames this viewer pinned to the screen (#240), drawn over the board */
export const PinnedFrames = ({ pins, elements, ...rest }: Props) => {
  const ids = Object.keys(pins);
  if (ids.length === 0) {
    return null;
  }
  return (
    <>
      {ids.map((id) => {
        const frame = elements.find(
          (el): el is NonDeleted<ExcalidrawFrameLikeElement> =>
            el.id === id && !el.isDeleted && isFrameLikeElement(el),
        );
        return frame ? (
          <PinnedFrame
            key={id}
            frame={frame}
            pin={pins[id]}
            elements={elements}
            {...rest}
          />
        ) : null;
      })}
    </>
  );
};

const PinnedFrame = ({
  frame,
  pin,
  elements,
  files,
  editor,
  viewBackgroundColor,
  theme,
}: Omit<Props, "pins"> & {
  frame: NonDeleted<ExcalidrawFrameLikeElement>;
  pin: FramePin;
}) => {
  const setAppState = useExcalidrawSetAppState();
  const drawing = useRef<HTMLDivElement>(null);

  const contents = getFrameChildren(elements, frame.id).filter(
    (el): el is NonDeletedExcalidrawElement => !el.isDeleted,
  );
  // redraw when the frame or anything in it changes
  const version = [frame, ...contents]
    .map((el) => `${el.id}:${el.version}`)
    .join(",");

  const latest = useRef({ frame, contents, files });
  latest.current = { frame, contents, files };

  useEffect(() => {
    let gone = false;
    const { frame, contents, files } = latest.current;
    exportToSvg(
      [frame, ...contents],
      {
        exportBackground: true,
        exportPadding: 0,
        viewBackgroundColor,
        exportWithDarkMode: theme === THEME.DARK,
      },
      files,
      { exportingFrame: frame, skipInliningFonts: true, reuseImages: true },
    ).then(
      (svg) => {
        if (!gone && drawing.current) {
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
          drawing.current.replaceChildren(svg);
        }
      },
      () => {
        // nothing to draw: the frame keeps its outline
      },
    );
    return () => {
      gone = true;
    };
  }, [version, viewBackgroundColor, theme]);

  const press = useRef<{
    pointerId: number;
    x: number;
    y: number;
    pin: FramePin;
    dragging: boolean;
  } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  const setPin = (next: FramePin) =>
    setAppState((state) => ({
      pinnedFrames: { ...state.pinnedFrames, [frame.id]: next },
    }));

  const dropOnBoard = () => {
    const camera = cameraToDropPin(pin, frame);
    setAppState((state) => ({
      pinnedFrames: withoutPin(state.pinnedFrames, frame.id),
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: { value: camera.zoom.value as NormalizedZoomValue },
      selectedElementIds: { [frame.id]: true },
      selectedGroupIds: {},
    }));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (press.current) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // not every pointer can be captured; the press still works
    }
    press.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pin,
      dragging: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = press.current;
    if (!held || held.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (!held.dragging && Math.hypot(dx, dy) < DRAG_PX) {
      return;
    }
    held.dragging = true;
    setPin(movePin(held.pin, frame, { dx, dy }, editor));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = press.current;
    if (!held || held.pointerId !== event.pointerId) {
      return;
    }
    press.current = null;
    if (held.dragging) {
      lastTap.current = null;
      return;
    }
    const now = Date.now();
    const before = lastTap.current;
    if (
      before &&
      now - before.at <= TWO_TAPS_MS &&
      Math.hypot(event.clientX - before.x, event.clientY - before.y) <=
        TWO_TAPS_PX
    ) {
      lastTap.current = null;
      dropOnBoard();
      return;
    }
    lastTap.current = { at: now, x: event.clientX, y: event.clientY };
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === event.pointerId) {
      press.current = null;
    }
  };

  const box = pinnedBox(pin, frame);

  return (
    <div
      className="PinnedFrame"
      data-frame-id={frame.id}
      role="img"
      aria-label={frame.name ?? "Pinned frame"}
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="PinnedFrame__drawing" ref={drawing} />
      <span className="PinnedFrame__pin" aria-hidden="true" />
    </div>
  );
};
