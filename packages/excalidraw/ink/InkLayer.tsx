import { memo, useEffect, useRef } from "react";

import { attachInk } from "./ink";

import type App from "../components/App";

/**
 * The GPU canvas freedraw strokes are drawn on while the pointer is down
 * (`freedrawRenderer="webgl"`). Mounted with the editor, so its window
 * listeners come before any the host adds once it has the API.
 */
export const InkLayer = memo(({ app }: { app: App }) => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas.current) {
      return;
    }
    const ink = attachInk(app, canvas.current);
    app.ink = ink;
    return () => {
      app.ink = null;
      ink?.detach();
    };
  }, [app]);

  return <canvas ref={canvas} className="excalidraw__ink" />;
});
