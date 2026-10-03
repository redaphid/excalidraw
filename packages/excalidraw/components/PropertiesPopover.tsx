import { Popover } from "radix-ui";
import clsx from "clsx";
import React, { type ReactNode } from "react";

import { isInteractive } from "@excalidraw/common";

import { useEditorInterface } from "./App";
import { Island } from "./Island";

interface PropertiesPopoverProps {
  className?: string;
  container: HTMLDivElement | null;
  children: ReactNode;
  style?: object;
  onClose: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
  onFocusOutside?: Popover.PopoverContentProps["onFocusOutside"];
  onPointerDownOutside?: Popover.PopoverContentProps["onPointerDownOutside"];
  preventAutoFocusOnTouch?: boolean;
  /** when provided, double-tapping (touch/pen) the same swatch or option
   * inside the popover calls this — meant to close it so the user can get
   * straight back to drawing */
  onDoubleTap?: () => void;
}

const DOUBLE_TAP_MAX_MS = 350;
// label taps synthesize a second click on their input right away — not a tap
const DOUBLE_TAP_MIN_MS = 40;

export const PropertiesPopover = React.forwardRef<
  HTMLDivElement,
  PropertiesPopoverProps
>(
  (
    {
      className,
      container,
      children,
      style,
      onClose,
      onKeyDown,
      onFocusOutside,
      onPointerLeave,
      onPointerDownOutside,
      preventAutoFocusOnTouch = false,
      onDoubleTap,
    },
    ref,
  ) => {
    const editorInterface = useEditorInterface();
    const lastTap = React.useRef<{ target: Element; time: number } | null>(
      null,
    );
    const lastPointerIsTouch = React.useRef(false);
    const isMobilePortrait =
      editorInterface.formFactor === "phone" && !editorInterface.isLandscape;

    return (
      <Popover.Portal container={container}>
        <Popover.Content
          ref={ref}
          className={clsx("focus-visible-none", className)}
          data-prevent-outside-click
          side={isMobilePortrait ? "bottom" : "right"}
          align={isMobilePortrait ? "center" : "start"}
          alignOffset={-16}
          sideOffset={20}
          collisionBoundary={container ?? undefined}
          style={{
            zIndex: "var(--zIndex-ui-styles-popup)",
            marginLeft:
              editorInterface.formFactor === "phone" ? "0.5rem" : undefined,
          }}
          onPointerLeave={onPointerLeave}
          onPointerDownCapture={(event) => {
            lastPointerIsTouch.current = event.pointerType !== "mouse";
          }}
          onClickCapture={
            onDoubleTap
              ? (event) => {
                  const target =
                    event.target instanceof Element
                      ? event.target.closest("button, label")
                      : null;
                  if (!target || !lastPointerIsTouch.current) {
                    lastTap.current = null;
                    return;
                  }
                  const now = Date.now();
                  const prev = lastTap.current;
                  const elapsed = prev ? now - prev.time : Infinity;
                  if (
                    prev &&
                    prev.target === target &&
                    elapsed >= DOUBLE_TAP_MIN_MS &&
                    elapsed <= DOUBLE_TAP_MAX_MS
                  ) {
                    lastTap.current = null;
                    onDoubleTap();
                    return;
                  }
                  // ignore the synthetic input click that follows a label tap
                  if (
                    !prev ||
                    prev.target !== target ||
                    elapsed > DOUBLE_TAP_MIN_MS
                  ) {
                    lastTap.current = { target, time: now };
                  }
                }
              : undefined
          }
          onKeyDown={onKeyDown}
          onFocusOutside={onFocusOutside}
          onPointerDownOutside={onPointerDownOutside}
          onOpenAutoFocus={(e) => {
            // prevent auto-focus on touch devices to avoid keyboard popup
            if (preventAutoFocusOnTouch && editorInterface.isTouchScreen) {
              e.preventDefault();
            }
          }}
          onCloseAutoFocus={(e) => {
            e.stopPropagation();
            // prevents focusing the trigger
            e.preventDefault();

            // return focus to excalidraw container unless
            // user focuses an interactive element, such as a button, or
            // enters the text editor by clicking on canvas with the text tool
            if (container && !isInteractive(document.activeElement)) {
              container.focus();
            }

            onClose();
          }}
        >
          <Island padding={3} style={style}>
            {children}
          </Island>
          <Popover.Arrow
            width={20}
            height={10}
            style={{
              fill: "var(--popup-bg-color)",
              filter: "drop-shadow(rgba(0, 0, 0, 0.05) 0px 3px 2px)",
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    );
  },
);
