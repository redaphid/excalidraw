import type { Theme } from "@excalidraw/element/types";

/**
 * The sample themes in ./themes. Each file is plain CSS for the `css` prop;
 * its first comment names it and the mode it was designed for, e.g.
 * `/* Blueprint. mode: dark *\/`.
 */
export type PlaygroundTheme = Readonly<{
  id: string;
  label: string;
  mode: Theme;
  css: string;
}>;

const sources = import.meta.glob<string>("./themes/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

const parse = (file: string, css: string): PlaygroundTheme => {
  const header = css.match(/^\/\*\s*(.+?)\.\s*mode:\s*(light|dark)\s*\*\//);
  if (!header) {
    throw new Error(`${file} must start with /* Name. mode: light|dark */`);
  }
  return {
    id: file.replace(/^.*\/|\.css$/g, ""),
    label: header[1],
    mode: header[2] as Theme,
    css,
  };
};

export const THEMES: readonly PlaygroundTheme[] = Object.entries(sources)
  .map(([file, css]) => parse(file, css))
  .sort((a, b) => a.label.localeCompare(b.label));
