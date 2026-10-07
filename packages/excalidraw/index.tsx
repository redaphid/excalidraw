import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  applyDarkModeFilter,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_UI_OPTIONS,
  getStrokeWidthByKey,
  isShallowEqual,
} from "@excalidraw/common";

import App, {
  ExcalidrawAPIContext,
  ExcalidrawAPISetContext,
} from "./components/App";
import { InitializeApp } from "./components/InitializeApp";
import Footer from "./components/footer/FooterCenter";
import LiveCollaborationTrigger from "./components/live-collaboration/LiveCollaborationTrigger";
import MainMenu from "./components/main-menu/MainMenu";
import WelcomeScreen from "./components/welcome-screen/WelcomeScreen";
import { defaultLang } from "./i18n";
import {
  useAppStateValue as _useAppStateValue,
  useOnAppStateChange as _useOnAppStateChange,
} from "./hooks/useAppStateValue";
import { EditorJotaiProvider, editorJotaiStore } from "./editor-jotai";
import polyfill from "./polyfill";

import "./css/app.scss";
import "./css/styles.scss";
import "./fonts/fonts.css";

import type {
  AppProps,
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "./types";

polyfill();

/**
 * Stateless provider that allows `useExcalidrawAPI()` (and hooks built
 * on it, such as `useAppStateValue()` and `useOnAppStateChange()`) to work
 * outside the <Excalidraw> component tree.
 */
export const ExcalidrawAPIProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  return (
    <ExcalidrawAPIContext.Provider value={api}>
      <ExcalidrawAPISetContext.Provider value={setApi}>
        {children}
      </ExcalidrawAPISetContext.Provider>
    </ExcalidrawAPIContext.Provider>
  );
};

const ExcalidrawBase = (props: ExcalidrawProps) => {
  const {
    onExport,
    className,
    ownerDocument = document,
    onChange,
    onThemeChange,
    onIncrement,
    initialData,
    initialState,
    onExcalidrawAPI,
    onMount,
    onUnmount,
    onInitialize,
    isCollaborating = false,
    authoringUnits,
    freedrawStrokeWidth,
    onPointerUpdate,
    renderTopLeftUI,
    renderTopRightUI,
    langCode = defaultLang.code,
    viewModeEnabled,
    interaction,
    ui,
    activeTool,
    zenModeEnabled,
    gridModeEnabled,
    libraryReturnUrl,
    theme,
    name,
    renderCustomStats,
    onPaste,
    detectScroll = true,
    handleKeyboardGlobally = false,
    onLibraryChange,
    autoFocus = false,
    generateIdForFile,
    onLinkOpen,
    generateLinkForSelection,
    onPointerDown,
    onPointerUp,
    onScrollChange,
    onUserFollow,
    userToFollow,
    onDuplicate,
    children,
    validateEmbeddable,
    renderEmbeddable,
    aiEnabled,
    showDeprecatedFonts,
    renderScrollbars,
    viewportStatusFrame,
    frameNavigation,
    currentUserControls,
    imageOptions,
  } = props;

  const canvasActions = props.UIOptions?.canvasActions;

  // FIXME normalize/set defaults in parent component so that the memo resolver
  // compares the same values
  const UIOptions: AppProps["UIOptions"] = {
    ...props.UIOptions,
    canvasActions: {
      ...DEFAULT_UI_OPTIONS.canvasActions,
      ...canvasActions,
    },
    tools: {
      image: props.UIOptions?.tools?.image ?? true,
    },
  };

  if (canvasActions?.export) {
    UIOptions.canvasActions.export.saveFileToDisk =
      canvasActions.export?.saveFileToDisk ??
      DEFAULT_UI_OPTIONS.canvasActions.export.saveFileToDisk;
  }

  if (
    UIOptions.canvasActions.toggleTheme === null &&
    (theme == null || onThemeChange)
  ) {
    UIOptions.canvasActions.toggleTheme = true;
  }

  const normalizedImageOptions: AppProps["imageOptions"] = {
    maxFileSizeBytes:
      imageOptions?.maxFileSizeBytes ?? DEFAULT_IMAGE_OPTIONS.maxFileSizeBytes,
    maxWidthOrHeight:
      imageOptions?.maxWidthOrHeight ?? DEFAULT_IMAGE_OPTIONS.maxWidthOrHeight,
  };

  const setExcalidrawAPI = useContext(ExcalidrawAPISetContext);

  const onExcalidrawAPIRef = useRef(onExcalidrawAPI);
  onExcalidrawAPIRef.current = onExcalidrawAPI;

  const handleExcalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI | null) => {
      setExcalidrawAPI?.(api);
      onExcalidrawAPIRef.current?.(api);
    },
    [setExcalidrawAPI],
  );

  // whether the browser's own zoom is kept available while the editor is
  // non-interactive (with navigation allowed, pinch is consumed by the
  // editor instead, which relies on the pinch prevention below)
  const browserZoomAllowed =
    typeof interaction === "object" &&
    interaction !== null &&
    interaction.enabled?.browserZoom === true &&
    interaction.enabled?.navigation !== true;

  useEffect(() => {
    const importPolyfill = async () => {
      //@ts-ignore
      await import("canvas-roundrect-polyfill");
    };

    importPolyfill();

    if (browserZoomAllowed) {
      return;
    }

    // Block pinch-zooming on iOS outside of the content area
    const handleTouchMove = (event: TouchEvent) => {
      // @ts-ignore
      if (typeof event.scale === "number" && event.scale !== 1) {
        event.preventDefault();
      }
    };

    ownerDocument.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });

    return () => {
      ownerDocument.removeEventListener("touchmove", handleTouchMove);
    };
  }, [browserZoomAllowed, ownerDocument]);

  return (
    <EditorJotaiProvider store={editorJotaiStore}>
      <InitializeApp langCode={langCode} theme={theme}>
        <App
          onExport={onExport}
          className={className}
          ownerDocument={ownerDocument}
          onChange={onChange}
          onThemeChange={onThemeChange}
          onIncrement={onIncrement}
          initialData={initialData}
          initialState={initialState}
          onExcalidrawAPI={handleExcalidrawAPI}
          onMount={onMount}
          onUnmount={onUnmount}
          onInitialize={onInitialize}
          isCollaborating={isCollaborating}
          authoringUnits={authoringUnits}
          freedrawStrokeWidth={freedrawStrokeWidth}
          onPointerUpdate={onPointerUpdate}
          renderTopLeftUI={renderTopLeftUI}
          renderTopRightUI={renderTopRightUI}
          langCode={langCode}
          viewModeEnabled={viewModeEnabled}
          interaction={interaction}
          ui={ui}
          activeTool={activeTool}
          zenModeEnabled={zenModeEnabled}
          gridModeEnabled={gridModeEnabled}
          libraryReturnUrl={libraryReturnUrl}
          theme={theme}
          name={name}
          renderCustomStats={renderCustomStats}
          UIOptions={UIOptions}
          onPaste={onPaste}
          detectScroll={detectScroll}
          handleKeyboardGlobally={handleKeyboardGlobally}
          onLibraryChange={onLibraryChange}
          autoFocus={autoFocus}
          generateIdForFile={generateIdForFile}
          onLinkOpen={onLinkOpen}
          generateLinkForSelection={generateLinkForSelection}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onScrollChange={onScrollChange}
          onUserFollow={onUserFollow}
          userToFollow={userToFollow}
          onDuplicate={onDuplicate}
          validateEmbeddable={validateEmbeddable}
          renderEmbeddable={renderEmbeddable}
          aiEnabled={aiEnabled !== false}
          showDeprecatedFonts={showDeprecatedFonts}
          renderScrollbars={renderScrollbars}
          viewportStatusFrame={viewportStatusFrame}
          frameNavigation={frameNavigation}
          currentUserControls={currentUserControls}
          imageOptions={normalizedImageOptions}
        >
          {children}
        </App>
      </InitializeApp>
    </EditorJotaiProvider>
  );
};

const areEqual = (prevProps: ExcalidrawProps, nextProps: ExcalidrawProps) => {
  // short-circuit early
  if (prevProps.children !== nextProps.children) {
    return false;
  }

  const {
    initialData: prevInitialData,
    UIOptions: prevUIOptions = {},
    imageOptions: prevImageOptions,
    interaction: prevInteraction,
    ui: prevUI,
    activeTool: prevActiveTool,
    frameNavigation: prevFrameNavigation,
    ...prev
  } = prevProps;
  const {
    initialData: nextInitialData,
    UIOptions: nextUIOptions = {},
    imageOptions: nextImageOptions,
    interaction: nextInteraction,
    ui: nextUI,
    activeTool: nextActiveTool,
    frameNavigation: nextFrameNavigation,
    ...next
  } = nextProps;

  // compare `activeTool` semantically so that hosts inlining the object
  // (`activeTool={{ type: "laser" }}`) don't bust the memo every render
  const isActiveToolSame =
    prevActiveTool === nextActiveTool ||
    (prevActiveTool?.type === nextActiveTool?.type &&
      (prevActiveTool?.type === "custom" ? prevActiveTool.customType : null) ===
        (nextActiveTool?.type === "custom" ? nextActiveTool.customType : null));

  if (!isActiveToolSame) {
    return false;
  }

  // compare `interaction` semantically so that hosts inlining the config
  // object (`interaction={{ enabled: { links: true } }}`) don't bust the
  // memo every render
  const isInteractionSame =
    prevInteraction === nextInteraction ||
    (typeof prevInteraction === "object" &&
      prevInteraction !== null &&
      typeof nextInteraction === "object" &&
      nextInteraction !== null &&
      !!prevInteraction.enabled?.links === !!nextInteraction.enabled?.links &&
      !!prevInteraction.enabled?.embeds === !!nextInteraction.enabled?.embeds &&
      !!prevInteraction.enabled?.interactiveContent ===
        !!nextInteraction.enabled?.interactiveContent &&
      !!prevInteraction.enabled?.navigation ===
        !!nextInteraction.enabled?.navigation &&
      !!prevInteraction.enabled?.browserZoom ===
        !!nextInteraction.enabled?.browserZoom &&
      !!prevInteraction.enabled?.tools?.laser ===
        !!nextInteraction.enabled?.tools?.laser &&
      !!prevInteraction.enabled?.tools?.custom ===
        !!nextInteraction.enabled?.tools?.custom);

  if (!isInteractionSame) {
    return false;
  }

  // compare `ui` semantically so that hosts inlining the config object don't
  // bust the memo every render
  const isUISame =
    prevUI === nextUI ||
    (typeof prevUI === "object" &&
      prevUI !== null &&
      typeof nextUI === "object" &&
      nextUI !== null &&
      !!prevUI.enabled?.zoom === !!nextUI.enabled?.zoom &&
      !!prevUI.enabled?.scrollBackToContent ===
        !!nextUI.enabled?.scrollBackToContent);

  if (!isUISame) {
    return false;
  }

  // compare `frameNavigation` by its bookmarks and callback so that hosts
  // inlining the object don't bust the memo every render
  const prevBookmarks = prevFrameNavigation?.bookmarks ?? [];
  const nextBookmarks = nextFrameNavigation?.bookmarks ?? [];
  const isFrameNavigationSame =
    prevFrameNavigation === nextFrameNavigation ||
    (!!prevFrameNavigation &&
      !!nextFrameNavigation &&
      prevFrameNavigation.onBookmarkChange ===
        nextFrameNavigation.onBookmarkChange &&
      prevBookmarks.length === nextBookmarks.length &&
      prevBookmarks.every((id, i) => id === nextBookmarks[i]));

  if (!isFrameNavigationSame) {
    return false;
  }

  // comparing UIOptions
  const prevUIOptionsKeys = Object.keys(prevUIOptions) as (keyof Partial<
    typeof DEFAULT_UI_OPTIONS
  >)[];
  const nextUIOptionsKeys = Object.keys(nextUIOptions) as (keyof Partial<
    typeof DEFAULT_UI_OPTIONS
  >)[];

  if (prevUIOptionsKeys.length !== nextUIOptionsKeys.length) {
    return false;
  }

  const isUIOptionsSame = prevUIOptionsKeys.every((key) => {
    if (key === "getFormFactor") {
      return true;
    }
    if (key === "canvasActions") {
      const canvasOptionKeys = Object.keys(
        prevUIOptions.canvasActions!,
      ) as (keyof Partial<typeof DEFAULT_UI_OPTIONS.canvasActions>)[];
      return canvasOptionKeys.every((key) => {
        if (
          key === "export" &&
          prevUIOptions?.canvasActions?.export &&
          nextUIOptions?.canvasActions?.export
        ) {
          return (
            prevUIOptions.canvasActions.export.saveFileToDisk ===
            nextUIOptions.canvasActions.export.saveFileToDisk
          );
        }
        return (
          prevUIOptions?.canvasActions?.[key] ===
          nextUIOptions?.canvasActions?.[key]
        );
      });
    }
    return prevUIOptions[key] === nextUIOptions[key];
  });

  const isImageOptionsSame =
    (prevImageOptions?.maxWidthOrHeight ??
      DEFAULT_IMAGE_OPTIONS.maxWidthOrHeight) ===
      (nextImageOptions?.maxWidthOrHeight ??
        DEFAULT_IMAGE_OPTIONS.maxWidthOrHeight) &&
    (prevImageOptions?.maxFileSizeBytes ??
      DEFAULT_IMAGE_OPTIONS.maxFileSizeBytes) ===
      (nextImageOptions?.maxFileSizeBytes ??
        DEFAULT_IMAGE_OPTIONS.maxFileSizeBytes);

  return isUIOptionsSame && isImageOptionsSame && isShallowEqual(prev, next);
};

export const Excalidraw = React.memo(ExcalidrawBase, areEqual);
Excalidraw.displayName = "Excalidraw";

export {
  getSceneVersion,
  hashElementsVersion,
  hashString,
  getNonDeletedElements,
} from "@excalidraw/element";

export { getTextFromElements } from "@excalidraw/element";
export { isInvisiblySmallElement } from "@excalidraw/element";

export { defaultLang, useI18n, languages } from "./i18n";
export {
  restoreAppState,
  restoreElement,
  restoreElements,
  restoreLibraryItems,
} from "./data/restore";

export { reconcileElements } from "./data/reconcile";

export {
  exportToCanvas,
  exportToBlob,
  exportToSvg,
  exportToClipboard,
} from "@excalidraw/utils/export";

export { serializeAsJSON, serializeLibraryAsJSON } from "./data/json";
export {
  loadFromBlob,
  loadSceneOrLibraryFromBlob,
  loadLibraryFromBlob,
} from "./data/blob";
export { mergeLibraryItems, getLibraryItemsHash } from "./data/library";
export { isLinearElement } from "@excalidraw/element";

export {
  FONT_FAMILY,
  THEME,
  MIME_TYPES,
  ROUNDNESS,
  DEFAULT_LASER_COLOR,
  UserIdleState,
  normalizeLink,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
  getFormFactor,
  throttleRAF,
  FRAMES_SIDEBAR_TAB,
} from "@excalidraw/common";

export {
  mutateElement,
  newElementWith,
  bumpVersion,
} from "@excalidraw/element";

export { CaptureUpdateAction } from "@excalidraw/element";

export { parseLibraryTokensFromUrl, useHandleLibrary } from "./data/library";

export { Sidebar } from "./components/Sidebar/Sidebar";
export { Button } from "./components/Button";
export { Footer };
export { MainMenu };
export { Ellipsify } from "./components/Ellipsify";
export {
  useEditorInterface,
  useStylesPanelMode,
  useExcalidrawAPI,
  ExcalidrawAPIContext,
} from "./components/App";

export { WelcomeScreen };
export { LiveCollaborationTrigger };
export { Stats } from "./components/Stats";

export { DefaultSidebar } from "./components/DefaultSidebar";
export { TTDDialog } from "./components/TTDDialog/TTDDialog";
export { TTDDialogTrigger } from "./components/TTDDialog/TTDDialogTrigger";
export {
  TTDStreamFetch,
  parseSSEStream,
} from "./components/TTDDialog/utils/TTDStreamFetch";
export type { StreamChunk } from "./components/TTDDialog/utils/TTDStreamFetch";
export type {
  TTDPersistenceAdapter,
  SavedChat,
  SavedChats,
} from "./components/TTDDialog/types";

export type {
  ViewportStatusFrame,
  FrameNavigation,
  ElementRenderOverride,
  ElementRenderOverrides,
} from "./types";

export { zoomToFitBounds, DEFAULT_OVERSCROLL } from "./viewport";

export {
  getCommonBounds,
  getVisibleSceneBounds,
  convertToExcalidrawElements,
} from "@excalidraw/element";

export { elementsOverlappingBBox } from "@excalidraw/element";

export { DiagramToCodePlugin } from "./components/DiagramToCodePlugin/DiagramToCodePlugin";
export { getDataURL } from "./data/blob";
export { isElementLink } from "@excalidraw/element";

export { Fonts } from "./fonts/Fonts";

export { setCustomTextMetricsProvider } from "@excalidraw/element";

export { CommandPalette } from "./components/CommandPalette/CommandPalette";

export {
  renderSpreadsheet,
  tryParseSpreadsheet,
  isSpreadsheetValidForChartType,
} from "./charts";

// -----------------------------------------------------------------------------
// useExcalidrawStateValue() wrapper for host apps for the return type to reflect the
// the potentially `undefined` value for initial render before the excalidrawAPI
// is ready.
//
/**
 * hook that subscribes to specific appState prop(s)
 *
 * @param prop - appState prop(s) to subscribe to, or a selector function.
 * NOTE `prop/selector` is memoized and will not change after initial render
 */
export function useExcalidrawStateValue<K extends keyof AppState>(
  prop: K,
): AppState[K] | undefined;
export function useExcalidrawStateValue<T extends keyof AppState>(
  props: T[],
): AppState | undefined;
export function useExcalidrawStateValue<T>(
  selector: (appState: AppState) => T,
): T | undefined;
export function useExcalidrawStateValue(
  selector:
    | keyof AppState
    | (keyof AppState)[]
    | ((appState: AppState) => unknown),
) {
  return _useAppStateValue(selector as any, false);
}
// -----------------------------------------------------------------------------

export { _useOnAppStateChange as useOnExcalidrawStateChange };

export { applyDarkModeFilter, getStrokeWidthByKey };

Object.assign(globalThis, {
  ciFailProofBlob:
    "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",
});
