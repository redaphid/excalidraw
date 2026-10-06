import { DEFAULT_SIDEBAR, FRAMES_SIDEBAR_TAB } from "@excalidraw/common";

import {
  currentFrame,
  frameKey,
  frameModel,
  liveBookmarks,
  nextFrame,
  viewBounds,
} from "../frameNavigation";

import type { FrameModel } from "../frameNavigation";
import type { AnimationOptions } from "../viewport";
import type { AppState, ViewportOffsetsOptions } from "../types";
import type App from "./App";

/** a step to a neighbouring frame glides; a jump from the drawer flies */
export const FRAME_STEP: AnimationOptions = { path: "direct", duration: 900 };
export const FRAME_JUMP: AnimationOptions = { path: "flight", duration: 1600 };

/** frames fit beside the top bar and the sidebar, ignoring the styles panel
 * that comes and goes with the tool */
const FIT: ViewportOffsetsOptions = { left: 24 };

/**
 * Frame navigation for `props.frameNavigation`: the scene's frame model,
 * the frame the view is in, and the keys and flights that move between
 * frames. The drawer (a default sidebar tab) and the breadcrumb read it.
 */
export class AppFrameNavigation {
  private built: { nonce: number | undefined; model: FrameModel } | null = null;
  private seen: { key: string; id: string | null } | null = null;
  /** a step in flight: the next arrow steps on from where it lands */
  private heading: { id: string; until: number } | null = null;

  constructor(private app: App) {}

  get enabled() {
    return !!this.app.props.frameNavigation;
  }

  model = () => {
    const nonce = this.app.scene.getSceneNonce();
    const built = this.built;
    if (built && built.nonce === nonce) {
      return built.model;
    }
    const model = frameModel(this.app.scene.getNonDeletedElements());
    this.built = { nonce, model };
    return model;
  };

  bookmarks = () =>
    liveBookmarks(
      this.model(),
      this.app.props.frameNavigation?.bookmarks ?? [],
    );

  isDrawerOpen = (state: Pick<AppState, "openSidebar"> = this.app.state) =>
    state.openSidebar?.name === DEFAULT_SIDEBAR.name &&
    state.openSidebar.tab === FRAMES_SIDEBAR_TAB;

  /** the id of the frame the view is in, recomputed only when the view,
   * the scene or the sidebar changes */
  currentId = (state: AppState = this.app.state) => {
    const { scrollX, scrollY, zoom, width, height, openSidebar } = state;
    const key = [
      scrollX,
      scrollY,
      zoom.value,
      width,
      height,
      this.app.scene.getSceneNonce(),
      openSidebar?.name,
      openSidebar?.tab,
      state.defaultSidebarDockedPreference,
    ].join();
    if (this.seen?.key !== key) {
      this.seen = { key, id: this.current(state)?.id ?? null };
    }
    return this.seen.id;
  };

  private current = (state: AppState) =>
    currentFrame(
      this.model(),
      viewBounds(state, this.app.viewport.getOffsets(FIT)),
    );

  goTo = (id: string, animation: AnimationOptions = FRAME_JUMP) => {
    const frame = this.model().byId.get(id);
    if (!frame) {
      return;
    }
    this.app.viewport.setViewport({
      target: frame,
      fit: "contain",
      animation,
      offsets: { ui: FIT },
    });
  };

  toggleDrawer = () => {
    this.app.toggleSidebar({
      name: DEFAULT_SIDEBAR.name,
      tab: FRAMES_SIDEBAR_TAB,
      force: !this.isDrawerOpen() && this.model().frames.length > 0,
    });
  };

  private step = (direction: Parameters<typeof nextFrame>[1]["direction"]) => {
    const model = this.model();
    const heading = this.heading;
    const flying =
      heading && performance.now() < heading.until
        ? model.byId.get(heading.id)
        : null;
    const to = nextFrame(model, {
      current: flying ?? this.current(this.app.state),
      view: viewBounds(this.app.state, this.app.viewport.getOffsets(FIT)),
      direction,
    });
    if (!to) {
      return;
    }
    this.goTo(to.id, FRAME_STEP);
    this.heading = {
      id: to.id,
      until: performance.now() + (FRAME_STEP.duration ?? 0),
    };
  };

  handleKeyDown = (event: React.KeyboardEvent | KeyboardEvent): boolean => {
    if (!this.enabled) {
      return false;
    }
    const key = frameKey(event, {
      selecting: Object.values(this.app.state.selectedElementIds).some(Boolean),
    });
    if (!key) {
      return false;
    }
    event.preventDefault();
    switch (key.kind) {
      case "drawer":
        this.toggleDrawer();
        return true;
      case "bookmark": {
        const to = this.bookmarks()[key.index];
        if (to) {
          this.goTo(to.id);
        }
        return true;
      }
      case "step":
        this.step(key.direction);
        return true;
    }
  };
}
