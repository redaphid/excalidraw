import React from "react";

import { getFrame } from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { actionSaveFileToDisk } from "../actions/actionExport";

import { trackEvent } from "../analytics";
import { nativeFileSystemSupported } from "../data/filesystem";

import { Card } from "./Card";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { exportToFileIcon, LinkIcon } from "./icons";

import "./ExportDialog.scss";

import type { ActionManager } from "../actions/manager";

import type { ExportOpts, BinaryFiles, UIAppState } from "../types";

export type ExportCB = (
  elements: readonly NonDeletedExcalidrawElement[],
  scale?: number,
) => void;

const JSONExportModal = ({
  elements,
  appState,
  setAppState,
  files,
  actionManager,
  exportOpts,
  canvas,
  onCloseRequest,
}: {
  appState: UIAppState;
  setAppState: React.Component<any, UIAppState>["setState"];
  files: BinaryFiles;
  elements: readonly NonDeletedExcalidrawElement[];
  actionManager: ActionManager;
  onCloseRequest: () => void;
  exportOpts: ExportOpts;
  canvas: HTMLCanvasElement;
}) => {
  const { onExportToBackend } = exportOpts;
  return (
    <div className="ExportDialog ExportDialog--json">
      <div className="ExportDialog-cards">
        {exportOpts.saveFileToDisk && (
          <Card color="lime">
            <div className="Card-icon">{exportToFileIcon}</div>
            <h2>{"Save to disk"}</h2>
            <div className="Card-details">
              {
                "Export the scene data to a file from which you can import later."
              }
              {!nativeFileSystemSupported &&
                actionManager.renderAction("changeProjectName")}
            </div>
            <IconButton
              className="Card-button"
              type="button"
              title={"Save to file"}
              aria-label={"Save to file"}
              showAriaLabel={true}
              onClick={() => {
                actionManager.executeAction(actionSaveFileToDisk, "ui");
              }}
            />
          </Card>
        )}
        {onExportToBackend && (
          <Card color="pink">
            <div className="Card-icon">{LinkIcon}</div>
            <h2>{"Shareable link"}</h2>
            <div className="Card-details">{"Export as a read-only link."}</div>
            <IconButton
              className="Card-button"
              type="button"
              title={"Export to Link"}
              aria-label={"Export to Link"}
              showAriaLabel={true}
              onClick={async () => {
                try {
                  trackEvent("export", "link", `ui (${getFrame()})`);
                  await onExportToBackend(elements, appState, files);
                  onCloseRequest();
                } catch (error: any) {
                  setAppState({ errorMessage: error.message });
                }
              }}
            />
          </Card>
        )}
        {exportOpts.renderCustomUI &&
          exportOpts.renderCustomUI(elements, appState, files, canvas)}
      </div>
    </div>
  );
};

export const JSONExportDialog = ({
  elements,
  appState,
  files,
  actionManager,
  exportOpts,
  canvas,
  setAppState,
}: {
  elements: readonly NonDeletedExcalidrawElement[];
  appState: UIAppState;
  files: BinaryFiles;
  actionManager: ActionManager;
  exportOpts: ExportOpts;
  canvas: HTMLCanvasElement;
  setAppState: React.Component<any, UIAppState>["setState"];
}) => {
  const handleClose = React.useCallback(() => {
    setAppState({ openDialog: null });
  }, [setAppState]);

  return (
    <>
      {appState.openDialog?.name === "jsonExport" && (
        <Dialog onCloseRequest={handleClose} title={"Save to..."}>
          <JSONExportModal
            elements={elements}
            appState={appState}
            setAppState={setAppState}
            files={files}
            actionManager={actionManager}
            onCloseRequest={handleClose}
            exportOpts={exportOpts}
            canvas={canvas}
          />
        </Dialog>
      )}
    </>
  );
};
