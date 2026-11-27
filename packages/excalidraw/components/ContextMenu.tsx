import clsx from "clsx";
import React, { useEffect } from "react";

import { KEYS } from "@excalidraw/common";

import { getShortcutFromShortcutName } from "../actions/shortcuts";
import { t } from "../i18n";

import { useExcalidrawAppState, useExcalidrawElements } from "./App";

import { Popover } from "./Popover";

import "./ContextMenu.scss";

import type { ActionManager } from "../actions/manager";
import type { ShortcutName } from "../actions/shortcuts";
import type { Action } from "../actions/types";

import type { TranslationKeys } from "../i18n";

/** actions offered side by side as icon buttons, one tap each, which keeps
 * a long menu short enough for a phone */
export type ContextMenuRow = Readonly<{
  row: string;
  actions: readonly Action[];
}>;

export type ContextMenuItem =
  | typeof CONTEXT_MENU_SEPARATOR
  | Action
  | ContextMenuRow;

export type ContextMenuItems = (ContextMenuItem | false | null | undefined)[];

type ContextMenuProps = {
  actionManager: ActionManager;
  items: ContextMenuItems;
  top: number;
  left: number;
  onClose: (callback?: () => void) => void;
};

export const CONTEXT_MENU_SEPARATOR = "separator";

export const ContextMenu = React.memo(
  ({ actionManager, items, top, left, onClose }: ContextMenuProps) => {
    const appState = useExcalidrawAppState();
    const elements = useExcalidrawElements();

    // Escape closes the menu, as it closes the radial palette, before the
    // editor sees it: the menu holds the focus, and the editor's Escape would
    // otherwise act behind it (deselect) and leave the menu open
    const ownerDocument = actionManager.app.ownerDocument;
    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== KEYS.ESCAPE) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      };
      ownerDocument.addEventListener("keydown", onKeyDown, { capture: true });
      return () =>
        ownerDocument.removeEventListener("keydown", onKeyDown, {
          capture: true,
        });
    }, [ownerDocument, onClose]);

    const offered = (action: Action) =>
      !action.predicate ||
      action.predicate(
        elements,
        appState,
        actionManager.app.props,
        actionManager.app,
      );

    const labelOf = (action: Action) => {
      if (!action.label) {
        return "";
      }
      return t(
        (typeof action.label === "function"
          ? action.label(elements, appState, actionManager.app)
          : action.label) as unknown as TranslationKeys,
      );
    };

    const run = (action: Action) =>
      // we need update state before executing the action in case
      // the action uses the appState it's being passed (that still
      // contains a defined contextMenu) to return the next state.
      onClose(() => {
        actionManager.executeAction(action, "contextMenu");
      });

    const filteredItems = items.reduce((acc: ContextMenuItem[], item) => {
      if (!item) {
        return acc;
      }
      if (item === CONTEXT_MENU_SEPARATOR) {
        acc.push(item);
      } else if ("row" in item) {
        const actions = item.actions.filter(offered);
        if (actions.length) {
          acc.push({ ...item, actions });
        }
      } else if (offered(item)) {
        acc.push(item);
      }
      return acc;
    }, []);

    return (
      <Popover
        onCloseRequest={() => {
          onClose();
        }}
        top={top}
        left={left}
        fitInViewport={true}
        viewportWidth={appState.width}
        viewportHeight={appState.height}
        className="context-menu-popover"
      >
        <ul
          className="context-menu"
          onContextMenu={(event) => event.preventDefault()}
        >
          {filteredItems.map((item, idx) => {
            if (item === CONTEXT_MENU_SEPARATOR) {
              if (
                !filteredItems[idx - 1] ||
                filteredItems[idx - 1] === CONTEXT_MENU_SEPARATOR
              ) {
                return null;
              }
              return <hr key={idx} className="context-menu-item-separator" />;
            }

            if ("row" in item) {
              return (
                <li key={idx} className="context-menu-row">
                  {item.actions.map((action) => {
                    const label = labelOf(action);
                    return (
                      <button
                        key={action.name}
                        type="button"
                        data-testid={action.name}
                        aria-label={label}
                        title={label}
                        className="context-menu-row__button"
                        onClick={() => run(action)}
                      >
                        {typeof action.icon === "function"
                          ? action.icon(appState, elements)
                          : action.icon}
                      </button>
                    );
                  })}
                </li>
              );
            }

            const actionName = item.name;
            const label = labelOf(item);

            return (
              <li key={idx} data-testid={actionName} onClick={() => run(item)}>
                <button
                  type="button"
                  className={clsx("context-menu-item", {
                    dangerous: actionName === "deleteSelectedElements",
                    checkmark: item.checked?.(appState),
                  })}
                >
                  <div className="context-menu-item__label">{label}</div>
                  <kbd className="context-menu-item__shortcut">
                    {actionName
                      ? getShortcutFromShortcutName(actionName as ShortcutName)
                      : ""}
                  </kbd>
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    );
  },
);
