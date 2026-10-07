import { Fragment } from "react";

import { framePath } from "../frameNavigation";
import { useCurrentFrameId, useFrameModel } from "../hooks/useFrameModel";
import { t } from "../i18n";

import { useApp } from "./App";

import "./FrameBreadcrumb.scss";

/** The frames from the outermost down to the one the view is in; each flies
 * there on click. */
export const FrameBreadcrumb = () => {
  const app = useApp();
  const model = useFrameModel(app);
  const current = useCurrentFrameId(app);
  if (!current) {
    return null;
  }
  const path = framePath(model, current);
  return (
    <nav
      className="frame-breadcrumb"
      aria-label={t("frameNavigation.breadcrumb")}
    >
      {path.map((frame, i) => (
        <Fragment key={frame.id}>
          {i > 0 && <span aria-hidden> › </span>}
          <button
            type="button"
            aria-current={i === path.length - 1 ? "location" : undefined}
            onClick={(event) => {
              app.frameNavigation.goTo(frame.id);
              if (event.detail > 0) {
                app.focusContainer();
              }
            }}
          >
            {frame.name}
          </button>
        </Fragment>
      ))}
    </nav>
  );
};
