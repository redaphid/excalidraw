import React from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { useTunnels } from "../context/tunnels";
import { getScrollToContentState } from "../scene";

import { ExitViewModeButton } from "./Actions";
import { FixedSideContainer } from "./FixedSideContainer";
import { FrameBreadcrumb } from "./FrameBreadcrumb";

import { Toast } from "./Toast";
import { ViewportStatusBadge } from "./ViewportStatusFrame/ViewportStatusFrame";

import type { ActionManager } from "../actions/manager";
import type { AppClassProperties, AppState, UIAppState } from "../types";
import type { JSX } from "react";

type MobileMenuProps = {
  appState: UIAppState;
  actionManager: ActionManager;
  renderJSONExportDialog: () => React.ReactNode;
  renderImageExportDialog: () => React.ReactNode;
  setAppState: React.Component<any, AppState>["setState"];
  elements: readonly NonDeletedExcalidrawElement[];

  renderTopRightUI?: (
    isMobile: boolean,
    appState: UIAppState,
  ) => JSX.Element | null;
  renderSidebars: () => JSX.Element | null;
  renderWelcomeScreen: boolean;
  defaultUIEnabled: boolean;
  scrollBackToContentUIEnabled: boolean;
  app: AppClassProperties;
};

export const MobileMenu = ({
  appState,
  elements,
  actionManager,
  setAppState,
  renderTopRightUI,
  renderSidebars,
  renderWelcomeScreen,
  defaultUIEnabled,
  scrollBackToContentUIEnabled,
  app,
}: MobileMenuProps) => {
  const {
    WelcomeScreenCenterTunnel,
    MainMenuTunnel,
    DefaultSidebarTriggerTunnel,
  } = useTunnels();
  const renderAppTopBar = () => {
    if (appState.openDialog?.name === "elementLinkSelector") {
      return null;
    }

    const topRightUI = (
      <div className="excalidraw-ui-top-right">
        {renderTopRightUI?.(true, appState) ??
          (!appState.viewModeEnabled && <DefaultSidebarTriggerTunnel.Out />)}
        {defaultUIEnabled &&
          appState.viewModeEnabled &&
          app.isInteractionEnabled() && (
            <ExitViewModeButton actionManager={actionManager} />
          )}
      </div>
    );

    const topLeftUI = (
      <div className="excalidraw-ui-top-left">
        <MainMenuTunnel.Out />
      </div>
    );

    return (
      <div
        className="App-toolbar-content"
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        {topLeftUI}
        {topRightUI}
      </div>
    );
  };

  const shouldRenderScrollBackToContent =
    scrollBackToContentUIEnabled && appState.scrolledOutside;
  const scrollBackToContentButton =
    shouldRenderScrollBackToContent &&
    !appState.openMenu &&
    !appState.openSidebar ? (
      <button
        type="button"
        className="scroll-back-to-content"
        onClick={() => {
          setAppState((appState) => ({
            ...getScrollToContentState(elements, appState),
          }));
        }}
      >
        {"Scroll back to content"}
      </button>
    ) : null;

  const breadcrumb = <FrameBreadcrumb />;

  const floatingStatus = appState.toast ? (
    <Toast
      message={appState.toast.message}
      onClose={() => setAppState({ toast: null })}
      duration={appState.toast.duration}
      closable={appState.toast.closable}
    />
  ) : (
    scrollBackToContentButton
  );

  const viewportStatusLabel = app.props.viewportStatusFrame?.label;
  const viewportStatusBadge = viewportStatusLabel ? (
    <ViewportStatusBadge
      label={viewportStatusLabel}
      border={app.props.viewportStatusFrame?.border}
    />
  ) : null;

  return (
    <>
      {renderSidebars()}
      {/* welcome screen and top bar have the same z-index */}
      {/* ordered in this reverse order so that top bar is on top */}
      <div className="App-welcome-screen">
        {renderWelcomeScreen && <WelcomeScreenCenterTunnel.Out />}
      </div>

      {(floatingStatus || breadcrumb) && (
        <div className="floating-status-stack">
          {floatingStatus}
          {breadcrumb}
        </div>
      )}

      {viewportStatusBadge && (
        <div className="viewport-status-frame__badge-row">
          {viewportStatusBadge}
        </div>
      )}

      <FixedSideContainer side="top" className="App-top-bar">
        {renderAppTopBar()}
      </FixedSideContainer>
    </>
  );
};
