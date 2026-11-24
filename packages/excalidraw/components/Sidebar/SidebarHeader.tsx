import clsx from "clsx";
import { useContext } from "react";

import { useEditorInterface } from "../App";
import { Button } from "../Button";
import { Tooltip } from "../Tooltip";
import { CloseIcon, PinIcon } from "../icons";

import { SidebarPropsContext } from "./common";

export const SidebarHeader = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => {
  const editorInterface = useEditorInterface();
  const props = useContext(SidebarPropsContext);

  const renderDockButton = !!(
    editorInterface.canFitSidebar && props.shouldRenderDockButton
  );

  return (
    <div
      className={clsx("sidebar__header", className)}
      data-testid="sidebar-header"
    >
      {children}
      <div className="sidebar__header__buttons">
        {renderDockButton && (
          <Tooltip label={"Keep sidebar open"}>
            <Button
              onSelect={() => props.onDock?.(!props.docked)}
              selected={!!props.docked}
              className="sidebar__dock"
              data-testid="sidebar-dock"
              aria-label={"Keep sidebar open"}
            >
              {PinIcon}
            </Button>
          </Tooltip>
        )}
        <Button
          data-testid="sidebar-close"
          className="sidebar__close"
          onSelect={props.onCloseRequest}
          aria-label={"Close"}
        >
          {CloseIcon}
        </Button>
      </div>
    </div>
  );
};

SidebarHeader.displayName = "SidebarHeader";
