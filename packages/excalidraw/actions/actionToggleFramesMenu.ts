import { frameToolIcon } from "../components/icons";

import { register } from "./register";

const DRAWER_KEY = "m";

export const actionToggleFramesMenu = register({
  name: "framesMenu",
  icon: frameToolIcon,
  keywords: ["frames", "drawer", "bookmarks", "navigate"],
  label: "frameNavigation.title",
  viewMode: true,
  trackEvent: false,
  perform(elements, appState, _, app) {
    app.frameNavigation.toggleDrawer();
    return false;
  },
  predicate: (elements, appState, props) => !!props.frameNavigation,
  keyTest: (event, appState, elements, app) =>
    !!app.props.frameNavigation &&
    event.key === DRAWER_KEY &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey,
});
