import React from "react";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { CLASSES } from "@excalidraw/common";

import DropdownMenuContent from "./DropdownMenuContent";
import DropdownMenuGroup from "./DropdownMenuGroup";
import DropdownMenuItem from "./DropdownMenuItem";
import DropdownMenuItemCustom from "./DropdownMenuItemCustom";
import DropdownMenuItemLink from "./DropdownMenuItemLink";
import MenuSeparator from "./DropdownMenuSeparator";
import DropdownMenuSub from "./DropdownMenuSub";
import DropdownMenuTrigger from "./DropdownMenuTrigger";
import DropdownMenuItemCheckbox from "./DropdownMenuItemCheckbox";
import {
  getMenuContentComponent,
  getMenuTriggerComponent,
} from "./dropdownMenuUtils";

import "./DropdownMenu.scss";

const DropdownMenu = ({
  children,
  open,
  anchor,
}: {
  children?: React.ReactNode;
  open: boolean;
  /** a viewport point the content opens at, for a menu with no trigger */
  anchor?: { x: number; y: number };
}) => {
  const MenuTriggerComp = getMenuTriggerComponent(children);
  const MenuContentComp = getMenuContentComponent(children);
  const MenuContentWithState =
    MenuContentComp && React.isValidElement(MenuContentComp)
      ? React.cloneElement(
          MenuContentComp as React.ReactElement<
            React.ComponentProps<typeof DropdownMenuContent>
          >,
          { open },
        )
      : MenuContentComp;

  return (
    <DropdownMenuPrimitive.Root open={open} modal={false}>
      <div
        className={CLASSES.DROPDOWN_MENU_EVENT_WRAPPER}
        style={{
          // remove this div from box layout
          display: "contents",
        }}
      >
        {anchor && (
          <DropdownMenuPrimitive.Trigger asChild>
            <span
              aria-hidden
              className="dropdown-menu-anchor"
              style={{
                position: "fixed",
                left: anchor.x,
                top: anchor.y,
                width: 0,
                height: 0,
                pointerEvents: "none",
              }}
            />
          </DropdownMenuPrimitive.Trigger>
        )}
        {MenuTriggerComp}
        {MenuContentWithState}
      </div>
    </DropdownMenuPrimitive.Root>
  );
};

DropdownMenu.Trigger = DropdownMenuTrigger;
DropdownMenu.Content = DropdownMenuContent;
DropdownMenu.Item = DropdownMenuItem;
DropdownMenu.ItemCheckbox = DropdownMenuItemCheckbox;
DropdownMenu.ItemLink = DropdownMenuItemLink;
DropdownMenu.ItemCustom = DropdownMenuItemCustom;
DropdownMenu.Group = DropdownMenuGroup;
DropdownMenu.Separator = MenuSeparator;
DropdownMenu.Sub = DropdownMenuSub;

export default DropdownMenu;

DropdownMenu.displayName = "DropdownMenu";
