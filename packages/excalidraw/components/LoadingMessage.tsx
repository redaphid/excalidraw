import clsx from "clsx";
import { useState, useEffect } from "react";

import { THEME } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import Spinner from "./Spinner";

export const LoadingMessage: React.FC<{ delay?: number; theme?: Theme }> = ({
  delay,
  theme,
}) => {
  const [isWaiting, setIsWaiting] = useState(!!delay);

  useEffect(() => {
    if (!delay) {
      return;
    }
    const timer = setTimeout(() => {
      setIsWaiting(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (isWaiting) {
    return null;
  }

  return (
    <div
      className={clsx("LoadingMessage", {
        "LoadingMessage--dark": theme === THEME.DARK,
      })}
    >
      <div>
        <Spinner />
      </div>
      <div className="LoadingMessage-text">{"Loading scene…"}</div>
    </div>
  );
};
