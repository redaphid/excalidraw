import clsx from "clsx";

import { THEME } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import {
  actionClearCanvas,
  actionLoadScene,
  actionSaveToActiveFile,
  actionShortcuts,
  actionToggleArrowBinding,
  actionToggleGridMode,
  actionToggleMidpointSnapping,
  actionToggleObjectsSnapMode,
  actionToggleSearchMenu,
  actionToggleShowHints,
  actionToggleStats,
  actionToggleTheme,
  actionToggleZenMode,
} from "../../actions";
import { actionupdateFrameRendering } from "../../actions/actionFrame";
import { actionToggleViewMode } from "../../actions/actionToggleViewMode";
import { resolveInputDevice } from "../../appState";

import { getShortcutFromShortcutName } from "../../actions/shortcuts";
import { trackEvent } from "../../analytics";
import { useUIAppState } from "../../context/ui-appState";
import { useSetAtom } from "../../editor-jotai";
import { activeConfirmDialogAtom } from "../ActiveConfirmDialog";
import {
  useExcalidrawSetAppState,
  useExcalidrawActionManager,
  useExcalidrawElements,
  useAppProps,
  useApp,
} from "../App";
import { openConfirmModal } from "../OverwriteConfirm/OverwriteConfirmState";
import Trans from "../Trans";
import DropdownMenuItem from "../dropdownMenu/DropdownMenuItem";
import DropdownMenuItemCheckbox from "../dropdownMenu/DropdownMenuItemCheckbox";
import DropdownMenuItemContentRadio from "../dropdownMenu/DropdownMenuItemContentRadio";
import DropdownMenuItemLink from "../dropdownMenu/DropdownMenuItemLink";
import DropdownMenuSub from "../dropdownMenu/DropdownMenuSub";
import {
  GithubIcon,
  DiscordIcon,
  XBrandIcon,
  settingsIcon,
  emptyIcon,
} from "../icons";
import {
  boltIcon,
  DeviceDesktopIcon,
  ExportIcon,
  ExportImageIcon,
  HelpIcon,
  LoadIcon,
  MoonIcon,
  save,
  searchIcon,
  SunIcon,
  TrashIcon,
  usersIcon,
} from "../icons";

import "./DefaultItems.scss";

import type { InputDevice } from "../../types";

export const LoadScene = () => {
  const actionManager = useExcalidrawActionManager();
  const elements = useExcalidrawElements();

  if (!actionManager.isActionEnabled(actionLoadScene)) {
    return null;
  }

  const handleSelect = async () => {
    if (
      !elements.length ||
      (await openConfirmModal({
        title: "Load from file",
        actionLabel: "Load from file",
        color: "warning",
        description: (
          <Trans
            i18nKey="overwriteConfirm.modal.loadFromFile.description"
            bold={(text) => <strong>{text}</strong>}
            br={() => <br />}
          />
        ),
      }))
    ) {
      actionManager.executeAction(actionLoadScene);
    }
  };

  return (
    <DropdownMenuItem
      icon={LoadIcon}
      onSelect={handleSelect}
      data-testid="load-button"
      shortcut={getShortcutFromShortcutName("loadScene")}
      aria-label={"Open"}
    >
      {"Open"}
    </DropdownMenuItem>
  );
};
LoadScene.displayName = "LoadScene";

export const SaveToActiveFile = () => {
  const actionManager = useExcalidrawActionManager();

  if (!actionManager.isActionEnabled(actionSaveToActiveFile)) {
    return null;
  }

  return (
    <DropdownMenuItem
      shortcut={getShortcutFromShortcutName("saveScene")}
      data-testid="save-button"
      onSelect={() => actionManager.executeAction(actionSaveToActiveFile)}
      icon={save}
      aria-label={`${"Save to current file"}`}
    >{`${"Save to current file"}`}</DropdownMenuItem>
  );
};
SaveToActiveFile.displayName = "SaveToActiveFile";

export const SaveAsImage = () => {
  const setAppState = useExcalidrawSetAppState();
  return (
    <DropdownMenuItem
      icon={ExportImageIcon}
      data-testid="image-export-button"
      onSelect={() => setAppState({ openDialog: { name: "imageExport" } })}
      shortcut={getShortcutFromShortcutName("imageExport")}
      aria-label={"Export image..."}
    >
      {"Export image..."}
    </DropdownMenuItem>
  );
};
SaveAsImage.displayName = "SaveAsImage";

export const CommandPalette = (opts?: { className?: string }) => {
  const setAppState = useExcalidrawSetAppState();

  return (
    <DropdownMenuItem
      icon={boltIcon}
      data-testid="command-palette-button"
      onSelect={() => {
        trackEvent("command_palette", "open", "menu");
        setAppState({ openDialog: { name: "commandPalette" } });
      }}
      shortcut={getShortcutFromShortcutName("commandPalette")}
      aria-label={"Command palette"}
      className={opts?.className}
    >
      {"Command palette"}
    </DropdownMenuItem>
  );
};
CommandPalette.displayName = "CommandPalette";

export const SearchMenu = (opts?: { className?: string }) => {
  const actionManager = useExcalidrawActionManager();

  return (
    <DropdownMenuItem
      icon={searchIcon}
      data-testid="search-menu-button"
      onSelect={() => {
        actionManager.executeAction(actionToggleSearchMenu);
      }}
      shortcut={getShortcutFromShortcutName("searchMenu")}
      aria-label={"Find on canvas"}
      className={opts?.className}
    >
      {"Find on canvas"}
    </DropdownMenuItem>
  );
};
SearchMenu.displayName = "SearchMenu";

export const Help = () => {
  const actionManager = useExcalidrawActionManager();

  return (
    <DropdownMenuItem
      data-testid="help-menu-item"
      icon={HelpIcon}
      onSelect={() => actionManager.executeAction(actionShortcuts)}
      shortcut="?"
      aria-label={"Help"}
    >
      {"Help"}
    </DropdownMenuItem>
  );
};
Help.displayName = "Help";

export const ClearCanvas = () => {
  const setActiveConfirmDialog = useSetAtom(activeConfirmDialogAtom);
  const actionManager = useExcalidrawActionManager();

  if (!actionManager.isActionEnabled(actionClearCanvas)) {
    return null;
  }

  return (
    <DropdownMenuItem
      icon={TrashIcon}
      onSelect={() => setActiveConfirmDialog("clearCanvas")}
      data-testid="clear-canvas-button"
      aria-label={"Reset the canvas"}
    >
      {"Reset the canvas"}
    </DropdownMenuItem>
  );
};
ClearCanvas.displayName = "ClearCanvas";

export const ToggleTheme = (
  props:
    | {
        allowSystemTheme: true;
        /**
         * Controls the theme of this UI component only.
         * You should subscribe to `props.onThemeChange` and control the theme
         * upstream.
         */
        theme: Theme | "system";
      }
    | {
        allowSystemTheme: false;
      },
) => {
  const appState = useUIAppState();
  const actionManager = useExcalidrawActionManager();
  const shortcut = getShortcutFromShortcutName("toggleTheme");
  const appProps = useAppProps();

  if (!actionManager.isActionEnabled(actionToggleTheme)) {
    return null;
  }

  if (props?.allowSystemTheme) {
    return (
      <DropdownMenuItemContentRadio
        name="theme"
        value={props.theme}
        onChange={(value: Theme | "system") => {
          if (appProps.onThemeChange) {
            appProps.onThemeChange(value);
            return;
          }

          console.warn(
            "MainMenu.DefaultItems.ToggleTheme: `<Excalidraw/> props.onThemeChange` must be defined to use system theme selection.",
          );
        }}
        choices={[
          {
            value: THEME.LIGHT,
            label: SunIcon,
            ariaLabel: `${"Light mode"} - ${shortcut}`,
          },
          {
            value: THEME.DARK,
            label: MoonIcon,
            ariaLabel: `${"Dark mode"} - ${shortcut}`,
          },
          {
            value: "system",
            label: DeviceDesktopIcon,
            ariaLabel: "System mode",
          },
        ]}
      >
        {"Theme"}
      </DropdownMenuItemContentRadio>
    );
  }

  return (
    <DropdownMenuItem
      onSelect={(event) => {
        // do not close the menu when changing theme
        event.preventDefault();

        actionManager.executeAction(actionToggleTheme);
      }}
      icon={appState.theme === THEME.DARK ? SunIcon : MoonIcon}
      data-testid="toggle-dark-mode"
      shortcut={shortcut}
      aria-label={appState.theme === THEME.DARK ? "Light mode" : "Dark mode"}
    >
      {appState.theme === THEME.DARK ? "Light mode" : "Dark mode"}
    </DropdownMenuItem>
  );
};
ToggleTheme.displayName = "ToggleTheme";

export const ChangeCanvasBackground = () => {
  const appState = useUIAppState();
  const actionManager = useExcalidrawActionManager();
  const appProps = useAppProps();

  if (
    appState.viewModeEnabled ||
    !appProps.UIOptions.canvasActions.changeViewBackgroundColor
  ) {
    return null;
  }
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div
        data-testid="canvas-background-label"
        style={{
          fontSize: "0.875rem",
          marginBottom: "0.25rem",
          marginLeft: "0.5rem",
        }}
      >
        {"Canvas background"}
      </div>
      <div style={{ padding: "0 0.625rem" }}>
        {actionManager.renderAction("changeViewBackgroundColor")}
      </div>
    </div>
  );
};
ChangeCanvasBackground.displayName = "ChangeCanvasBackground";

export const Export = () => {
  const setAppState = useExcalidrawSetAppState();
  return (
    <DropdownMenuItem
      icon={ExportIcon}
      onSelect={() => {
        setAppState({ openDialog: { name: "jsonExport" } });
      }}
      data-testid="json-export-button"
      aria-label={"Save to..."}
    >
      {"Save to..."}
    </DropdownMenuItem>
  );
};
Export.displayName = "Export";

export const Socials = () => {
  return (
    <>
      <DropdownMenuItemLink
        icon={GithubIcon}
        href="https://github.com/excalidraw/excalidraw"
        aria-label="GitHub"
      >
        GitHub
      </DropdownMenuItemLink>
      <DropdownMenuItemLink
        icon={XBrandIcon}
        href="https://x.com/excalidraw"
        aria-label="X"
      >
        {"Follow us"}
      </DropdownMenuItemLink>
      <DropdownMenuItemLink
        icon={DiscordIcon}
        href="https://discord.gg/UexuTaE"
        aria-label="Discord"
      >
        {"Discord chat"}
      </DropdownMenuItemLink>
    </>
  );
};
Socials.displayName = "Socials";

export const LiveCollaborationTrigger = ({
  onSelect,
  isCollaborating,
}: {
  onSelect: () => void;
  isCollaborating: boolean;
}) => {
  return (
    <DropdownMenuItem
      data-testid="collab-button"
      icon={usersIcon}
      className={clsx({
        "active-collab": isCollaborating,
      })}
      onSelect={onSelect}
    >
      {"Live collaboration..."}
    </DropdownMenuItem>
  );
};

LiveCollaborationTrigger.displayName = "LiveCollaborationTrigger";

const PreferencesToggleToolLockItem = () => {
  const app = useApp();
  const appState = useUIAppState();

  return (
    <DropdownMenuItemCheckbox
      checked={appState.activeTool.locked}
      shortcut={getShortcutFromShortcutName("toolLock")}
      onSelect={(event) => {
        app.toggleLock();
        event.preventDefault();
      }}
    >
      {"Tool lock"}
    </DropdownMenuItemCheckbox>
  );
};

const PreferencesBoxSelectionModeItem = () => {
  const appState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  return (
    <DropdownMenuItemContentRadio<"contain" | "overlap">
      name="boxSelectionMode"
      icon={emptyIcon}
      value={appState.boxSelectionMode}
      onChange={(value) => {
        setAppState({
          boxSelectionMode: value,
        });
      }}
      choices={[
        {
          value: "contain",
          label: "Wrap",
          ariaLabel: "Wrap",
        },
        {
          value: "overlap",
          label: "Overlap",
          ariaLabel: "Overlap",
        },
      ]}
    >
      {"Select on"}
    </DropdownMenuItemContentRadio>
  );
};

const PreferencesInputDeviceItem = () => {
  const appState = useUIAppState();
  const setAppState = useExcalidrawSetAppState();

  return (
    <DropdownMenuItemContentRadio<Exclude<InputDevice, "auto">>
      name="inputDevice"
      icon={emptyIcon}
      // `auto` isn't offered yet; the radio shows what it resolves to
      value={resolveInputDevice(appState.inputDevice)}
      onChange={(value) => {
        setAppState({
          inputDevice: value,
        });
      }}
      choices={[
        {
          value: "trackpad",
          label: "Trackpad",
          ariaLabel: "Trackpad",
        },
        {
          value: "mouse",
          label: "Mouse",
          ariaLabel: "Mouse",
        },
      ]}
    >
      {"Input"}
    </DropdownMenuItemContentRadio>
  );
};

const PreferencesToggleSnapModeItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  return (
    <DropdownMenuItemCheckbox
      checked={appState.objectsSnapModeEnabled}
      shortcut={getShortcutFromShortcutName("objectsSnapMode")}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleObjectsSnapMode);
        event.preventDefault();
      }}
    >
      {"Snap to objects"}
    </DropdownMenuItemCheckbox>
  );
};

const PreferencesToggleArrowBindingItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  return (
    <DropdownMenuItemCheckbox
      checked={appState.bindingPreference === "enabled"}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleArrowBinding);
        event.preventDefault();
      }}
    >
      {"Arrow binding"}
    </DropdownMenuItemCheckbox>
  );
};

const PreferencesToggleMidpointSnappingItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  return (
    <DropdownMenuItemCheckbox
      checked={appState.isMidpointSnappingEnabled}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleMidpointSnapping);
        event.preventDefault();
      }}
    >
      {"Snap to midpoints"}
    </DropdownMenuItemCheckbox>
  );
};

const PreferencesToggleShowHintsItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  return (
    <DropdownMenuItemCheckbox
      checked={appState.showHints}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleShowHints);
        event.preventDefault();
      }}
    >
      {"Show hints"}
    </DropdownMenuItemCheckbox>
  );
};

export const PreferencesToggleGridModeItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();

  return (
    <DropdownMenuItemCheckbox
      checked={appState.gridModeEnabled}
      shortcut={getShortcutFromShortcutName("gridMode")}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleGridMode);
        event.preventDefault();
      }}
    >
      {"Snap to grid"}
    </DropdownMenuItemCheckbox>
  );
};

export const PreferencesToggleFramesItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();

  return (
    <DropdownMenuItemCheckbox
      checked={appState.frameRendering.enabled}
      shortcut={getShortcutFromShortcutName("updateFrameRendering")}
      onSelect={(event) => {
        actionManager.executeAction(actionupdateFrameRendering);
        event.preventDefault();
      }}
    >
      {"Show frames"}
    </DropdownMenuItemCheckbox>
  );
};

export const PreferencesToggleZenModeItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  return (
    <DropdownMenuItemCheckbox
      checked={appState.zenModeEnabled}
      shortcut={getShortcutFromShortcutName("zenMode")}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleZenMode);
        event.preventDefault();
      }}
    >
      {"Zen mode"}
    </DropdownMenuItemCheckbox>
  );
};

const PreferencesToggleViewModeItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  if (!actionManager.isActionEnabled(actionToggleViewMode)) {
    return null;
  }
  return (
    <DropdownMenuItemCheckbox
      checked={appState.viewModeEnabled}
      shortcut={getShortcutFromShortcutName("viewMode")}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleViewMode);
        event.preventDefault();
      }}
    >
      {"View mode"}
    </DropdownMenuItemCheckbox>
  );
};

const PreferencesToggleElementPropertiesItem = () => {
  const actionManager = useExcalidrawActionManager();
  const appState = useUIAppState();
  return (
    <DropdownMenuItemCheckbox
      checked={appState.stats.open}
      shortcut={getShortcutFromShortcutName("stats")}
      onSelect={(event) => {
        actionManager.executeAction(actionToggleStats);
        event.preventDefault();
      }}
    >
      {"Canvas & Shape properties"}
    </DropdownMenuItemCheckbox>
  );
};

export const Preferences = ({
  children,
  additionalItems,
}: {
  children?: React.ReactNode;
  additionalItems?: React.ReactNode;
}) => {
  return (
    <DropdownMenuSub>
      <DropdownMenuSub.Trigger icon={settingsIcon}>
        {"Preferences"}
      </DropdownMenuSub.Trigger>
      <DropdownMenuSub.Content className="excalidraw-main-menu-preferences-submenu">
        {children || (
          <>
            <PreferencesBoxSelectionModeItem />
            <PreferencesInputDeviceItem />
            <PreferencesToggleToolLockItem />
            <PreferencesToggleSnapModeItem />
            <PreferencesToggleGridModeItem />
            <PreferencesToggleFramesItem />
            <PreferencesToggleZenModeItem />
            <PreferencesToggleViewModeItem />
            <PreferencesToggleElementPropertiesItem />
            <PreferencesToggleArrowBindingItem />
            <PreferencesToggleMidpointSnappingItem />
            <PreferencesToggleShowHintsItem />
          </>
        )}
        {additionalItems}
      </DropdownMenuSub.Content>
    </DropdownMenuSub>
  );
};

Preferences.ToggleToolLock = PreferencesToggleToolLockItem;
Preferences.BoxSelectionMode = PreferencesBoxSelectionModeItem;
Preferences.InputDevice = PreferencesInputDeviceItem;
Preferences.ToggleSnapMode = PreferencesToggleSnapModeItem;
Preferences.ToggleArrowBinding = PreferencesToggleArrowBindingItem;
Preferences.ToggleMidpointSnapping = PreferencesToggleMidpointSnappingItem;
Preferences.ToggleShowHints = PreferencesToggleShowHintsItem;
Preferences.ToggleGridMode = PreferencesToggleGridModeItem;
Preferences.ToggleFrames = PreferencesToggleFramesItem;
Preferences.ToggleZenMode = PreferencesToggleZenModeItem;
Preferences.ToggleViewMode = PreferencesToggleViewModeItem;
Preferences.ToggleElementProperties = PreferencesToggleElementPropertiesItem;

Preferences.displayName = "Preferences";
