import { Stats } from "@excalidraw/excalidraw";
import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";
import {
  DEFAULT_VERSION,
  debounce,
  getVersion,
  nFormatter,
} from "@excalidraw/common";
import { useEffect, useState } from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { UIAppState } from "@excalidraw/excalidraw/types";

import {
  getElementsStorageSize,
  getTotalStorageSize,
} from "./data/localStorage";

type StorageSizes = { scene: number; total: number };

const STORAGE_SIZE_TIMEOUT = 500;

const getStorageSizes = debounce((cb: (sizes: StorageSizes) => void) => {
  cb({
    scene: getElementsStorageSize(),
    total: getTotalStorageSize(),
  });
}, STORAGE_SIZE_TIMEOUT);

type Props = {
  setToast: (message: string) => void;
  elements: readonly NonDeletedExcalidrawElement[];
  appState: UIAppState;
};
const CustomStats = (props: Props) => {
  const [storageSizes, setStorageSizes] = useState<StorageSizes>({
    scene: 0,
    total: 0,
  });

  useEffect(() => {
    getStorageSizes((sizes) => {
      setStorageSizes(sizes);
    });
  }, [props.elements, props.appState]);
  useEffect(() => () => getStorageSizes.cancel(), []);

  const version = getVersion();
  let hash;
  let timestamp;

  if (version !== DEFAULT_VERSION) {
    timestamp = version.slice(0, 16).replace("T", " ");
    hash = version.slice(21);
  } else {
    timestamp = "Version not available";
  }

  return (
    <Stats.StatsRows order={-1}>
      <Stats.StatsRow heading>{"Version"}</Stats.StatsRow>
      <Stats.StatsRow
        style={{ textAlign: "center", cursor: "pointer" }}
        onClick={async () => {
          try {
            await copyTextToSystemClipboard(getVersion());
            props.setToast("Copied to clipboard.");
          } catch {}
        }}
        title={"Click to copy"}
      >
        {timestamp}
        <br />
        {hash}
      </Stats.StatsRow>

      <Stats.StatsRow heading>{"Storage"}</Stats.StatsRow>
      <Stats.StatsRow columns={2}>
        <div>{"Scene"}</div>
        <div>{nFormatter(storageSizes.scene, 1)}</div>
      </Stats.StatsRow>
      <Stats.StatsRow columns={2}>
        <div>{"Total"}</div>
        <div>{nFormatter(storageSizes.total, 1)}</div>
      </Stats.StatsRow>
    </Stats.StatsRows>
  );
};

export default CustomStats;
