import {
  DEFAULT_SIDEBAR,
  Emitter,
  FRAMES_SIDEBAR_TAB,
} from "@excalidraw/common";
import { isArrowElement, isFrameLikeElement } from "@excalidraw/element";

import {
  currentFrame,
  frameKey,
  frameModel,
  liveBookmarks,
  nextFrame,
  viewBounds,
} from "../frameNavigation";

import type { Direction, FrameModel } from "../frameNavigation";
import type { AnimationOptions } from "../viewport";
import type { AppState, ViewportOffsetsOptions } from "../types";
import type App from "./App";

/** a step to a neighbouring frame glides; a jump from the drawer flies */
const STEP: AnimationOptions = { path: "direct", duration: 900 };
const JUMP: AnimationOptions = { path: "flight", duration: 1600 };

/** frames fit beside the top bar and the sidebar, ignoring the styles panel
 * that comes and goes with the tool */
const FIT: ViewportOffsetsOptions = { left: 24 };

/** view keys remembered: the state observer asks for the current and the
 * previous state's frame on every update */
const SEEN_LIMIT = 8;

/**
 * Frame navigation for `props.frameNavigation`: the scene's frame model,
 * the frame the view is in, and the keys and flights that move between
 * frames. The drawer (a default sidebar tab) and the breadcrumb read it.
 */
export class AppFrameNavigation {
  private built: {
    nonce: number | undefined;
    signature: string;
    model: FrameModel;
  } | null = null;
  private seen = new Map<string, string | null>();
  /** relays the scene's updates to the drawer and the breadcrumb, which
   * outlive the scene's own subscriptions on unmount */
  readonly sceneUpdated = new Emitter();
  /** a step in flight: the next arrow steps on from where it lands */
  private heading: { id: string; until: number } | null = null;

  constructor(private app: App) {}

  get enabled() {
    return !!this.app.props.frameNavigation;
  }

  /** rebuilt only when a frame or an arrow between frames changes, not on
   * every scene update */
  model = () => {
    const nonce = this.app.scene.getSceneNonce();
    const built = this.built;
    if (built && built.nonce === nonce) {
      return built.model;
    }
    const elements = this.app.scene.getNonDeletedElements();
    const signature = elements
      .filter(
        (e) =>
          isFrameLikeElement(e) ||
          (isArrowElement(e) && e.startBinding && e.endBinding),
      )
      .map((e) => `${e.id}:${e.version}`)
      .join();
    if (built && built.signature === signature) {
      this.built = { ...built, nonce };
      return built.model;
    }
    const model = frameModel(elements);
    this.built = { nonce, signature, model };
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
   * the frames or the sidebar change */
  currentId = (state: AppState = this.app.state) => {
    const model = this.model();
    const { scrollX, scrollY, zoom, width, height, openSidebar } = state;
    const key = [
      scrollX,
      scrollY,
      zoom.value,
      width,
      height,
      this.built?.signature,
      openSidebar?.name,
      openSidebar?.tab,
      state.defaultSidebarDockedPreference,
    ].join();
    const seen = this.seen.get(key);
    if (seen !== undefined) {
      return seen;
    }
    if (this.seen.size >= SEEN_LIMIT) {
      const [oldest] = this.seen.keys();
      this.seen.delete(oldest);
    }
    const id = this.current(model, state)?.id ?? null;
    this.seen.set(key, id);
    return id;
  };

  private current = (model: FrameModel, state: AppState) =>
    currentFrame(model, viewBounds(state, this.app.viewport.getOffsets(FIT)));

  goTo = (id: string, animation: AnimationOptions = JUMP) => {
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

  /** opens the drawer only when there are frames to list */
  toggleDrawer = () => {
    this.app.toggleSidebar({
      name: DEFAULT_SIDEBAR.name,
      tab: FRAMES_SIDEBAR_TAB,
      force: !this.isDrawerOpen() && this.model().frames.length > 0,
    });
  };

  private step = (direction: Direction) => {
    const model = this.model();
    const heading = this.heading;
    const flying =
      heading && performance.now() < heading.until
        ? model.byId.get(heading.id)
        : null;
    const to = nextFrame(model, {
      current: flying ?? this.current(model, this.app.state),
      view: viewBounds(this.app.state, this.app.viewport.getOffsets(FIT)),
      direction,
    });
    if (!to) {
      return;
    }
    this.goTo(to.id, STEP);
    this.heading = {
      id: to.id,
      until: performance.now() + (STEP.duration ?? 0),
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
