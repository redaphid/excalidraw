import { THEME } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import catalog from "../packages/excalidraw/themes/index.json";

/** The sample themes the package ships, listed by themes/index.json. */
export type PlaygroundTheme = Readonly<{
  id: string;
  label: string;
  mode: Theme;
  css: string;
}>;

const stylesheets = import.meta.glob<string>(
  "../packages/excalidraw/themes/*.css",
  { query: "?raw", import: "default", eager: true },
);

export const THEMES: readonly PlaygroundTheme[] = catalog.themes
  .map(({ name, title, mode }) => ({
    id: name,
    label: title,
    mode: mode === "dark" ? THEME.DARK : THEME.LIGHT,
    css: stylesheets[`../packages/excalidraw/themes/${name}.css`],
  }))
  .sort((a, b) => a.label.localeCompare(b.label));
