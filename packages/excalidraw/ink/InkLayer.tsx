import { memo, useEffect, useRef } from "react";

import { attachInk } from "./ink";

import type App from "../components/App";

/**
 * Where the GPU canvas freedraw strokes are drawn on while the pointer is
 * down (`freedrawRenderer="webgl"`). Each attach makes a canvas of its own and
 * releases its context on detach: a canvas hands a lost context back to the
 * next attach (React's strict mode attaches twice). Mounted with the editor,
 * so its window listeners come before any the host adds once it has the API.
 */
export const InkLayer = memo(({ app }: { app: App }) => {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = app.ownerDocument.createElement("canvas");
    canvas.className = "excalidraw__ink";
    layer.current?.append(canvas);
    const ink = attachInk(app, canvas);
    app.ink = ink;
    return () => {
      app.ink = null;
      ink?.detach();
      canvas.remove();
    };
  }, [app]);

  return <div ref={layer} className="excalidraw__ink-layer" />;
});
