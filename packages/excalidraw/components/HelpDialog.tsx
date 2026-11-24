import React from "react";

import { isDarwin, isFirefox, isWindows } from "@excalidraw/common";

import { KEYS } from "@excalidraw/common";

import { actionToggleFramesMenu, actionToggleTheme } from "../actions";
import { getShortcutFromShortcutName } from "../actions/shortcuts";
import { probablySupportsClipboardBlob } from "../clipboard";
import { getShortcutKey } from "../shortcut";

import { useExcalidrawActionManager } from "./App";
import { Dialog } from "./Dialog";
import { ExternalLinkIcon, GithubIcon, youtubeIcon } from "./icons";

import "./HelpDialog.scss";

import type { JSX } from "react";

const Header = () => (
  <div className="HelpDialog__header">
    <a
      className="HelpDialog__btn"
      href="https://docs.excalidraw.com"
      target="_blank"
      rel="noopener"
    >
      <div className="HelpDialog__link-icon">{ExternalLinkIcon}</div>
      {"Documentation"}
    </a>
    <a
      className="HelpDialog__btn"
      href="https://plus.excalidraw.com/blog"
      target="_blank"
      rel="noopener"
    >
      <div className="HelpDialog__link-icon">{ExternalLinkIcon}</div>
      {"Read our blog"}
    </a>
    <a
      className="HelpDialog__btn"
      href="https://github.com/excalidraw/excalidraw/issues"
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="HelpDialog__link-icon">{GithubIcon}</div>
      {"Found an issue? Submit"}
    </a>
    <a
      className="HelpDialog__btn"
      href="https://youtube.com/@excalidraw"
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="HelpDialog__link-icon">{youtubeIcon}</div>
      YouTube
    </a>
  </div>
);

const Section = (props: { title: string; children: React.ReactNode }) => (
  <>
    <h3>{props.title}</h3>
    <div className="HelpDialog__islands-container">{props.children}</div>
  </>
);

const ShortcutIsland = (props: {
  caption: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`HelpDialog__island ${props.className}`}>
    <h4 className="HelpDialog__island-title">{props.caption}</h4>
    <div className="HelpDialog__island-content">{props.children}</div>
  </div>
);

function* intersperse(as: JSX.Element[][], delim: string | null) {
  let first = true;
  for (const x of as) {
    if (!first) {
      yield delim;
    }
    first = false;
    yield x;
  }
}

const upperCaseSingleChars = (str: string) => {
  return str.replace(/\b[a-z]\b/, (c) => c.toUpperCase());
};

const Shortcut = ({
  label,
  shortcuts,
  isOr = true,
}: {
  label: string;
  shortcuts: string[];
  isOr?: boolean;
}) => {
  const splitShortcutKeys = shortcuts.map((shortcut) => {
    const keys = shortcut.endsWith("++")
      ? [...shortcut.slice(0, -2).split("+"), "+"]
      : shortcut.split("+");

    return keys.map((key) => (
      <ShortcutKey key={key}>{upperCaseSingleChars(key)}</ShortcutKey>
    ));
  });

  return (
    <div className="HelpDialog__shortcut">
      <div>{label}</div>
      <div className="HelpDialog__key-container">
        {[...intersperse(splitShortcutKeys, isOr ? "or" : "")]}
      </div>
    </div>
  );
};

const ShortcutKey = (props: { children: React.ReactNode }) => (
  <kbd className="HelpDialog__key" {...props} />
);

export const HelpDialog = ({ onClose }: { onClose?: () => void }) => {
  const actionManager = useExcalidrawActionManager();
  const handleClose = React.useCallback(() => {
    if (onClose) {
      onClose();
    }
  }, [onClose]);

  return (
    <>
      <Dialog
        onCloseRequest={handleClose}
        title={"Help"}
        className={"HelpDialog"}
      >
        <Header />
        <Section title={"Keyboard shortcuts"}>
          <ShortcutIsland
            className="HelpDialog__island--tools"
            caption={"Tools"}
          >
            <Shortcut label={"Hand (panning tool)"} shortcuts={[KEYS.H]} />
            <Shortcut label={"Selection"} shortcuts={[KEYS.V, KEYS["1"]]} />
            <Shortcut label={"Rectangle"} shortcuts={[KEYS.R, KEYS["2"]]} />
            <Shortcut label={"Diamond"} shortcuts={[KEYS.D, KEYS["3"]]} />
            <Shortcut label={"Ellipse"} shortcuts={[KEYS.O, KEYS["4"]]} />
            <Shortcut label={"Arrow"} shortcuts={[KEYS.A, KEYS["5"]]} />
            <Shortcut label={"Line"} shortcuts={[KEYS.L, KEYS["6"]]} />
            <Shortcut label={"Draw"} shortcuts={[KEYS.P, KEYS["7"]]} />
            <Shortcut label={"Text"} shortcuts={[KEYS.T, KEYS["8"]]} />
            <Shortcut label={"Sticky note"} shortcuts={[KEYS.N]} />
            <Shortcut label={"Insert image"} shortcuts={[KEYS["9"]]} />
            <Shortcut label={"Eraser"} shortcuts={[KEYS.E, KEYS["0"]]} />
            <Shortcut label={"Frame tool"} shortcuts={[KEYS.F]} />
            <Shortcut label={"Laser pointer"} shortcuts={[KEYS.K]} />
            <Shortcut label={"Bucket fill"} shortcuts={[KEYS.B]} />
            <Shortcut
              label={"Pick color from canvas"}
              shortcuts={[KEYS.I, "Shift+S", "Shift+G"]}
            />
            <Shortcut
              label={"Edit line/arrow points"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Enter")]}
            />
            <Shortcut
              label={"Edit text / add label"}
              shortcuts={[getShortcutKey("Enter")]}
            />
            <Shortcut
              label={"Add new line (text editor)"}
              shortcuts={[
                getShortcutKey("Enter"),
                getShortcutKey("Shift+Enter"),
              ]}
            />
            <Shortcut
              label={"Finish editing (text editor)"}
              shortcuts={[
                getShortcutKey("Esc"),
                getShortcutKey("CtrlOrCmd+Enter"),
              ]}
            />
            <Shortcut
              label={"Curved arrow"}
              shortcuts={["A", "click", "click", "click"]}
              isOr={false}
            />
            <Shortcut
              label={"Curved line"}
              shortcuts={["L", "click", "click", "click"]}
              isOr={false}
            />
            <Shortcut
              label={"Crop image"}
              shortcuts={["double-click", getShortcutKey("Enter")]}
              isOr={true}
            />
            <Shortcut
              label={"Finish image cropping"}
              shortcuts={[getShortcutKey("Enter"), getShortcutKey("Escape")]}
              isOr={true}
            />
            <Shortcut
              label={"Keep selected tool active after drawing"}
              shortcuts={[KEYS.Q]}
            />
            <Shortcut
              label={"Prevent arrow binding"}
              shortcuts={[getShortcutKey("CtrlOrCmd")]}
            />
            <Shortcut
              label={"Add / Update link for a selected shape"}
              shortcuts={[getShortcutKey("CtrlOrCmd+K")]}
            />
            <Shortcut
              label={"Toggle shape type"}
              shortcuts={["Tab", "Shift+Tab"]}
              isOr={true}
            />
          </ShortcutIsland>
          <ShortcutIsland className="HelpDialog__island--view" caption={"View"}>
            <Shortcut
              label={"Zoom in"}
              shortcuts={[getShortcutKey("CtrlOrCmd++")]}
            />
            <Shortcut
              label={"Zoom out"}
              shortcuts={[getShortcutKey("CtrlOrCmd+-")]}
            />
            <Shortcut
              label={"Reset zoom"}
              shortcuts={[getShortcutKey("CtrlOrCmd+0")]}
            />
            <Shortcut
              label={"Zoom to fit all elements"}
              shortcuts={["Shift+1"]}
            />
            <Shortcut label={"Zoom to selection"} shortcuts={["Shift+2"]} />
            <Shortcut label={"Move page up/down"} shortcuts={["PgUp/PgDn"]} />
            <Shortcut
              label={"Move page left/right"}
              shortcuts={["Shift+PgUp/PgDn"]}
            />
            <Shortcut
              label={"Zen mode"}
              shortcuts={[getShortcutKey("Alt+Z")]}
            />
            <Shortcut
              label={"Snap to objects"}
              shortcuts={[getShortcutKey("Alt+S")]}
            />
            <Shortcut
              label={"Snap to grid"}
              shortcuts={[getShortcutKey("CtrlOrCmd+'")]}
            />
            <Shortcut
              label={"View mode"}
              shortcuts={[getShortcutKey("Alt+R")]}
            />
            <Shortcut
              label={"Show frames"}
              shortcuts={[getShortcutKey("Shift+Alt+F")]}
            />
            {actionManager.isActionEnabled(actionToggleTheme) && (
              <Shortcut
                label={"Toggle light/dark theme"}
                shortcuts={[getShortcutKey("Alt+Shift+D")]}
              />
            )}
            <Shortcut
              label={"Canvas & Shape properties"}
              shortcuts={[getShortcutKey("Alt+/")]}
            />
            <Shortcut
              label={"Find on canvas"}
              shortcuts={[getShortcutFromShortcutName("searchMenu")]}
            />
            {actionManager.isActionEnabled(actionToggleFramesMenu) && (
              <Shortcut
                label={"Frames"}
                shortcuts={[getShortcutFromShortcutName("framesMenu")]}
              />
            )}
            <Shortcut
              label={"Command palette"}
              shortcuts={
                isFirefox
                  ? [getShortcutFromShortcutName("commandPalette")]
                  : [
                      getShortcutFromShortcutName("commandPalette"),
                      getShortcutFromShortcutName("commandPalette", 1),
                    ]
              }
            />
          </ShortcutIsland>
          <ShortcutIsland
            className="HelpDialog__island--editor"
            caption={"Editor"}
          >
            <Shortcut
              label={"Create a flowchart from a generic element"}
              shortcuts={[getShortcutKey(`CtrlOrCmd+Arrow Key`)]}
              isOr={true}
            />
            <Shortcut
              label={"Navigate a flowchart"}
              shortcuts={[getShortcutKey(`Alt+Arrow Key`)]}
              isOr={true}
            />
            {actionManager.isActionEnabled(actionToggleFramesMenu) && (
              <>
                <Shortcut
                  label={"Step between frames"}
                  shortcuts={[getShortcutKey("Arrow Key")]}
                />
                <Shortcut
                  label={"Fly to a bookmarked frame"}
                  shortcuts={[getShortcutKey("Alt+1…9")]}
                />
              </>
            )}
            <Shortcut
              label={"Move canvas"}
              shortcuts={[
                getShortcutKey(`Space+${"drag"}`),
                getShortcutKey(`Wheel+${"drag"}`),
              ]}
              isOr={true}
            />
            <Shortcut
              label={"Reset the canvas"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Delete")]}
            />
            <Shortcut label={"Delete"} shortcuts={[getShortcutKey("Delete")]} />
            <Shortcut
              label={"Cut"}
              shortcuts={[getShortcutKey("CtrlOrCmd+X")]}
            />
            <Shortcut
              label={"Copy"}
              shortcuts={[getShortcutKey("CtrlOrCmd+C")]}
            />
            <Shortcut
              label={"Paste"}
              shortcuts={[getShortcutKey("CtrlOrCmd+V")]}
            />
            <Shortcut
              label={"Paste as plaintext"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+V")]}
            />
            <Shortcut
              label={"Select all"}
              shortcuts={[getShortcutKey("CtrlOrCmd+A")]}
            />
            <Shortcut
              label={"Add element to selection"}
              shortcuts={[getShortcutKey(`Shift+${"click"}`)]}
            />
            <Shortcut
              label={"Deep select"}
              shortcuts={[getShortcutKey(`CtrlOrCmd+${"click"}`)]}
            />
            <Shortcut
              label={"Deep select within box, and prevent dragging"}
              shortcuts={[getShortcutKey(`CtrlOrCmd+${"drag"}`)]}
            />
            {/* firefox supports clipboard API under a flag, so we'll
                show users what they can do in the error message */}
            {(probablySupportsClipboardBlob || isFirefox) && (
              <Shortcut
                label={"Copy to clipboard as PNG"}
                shortcuts={[getShortcutKey("Shift+Alt+C")]}
              />
            )}
            <Shortcut
              label={"Copy styles"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Alt+C")]}
            />
            <Shortcut
              label={"Paste styles"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Alt+V")]}
            />
            <Shortcut
              label={"Send to back"}
              shortcuts={[
                isDarwin
                  ? getShortcutKey("CtrlOrCmd+Alt+[")
                  : getShortcutKey("CtrlOrCmd+Shift+["),
              ]}
            />
            <Shortcut
              label={"Bring to front"}
              shortcuts={[
                isDarwin
                  ? getShortcutKey("CtrlOrCmd+Alt+]")
                  : getShortcutKey("CtrlOrCmd+Shift+]"),
              ]}
            />
            <Shortcut
              label={"Send backward"}
              shortcuts={[getShortcutKey("CtrlOrCmd+[")]}
            />
            <Shortcut
              label={"Bring forward"}
              shortcuts={[getShortcutKey("CtrlOrCmd+]")]}
            />
            <Shortcut
              label={"Align top"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+Up")]}
            />
            <Shortcut
              label={"Align bottom"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+Down")]}
            />
            <Shortcut
              label={"Align left"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+Left")]}
            />
            <Shortcut
              label={"Align right"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+Right")]}
            />
            <Shortcut
              label={"Auto-arrange"}
              shortcuts={[getShortcutKey("Shift+Alt+A")]}
            />
            <Shortcut
              label={"Duplicate"}
              shortcuts={[
                getShortcutKey("CtrlOrCmd+D"),
                getShortcutKey(`Alt+${"drag"}`),
              ]}
            />
            <Shortcut
              label={"Lock/unlock selection"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+L")]}
            />
            <Shortcut
              label={"Undo"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Z")]}
            />
            <Shortcut
              label={"Redo"}
              shortcuts={
                isWindows
                  ? [
                      getShortcutKey("CtrlOrCmd+Y"),
                      getShortcutKey("CtrlOrCmd+Shift+Z"),
                    ]
                  : [getShortcutKey("CtrlOrCmd+Shift+Z")]
              }
            />
            <Shortcut
              label={"Group selection"}
              shortcuts={[getShortcutKey("CtrlOrCmd+G")]}
            />
            <Shortcut
              label={"Ungroup selection"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+G")]}
            />
            <Shortcut
              label={"Flip horizontal"}
              shortcuts={[getShortcutKey("Shift+H")]}
            />
            <Shortcut
              label={"Flip vertical"}
              shortcuts={[getShortcutKey("Shift+V")]}
            />
            <Shortcut
              label={"Show stroke color picker"}
              shortcuts={[getShortcutKey("S")]}
            />
            <Shortcut
              label={"Show background color picker"}
              shortcuts={[getShortcutKey("G")]}
            />
            <Shortcut
              label={"Show font picker"}
              shortcuts={[getShortcutKey("Shift+F")]}
            />
            <Shortcut
              label={"Decrease font size"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+<")]}
            />
            <Shortcut
              label={"Increase font size"}
              shortcuts={[getShortcutKey("CtrlOrCmd+Shift+>")]}
            />
          </ShortcutIsland>
        </Section>
      </Dialog>
    </>
  );
};
